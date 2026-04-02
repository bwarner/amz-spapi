import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth0 } from '../../../../lib/auth0';
import { createSpApiOAuthFlow } from '../../../../lib/amazon-oauth';
import { MARKETPLACE_REGIONS } from '@farvisionllc/models';

/**
 * GET /api/amazon/sp-connect?marketplace=ATVPDKIKX0DER&profile=default
 * Initiates the SP-API LWA OAuth flow by redirecting to Amazon's consent screen.
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

  const oauthFlow = createSpApiOAuthFlow();
  const { authUrl, state } = oauthFlow.generateAuthUrl(
    'SP_API',
    profileName,
    session.user.sub
  );

  const cookieStore = await cookies();

  // Store state nonce for CSRF validation
  cookieStore.set('amazon_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 15 * 60,
    path: '/',
  });

  // Store marketplace so the callback knows which marketplace to use
  cookieStore.set('amazon_oauth_marketplace', marketplaceId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 15 * 60,
    path: '/',
  });

  return NextResponse.redirect(authUrl);
}
