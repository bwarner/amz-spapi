import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth0 } from '../../../../lib/auth0';
import { createSpApiOAuthFlow, createAdsApiOAuthFlow } from '../../../../lib/amazon-oauth';
import { validateOAuthCallback } from '@farvisionllc/credential-store';
import { getCredentialStore } from '../../../../lib/credential-store';

/**
 * GET /api/amazon/callback
 * Shared OAuth callback for both SP-API and Ads API.
 * Differentiates by reading apiType from the state parameter.
 */
export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code') ?? undefined;
  const state = searchParams.get('state') ?? undefined;
  const error = searchParams.get('error') ?? undefined;
  const errorDescription = searchParams.get('error_description') ?? undefined;

  // Validate basic callback parameters
  try {
    validateOAuthCallback({ code, state, error, error_description: errorDescription });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth validation failed';
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url)
    );
  }

  // Validate CSRF: state must match the cookie we set before redirect
  const cookieStore = await cookies();
  const storedState = cookieStore.get('amazon_oauth_state')?.value;
  const storedMarketplace = cookieStore.get('amazon_oauth_marketplace')?.value;

  if (!storedState || storedState !== state) {
    return NextResponse.redirect(
      new URL('/settings?error=Invalid+state+parameter.+Please+try+again.', request.url)
    );
  }

  // Clear the CSRF and marketplace cookies
  cookieStore.delete('amazon_oauth_state');
  cookieStore.delete('amazon_oauth_marketplace');

  const marketplaceId = storedMarketplace || process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  try {
    // Parse state to determine which API type
    const tempFlow = createSpApiOAuthFlow();
    const parsedState = tempFlow.parseState(state!);

    const oauthFlow = parsedState.apiType === 'ADS_API'
      ? createAdsApiOAuthFlow()
      : createSpApiOAuthFlow();

    // Exchange code for tokens and create credential profile
    const profile = await oauthFlow.completeOAuthFlow(
      code!,
      parsedState,
      marketplaceId
    );

    // Store credentials in Couchbase
    const credStore = getCredentialStore();
    await credStore.setProfile(profile);
    await credStore.setDefaultProfile(profile.profile_name, profile.api_type, profile.user_id);

    const apiLabel = parsedState.apiType === 'SP_API' ? 'sp_api' : 'ads_api';
    return NextResponse.redirect(
      new URL(`/settings?connected=${apiLabel}`, request.url)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed';
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
