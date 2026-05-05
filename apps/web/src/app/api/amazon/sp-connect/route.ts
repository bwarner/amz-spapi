import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth0 } from '../../../../lib/auth0';
import { createSpApiOAuthFlow } from '../../../../lib/amazon-oauth';
import { MARKETPLACE_REGIONS } from '@farvisionllc/models';

const SELLER_CENTRAL_URLS: Record<string, string> = {
  ATVPDKIKX0DER: 'https://sellercentral.amazon.com',
  A2EUQ1WTGCTBG2: 'https://sellercentral.amazon.ca',
  A1AM78C64UM0Y8: 'https://sellercentral.amazon.com.mx',
  A2Q3Y263D00KWC: 'https://sellercentral.amazon.com.br',
  A1F83G8C2ARO7P: 'https://sellercentral-europe.amazon.com',
  A1PA6795UKMFR9: 'https://sellercentral-europe.amazon.com',
  A1RKKUPIHCS9HS: 'https://sellercentral-europe.amazon.com',
  A13V1IB3VIYZZH: 'https://sellercentral-europe.amazon.com',
  APJ6JRA9NG5V4: 'https://sellercentral-europe.amazon.com',
  A1805IZSGTT6HS: 'https://sellercentral.amazon.nl',
  A1VC38T7YXB528: 'https://sellercentral.amazon.co.jp',
  A39IBJ37TRP1C6: 'https://sellercentral.amazon.com.au',
  A19VAU5U5O7RUS: 'https://sellercentral.amazon.sg',
};

/**
 * GET /api/amazon/sp-connect?marketplace=ATVPDKIKX0DER&profile=default
 * Initiates the SP-API website authorization flow by redirecting to Seller Central.
 */
export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const marketplaceId =
    searchParams.get('marketplace') ||
    process.env['SP_MARKETPLACE_ID'] ||
    'ATVPDKIKX0DER';

  // Validate marketplace
  const region = MARKETPLACE_REGIONS[marketplaceId];
  if (!region) {
    return NextResponse.json(
      { error: 'Invalid marketplace ID' },
      { status: 400 }
    );
  }

  const profileName =
    searchParams.get('profile') ||
    `sp-${marketplaceId}-${Date.now().toString(36)}`;

  const oauthFlow = createSpApiOAuthFlow(region);
  const { state } = oauthFlow.generateAuthUrl(
    'SP_API',
    profileName,
    session.user.sub
  );
  const applicationId = process.env['SP_API_APPLICATION_ID'];
  if (!applicationId) {
    return NextResponse.json(
      { error: 'Missing SP_API_APPLICATION_ID' },
      { status: 500 }
    );
  }

  const sellerCentralUrl =
    process.env['SP_API_SELLER_CENTRAL_URL'] ||
    SELLER_CENTRAL_URLS[marketplaceId] ||
    'https://sellercentral.amazon.com';
  const authUrl = new URL('/apps/authorize/consent', sellerCentralUrl);
  authUrl.searchParams.set('application_id', applicationId);
  authUrl.searchParams.set('state', state);
  if (process.env['SP_API_DRAFT_VERSION'] === 'beta') {
    authUrl.searchParams.set('version', 'beta');
  }

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

  return NextResponse.redirect(authUrl.toString());
}
