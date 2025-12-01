import { z } from 'zod';

/**
 * Amazon API types - both use LWA OAuth but different scopes/endpoints
 */
export const AmazonApiTypeSchema = z.enum(['SP_API', 'ADS_API']);
export type AmazonApiType = z.infer<typeof AmazonApiTypeSchema>;

/**
 * Amazon region mapping
 */
export const AmazonRegionSchema = z.enum(['NA', 'EU', 'FE']);
export type AmazonRegion = z.infer<typeof AmazonRegionSchema>;

/**
 * Marketplace to region mapping
 */
export const MARKETPLACE_REGIONS: Record<string, AmazonRegion> = {
  // North America
  ATVPDKIKX0DER: 'NA', // US
  A2EUQ1WTGCTBG2: 'NA', // CA
  A1AM78C64UM0Y8: 'NA', // MX
  A2Q3Y263D00KWC: 'NA', // BR
  // Europe
  A1PA6795UKMFR9: 'EU', // DE
  A1RKKUPIHCS9HS: 'EU', // ES
  A13V1IB3VIYZZH: 'EU', // FR
  A1F83G8C2ARO7P: 'EU', // UK
  APJ6JRA9NG5V4: 'EU', // IT
  A1805IZSGTT6HS: 'EU', // NL
  // Far East
  A1VC38T7YXB528: 'FE', // JP
  A39IBJ37TRP1C6: 'FE', // AU
  A19VAU5U5O7RUS: 'FE', // SG
};

/**
 * OAuth token response from Amazon LWA (Login with Amazon)
 */
export const LwaTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_type: z.literal('bearer'),
  expires_in: z.number(), // seconds
  scope: z.string().optional(),
});

export type LwaTokenResponse = z.infer<typeof LwaTokenResponseSchema>;

/**
 * Base credential profile for Amazon APIs
 * Both SP-API and Ads API share this structure but use different LWA apps
 */
export const AmazonCredentialProfileSchema = z.object({
  // Identity
  profile_name: z.string().min(1, 'Profile name is required'),
  api_type: AmazonApiTypeSchema,
  user_id: z.string().optional(), // For multi-tenant web - Auth0 user ID

  // LWA OAuth credentials
  client_id: z.string().min(1, 'Client ID is required'),
  client_secret: z.string().min(1, 'Client secret is required'),
  refresh_token: z.string().optional(),
  access_token: z.string().optional(),
  access_token_expires_at: z.number().optional(), // Unix timestamp in milliseconds

  // Amazon-specific identifiers
  marketplace_id: z.string().min(1, 'Marketplace ID is required'),
  region: AmazonRegionSchema.optional(),

  // API-specific fields
  seller_id: z.string().optional(), // SP-API: merchant/seller ID
  advertiser_profile_id: z.string().optional(), // Ads API: profile ID for Scope header

  // Metadata
  created_at: z.number(),
  updated_at: z.number(),
});

export type AmazonCredentialProfile = z.infer<typeof AmazonCredentialProfileSchema>;

/**
 * Helper to create a new SP-API credential profile
 */
export function createSpApiProfile(
  data: Omit<
    AmazonCredentialProfile,
    'api_type' | 'created_at' | 'updated_at' | 'advertiser_profile_id'
  >
): AmazonCredentialProfile {
  const now = Date.now();
  return AmazonCredentialProfileSchema.parse({
    ...data,
    api_type: 'SP_API',
    region: data.region || MARKETPLACE_REGIONS[data.marketplace_id] || 'NA',
    created_at: now,
    updated_at: now,
  });
}

/**
 * Helper to create a new Ads API credential profile
 */
export function createAdsApiProfile(
  data: Omit<
    AmazonCredentialProfile,
    'api_type' | 'created_at' | 'updated_at' | 'seller_id'
  >
): AmazonCredentialProfile {
  const now = Date.now();
  return AmazonCredentialProfileSchema.parse({
    ...data,
    api_type: 'ADS_API',
    region: data.region || MARKETPLACE_REGIONS[data.marketplace_id] || 'NA',
    created_at: now,
    updated_at: now,
  });
}

/**
 * LWA endpoints by region
 */
export const LWA_TOKEN_ENDPOINTS: Record<AmazonRegion, string> = {
  NA: 'https://api.amazon.com/auth/o2/token',
  EU: 'https://api.amazon.co.uk/auth/o2/token',
  FE: 'https://api.amazon.co.jp/auth/o2/token',
};

/**
 * SP-API endpoints by region
 */
export const SPAPI_ENDPOINTS: Record<AmazonRegion, string> = {
  NA: 'https://sellingpartnerapi-na.amazon.com',
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
};

/**
 * Ads API endpoints by region
 */
export const ADS_API_ENDPOINTS: Record<AmazonRegion, string> = {
  NA: 'https://advertising-api.amazon.com',
  EU: 'https://advertising-api-eu.amazon.com',
  FE: 'https://advertising-api-fe.amazon.com',
};

/**
 * Repository interface for credential storage
 * Implemented by both SQLite (CLI) and Couchbase (Web) stores
 */
export interface ICredentialRepository {
  /**
   * Store or update a credential profile
   * Sensitive fields (client_secret, refresh_token, access_token) should be encrypted
   */
  setProfile(profile: AmazonCredentialProfile): Promise<void>;

  /**
   * Get a credential profile by name and API type
   * For multi-tenant (web), also filter by user_id
   */
  getProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<AmazonCredentialProfile | null>;

  /**
   * Update access token after refresh
   */
  updateAccessToken(
    profileName: string,
    apiType: AmazonApiType,
    accessToken: string,
    expiresIn: number,
    userId?: string
  ): Promise<void>;

  /**
   * Check if access token is expired or about to expire (within 5 minutes)
   */
  isTokenExpired(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<boolean>;

  /**
   * List all profile names, optionally filtered by API type and user_id
   */
  listProfiles(apiType?: AmazonApiType, userId?: string): Promise<string[]>;

  /**
   * Get default profile name for a given API type
   */
  getDefaultProfile(apiType: AmazonApiType, userId?: string): Promise<string | null>;

  /**
   * Set default profile for a given API type
   */
  setDefaultProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<void>;

  /**
   * Delete a profile
   */
  deleteProfile(profileName: string, apiType: AmazonApiType, userId?: string): Promise<void>;
}
