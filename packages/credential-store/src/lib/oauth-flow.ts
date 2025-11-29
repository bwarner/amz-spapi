import axios from 'axios';
import crypto from 'node:crypto';
import {
  AmazonApiType,
  AmazonRegion,
  LwaTokenResponse,
  LwaTokenResponseSchema,
  LWA_TOKEN_ENDPOINTS,
  createSpApiProfile,
  createAdsApiProfile,
  AmazonCredentialProfile,
} from '@farvisionllc/models';

/**
 * OAuth configuration for Amazon LWA (Login with Amazon)
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  region?: AmazonRegion;
}

/**
 * OAuth state parameter for security and tracking
 */
export interface OAuthState {
  apiType: AmazonApiType;
  profileName: string;
  userId?: string;
  nonce: string;
  createdAt: number;
}

/**
 * Amazon LWA OAuth scopes
 */
export const SP_API_SCOPES = [
  'sellingpartnerapi::notifications',
  'sellingpartnerapi::migration',
];

export const ADS_API_SCOPES = ['advertising::campaign_management'];

/**
 * OAuth flow helper for Amazon APIs
 * Handles both SP-API and Ads API authorization code flows
 */
export class AmazonOAuthFlow {
  private config: OAuthConfig;
  private region: AmazonRegion;

  constructor(config: OAuthConfig) {
    this.config = config;
    this.region = config.region || 'NA';
  }

  /**
   * Generate authorization URL for user to grant permissions
   * @param apiType SP_API or ADS_API
   * @param profileName Name for the credential profile
   * @param userId Optional user ID for multi-tenant apps
   * @returns Authorization URL and state parameter
   */
  public generateAuthUrl(
    apiType: AmazonApiType,
    profileName: string,
    userId?: string
  ): { authUrl: string; state: string } {
    // Generate state parameter for CSRF protection
    const state: OAuthState = {
      apiType,
      profileName,
      userId,
      nonce: crypto.randomBytes(16).toString('hex'),
      createdAt: Date.now(),
    };

    const stateString = Buffer.from(JSON.stringify(state)).toString('base64url');

    // Determine scopes based on API type
    const scopes = apiType === 'SP_API' ? SP_API_SCOPES : ADS_API_SCOPES;

    // Build authorization URL
    const authUrl = new URL('https://www.amazon.com/ap/oa');
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('state', stateString);

    // For Ads API, use the advertising-specific login
    if (apiType === 'ADS_API') {
      authUrl.hostname = 'www.amazon.com';
      authUrl.pathname = '/ap/oa';
      // Ads API may use slightly different endpoint
      // Verify with Amazon Ads API documentation
    }

    return {
      authUrl: authUrl.toString(),
      state: stateString,
    };
  }

  /**
   * Parse and validate state parameter from OAuth callback
   * @param stateString Base64url-encoded state from callback
   * @returns Parsed state object
   * @throws Error if state is invalid or expired
   */
  public parseState(stateString: string): OAuthState {
    try {
      const decoded = Buffer.from(stateString, 'base64url').toString('utf-8');
      const state = JSON.parse(decoded) as OAuthState;

      // Validate state hasn't expired (15 minutes)
      const maxAge = 15 * 60 * 1000;
      if (Date.now() - state.createdAt > maxAge) {
        throw new Error('OAuth state has expired');
      }

      return state;
    } catch (error) {
      throw new Error(`Invalid OAuth state parameter: ${error}`);
    }
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * @param code Authorization code from OAuth callback
   * @param apiType SP_API or ADS_API
   * @returns Token response from LWA
   */
  public async exchangeCodeForTokens(
    code: string,
    apiType: AmazonApiType
  ): Promise<LwaTokenResponse> {
    const tokenEndpoint = LWA_TOKEN_ENDPOINTS[this.region];

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await axios.post(tokenEndpoint, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return LwaTokenResponseSchema.parse(response.data);
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `LWA token exchange failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      }
      throw new Error(`LWA token exchange failed: ${error.message}`);
    }
  }

  /**
   * Refresh an expired access token using a refresh token
   * @param refreshToken The refresh token from previous OAuth flow
   * @returns New access token and expiry
   */
  public async refreshAccessToken(refreshToken: string): Promise<LwaTokenResponse> {
    const tokenEndpoint = LWA_TOKEN_ENDPOINTS[this.region];

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await axios.post(tokenEndpoint, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return LwaTokenResponseSchema.parse(response.data);
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `LWA token refresh failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      }
      throw new Error(`LWA token refresh failed: ${error.message}`);
    }
  }

  /**
   * Complete OAuth flow: exchange code and create credential profile
   * @param code Authorization code
   * @param state State parameter from callback
   * @param marketplaceId Amazon marketplace ID
   * @param sellerId Optional seller ID for SP-API
   * @param advertiserProfileId Optional advertiser profile ID for Ads API
   * @returns Complete credential profile ready to store
   */
  public async completeOAuthFlow(
    code: string,
    state: OAuthState,
    marketplaceId: string,
    sellerId?: string,
    advertiserProfileId?: string
  ): Promise<AmazonCredentialProfile> {
    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(code, state.apiType);

    // Create appropriate profile based on API type
    if (state.apiType === 'SP_API') {
      return createSpApiProfile({
        profile_name: state.profileName,
        user_id: state.userId,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        access_token_expires_at: Date.now() + tokens.expires_in * 1000,
        marketplace_id: marketplaceId,
        region: this.region,
        seller_id: sellerId,
      });
    } else {
      return createAdsApiProfile({
        profile_name: state.profileName,
        user_id: state.userId,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        access_token_expires_at: Date.now() + tokens.expires_in * 1000,
        marketplace_id: marketplaceId,
        region: this.region,
        advertiser_profile_id: advertiserProfileId,
      });
    }
  }
}

/**
 * Helper to validate OAuth callback parameters
 */
export function validateOAuthCallback(params: {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}): void {
  if (params.error) {
    throw new Error(
      `OAuth error: ${params.error}${params.error_description ? ` - ${params.error_description}` : ''}`
    );
  }

  if (!params.code) {
    throw new Error('Missing authorization code in OAuth callback');
  }

  if (!params.state) {
    throw new Error('Missing state parameter in OAuth callback');
  }
}
