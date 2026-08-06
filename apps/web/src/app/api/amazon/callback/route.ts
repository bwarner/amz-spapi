import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth0 } from '../../../../lib/auth0';
import { parseState, redirectUri } from '../../../../lib/amazon-authorize';
import { ApiError } from '../../../../services/api-service';
import { credentialService } from '../../../../services/credential-service';

/**
 * GET /api/amazon/callback — where Amazon sends the user back.
 *
 * Shared by SP-API and Ads; the `state` parameter says which.
 *
 * ## Why this is still here and not a Lambda (#55)
 *
 * The redirect URI is registered with Amazon and is a browser redirect target.
 * Moving it to API Gateway would mean re-registering it in both LWA
 * applications and giving the gateway a public unauthenticated route — this is
 * the one route that cannot carry an Auth0 token, because the user is arriving
 * from Amazon rather than from us. Staying here keeps the session cookie that
 * says whose connection this is.
 *
 * ## What this route may hold, and what it may not
 *
 * It holds the authorization CODE: single-use, expires in minutes, and useless
 * without the client secret, which is not in this runtime. It hands the code to
 * the credentials API, which redeems it, encrypts the result and stores it.
 *
 * **The refresh token never enters the Vercel runtime.** That is the point of
 * the whole slice, and it is why nothing below reads `LWA_CLIENT_SECRET` or
 * touches `credential-store`.
 */
export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const searchParams = request.nextUrl.searchParams;

  // Amazon reports a refusal here rather than by not redirecting, so a declined
  // consent screen arrives looking much like a success.
  const error = searchParams.get('error');
  if (error) {
    const description = searchParams.get('error_description');
    return settings(request, {
      error: `Amazon returned "${error}"${
        description ? `: ${description}` : ''
      }`,
    });
  }

  // SP-API names it `spapi_oauth_code`; Ads uses the standard `code`.
  const code =
    searchParams.get('spapi_oauth_code') ?? searchParams.get('code') ?? '';
  const callbackState = searchParams.get('state') ?? '';
  const sellerId =
    searchParams.get('selling_partner_id') ??
    searchParams.get('seller_id') ??
    undefined;

  if (!code || !callbackState) {
    return settings(request, { error: 'Missing OAuth callback parameters.' });
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get('amazon_oauth_state')?.value;
  const storedMarketplace = cookieStore.get('amazon_oauth_marketplace')?.value;

  // CSRF. The state came back through Amazon and a browser; the cookie is
  // httpOnly and same-site, so only a flow this app started can match it.
  // Compared before anything is spent on the code.
  if (!storedState || storedState !== callbackState) {
    return settings(request, {
      error: 'Invalid state parameter. Please try connecting again.',
    });
  }

  cookieStore.delete('amazon_oauth_state');
  cookieStore.delete('amazon_oauth_marketplace');

  const marketplaceId =
    storedMarketplace || process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  try {
    // Only for `apiType` and `profileName`. `state.userId` is deliberately
    // ignored: the API takes the caller from the verified JWT, and a state blob
    // is a CSRF token rather than a claim about who is connecting.
    const state = parseState(callbackState);

    const credentials = await credentialService();
    await credentials.connect({
      apiType: state.apiType,
      code,
      profileName: state.profileName,
      marketplaceId,
      // Sent because it is per-deployment — local, staging and production each
      // have their own — while one API stage serves all of a stage's front
      // ends. Amazon checks it against the one the authorize request used.
      redirectUri: redirectUri(),
      ...(state.apiType === 'SP_API' && sellerId ? { sellerId } : {}),
    });

    return settings(request, {
      connected: state.apiType === 'SP_API' ? 'sp_api' : 'ads_api',
    });
  } catch (err) {
    // The API's own detail is the useful part — "Amazon rejected the
    // authorization code" tells the user to start again, where a generic
    // failure sends them to support. It is safe to show: the service composes
    // these deliberately and never puts a credential in one.
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
        ? err.message
        : 'The connection could not be completed.';

    console.error('[amazon/callback] connect failed', message);
    return settings(request, { error: message });
  }
}

/** Back to settings, saying what happened. */
function settings(
  request: NextRequest,
  params: { connected?: string; error?: string }
) {
  const url = new URL('/settings', request.url);
  if (params.connected) url.searchParams.set('connected', params.connected);
  if (params.error) url.searchParams.set('error', params.error);
  return NextResponse.redirect(url);
}
