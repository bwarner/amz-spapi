import { AmazonOAuthFlow } from '@farvisionllc/credential-store';

/**
 * Create an OAuth flow instance for SP-API (uses the SP-API LWA app credentials).
 */
export function createSpApiOAuthFlow() {
  const clientId = process.env['LWA_CLIENT_ID'];
  const clientSecret = process.env['LWA_CLIENT_SECRET'];
  const redirectUri = process.env['AMAZON_OAUTH_REDIRECT_URI'];

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing SP-API OAuth config: LWA_CLIENT_ID, LWA_CLIENT_SECRET, AMAZON_OAUTH_REDIRECT_URI'
    );
  }

  return new AmazonOAuthFlow({ clientId, clientSecret, redirectUri });
}

/**
 * Create an OAuth flow instance for Ads API (uses the Ads API LWA app credentials).
 * This is a separate Amazon app from the SP-API app.
 */
export function createAdsApiOAuthFlow() {
  const clientId = process.env['ADS_CLIENT_ID'];
  const clientSecret = process.env['ADS_CLIENT_SECRET'];
  const redirectUri = process.env['AMAZON_OAUTH_REDIRECT_URI'];

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Ads API OAuth config: ADS_CLIENT_ID, ADS_CLIENT_SECRET, AMAZON_OAUTH_REDIRECT_URI'
    );
  }

  return new AmazonOAuthFlow({ clientId, clientSecret, redirectUri });
}
