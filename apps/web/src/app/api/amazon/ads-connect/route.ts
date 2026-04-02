import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth0 } from '../../../../lib/auth0';
import { createAdsApiOAuthFlow } from '../../../../lib/amazon-oauth';
import { MARKETPLACE_REGIONS } from '@farvisionllc/models';

/**
 * GET /api/amazon/ads-connect?marketplace=ATVPDKIKX0DER&profile=default
 * Initiates the Ads API LWA OAuth flow by redirecting to Amazon's consent screen.
 * Uses a separate Amazon LWA app from the SP-API connect flow.
 */
export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const marketplaceId = searchParams.get('marketplace') || process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';
  const profileName = searchParams.get('profile') || 'default';

  // Validate marketplace
  if (!MARKETPLACE_REGIONS[marketplaceId]) {
    return NextResponse.json({ error: 'Invalid marketplace ID' }, { status: 400 });
  }

  const oauthFlow = createAdsApiOAuthFlow();
  const { authUrl, state } = oauthFlow.generateAuthUrl(
    'ADS_API',
    profileName,
    session.user.sub
  );

  const cookieStore = await cookies();

  cookieStore.set('amazon_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 15 * 60,
    path: '/',
  });

  cookieStore.set('amazon_oauth_marketplace', marketplaceId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 15 * 60,
    path: '/',
  });

  return NextResponse.redirect(authUrl);
}
