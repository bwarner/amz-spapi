import {
  AmazonApiType,
  AmazonCredentialProfile,
  AmazonCredentialProfileSchema,
  ICredentialRepository,
} from '@farvisionllc/models';

/**
 * AWS KMS encryption helper interface
 * Actual implementation should use AWS SDK KMS client
 */
export interface IKmsEncryption {
  encrypt(plaintext: string, keyId: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Couchbase-based credential store for web/API services
 * Uses AWS KMS for encryption of sensitive fields
 *
 * Collection structure in Couchbase:
 * - Bucket: seller_ops (or configured bucket)
 * - Scope: credentials
 * - Collection: profiles
 *
 * Document key format: {api_type}::{user_id}::{profile_name}
 * Example: ADS_API::auth0|123456::default
 */
export class CouchbaseCredentialStore implements ICredentialRepository {
  private collection: any; // Couchbase Collection type
  private kms: IKmsEncryption;
  private kmsKeyId: string;

  constructor(
    couchbaseCollection: any, // Type from couchbase SDK
    kmsEncryption: IKmsEncryption,
    kmsKeyId: string
  ) {
    this.collection = couchbaseCollection;
    this.kms = kmsEncryption;
    this.kmsKeyId = kmsKeyId;
  }

  /**
   * Generate document key for Couchbase
   */
  private getDocKey(profileName: string, apiType: AmazonApiType, userId?: string): string {
    const userPart = userId || 'default';
    return `${apiType}::${userPart}::${profileName}`;
  }

  /**
   * Generate key for default profile tracking
   */
  private getDefaultKey(apiType: AmazonApiType, userId?: string): string {
    const userPart = userId || 'default';
    return `DEFAULT::${apiType}::${userPart}`;
  }

  /**
   * Encrypt sensitive fields using AWS KMS
   */
  private async encryptSecrets(profile: AmazonCredentialProfile): Promise<{
    encryptedSecrets: string;
  }> {
    const secrets = {
      client_secret: profile.client_secret,
      refresh_token: profile.refresh_token,
      access_token: profile.access_token,
    };

    const encryptedSecrets = await this.kms.encrypt(
      JSON.stringify(secrets),
      this.kmsKeyId
    );

    return { encryptedSecrets };
  }

  /**
   * Decrypt sensitive fields using AWS KMS
   */
  private async decryptSecrets(encryptedSecrets: string): Promise<{
    client_secret: string;
    refresh_token?: string;
    access_token?: string;
  }> {
    const decrypted = await this.kms.decrypt(encryptedSecrets);
    return JSON.parse(decrypted);
  }

  async setProfile(profile: AmazonCredentialProfile): Promise<void> {
    // Validate with Zod
    const validated = AmazonCredentialProfileSchema.parse(profile);

    // Encrypt sensitive fields
    const { encryptedSecrets } = await this.encryptSecrets(validated);

    // Store document in Couchbase
    const docKey = this.getDocKey(
      validated.profile_name,
      validated.api_type,
      validated.user_id
    );

    const doc = {
      type: 'credential_profile',
      profile_name: validated.profile_name,
      api_type: validated.api_type,
      user_id: validated.user_id || null,

      // Non-sensitive fields
      client_id: validated.client_id,

      // Encrypted sensitive fields
      encrypted_secrets: encryptedSecrets,

      // Token expiration
      access_token_expires_at: validated.access_token_expires_at || null,

      // Amazon identifiers
      marketplace_id: validated.marketplace_id,
      region: validated.region || null,
      seller_id: validated.seller_id || null,
      advertiser_profile_id: validated.advertiser_profile_id || null,

      // Metadata
      created_at: validated.created_at,
      updated_at: validated.updated_at,
    };

    await this.collection.upsert(docKey, doc);

    // Check if this should be the default profile
    try {
      const defaultProfile = await this.getDefaultProfile(
        validated.api_type,
        validated.user_id
      );
      if (!defaultProfile) {
        // First profile for this user/api_type, set as default
        await this.setDefaultProfile(
          validated.profile_name,
          validated.api_type,
          validated.user_id
        );
      }
    } catch (error) {
      // Ignore errors setting default - not critical
    }
  }

  async getProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<AmazonCredentialProfile | null> {
    try {
      const docKey = this.getDocKey(profileName, apiType, userId);
      const result = await this.collection.get(docKey);
      const doc = result.content;

      // Decrypt sensitive fields
      const secrets = await this.decryptSecrets(doc.encrypted_secrets);

      return AmazonCredentialProfileSchema.parse({
        profile_name: doc.profile_name,
        api_type: doc.api_type,
        user_id: doc.user_id,
        client_id: doc.client_id,
        client_secret: secrets.client_secret,
        refresh_token: secrets.refresh_token,
        access_token: secrets.access_token,
        access_token_expires_at: doc.access_token_expires_at,
        marketplace_id: doc.marketplace_id,
        region: doc.region,
        seller_id: doc.seller_id,
        advertiser_profile_id: doc.advertiser_profile_id,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      });
    } catch (error: any) {
      if (error.name === 'DocumentNotFoundError') {
        return null;
      }
      throw error;
    }
  }

  async updateAccessToken(
    profileName: string,
    apiType: AmazonApiType,
    accessToken: string,
    expiresIn: number,
    userId?: string
  ): Promise<void> {
    // Get existing profile
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile) {
      throw new Error(`Profile ${profileName} (${apiType}) not found`);
    }

    // Update token and expiration
    profile.access_token = accessToken;
    profile.access_token_expires_at = Date.now() + expiresIn * 1000;
    profile.updated_at = Date.now();

    // Save back
    await this.setProfile(profile);
  }

  async isTokenExpired(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<boolean> {
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile?.access_token_expires_at) {
      return true;
    }

    const bufferTime = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= profile.access_token_expires_at - bufferTime;
  }

  async listProfiles(apiType?: AmazonApiType, userId?: string): Promise<string[]> {
    // Build N1QL query
    const bucketName = this.collection.scope.bucket.name;
    const scopeName = this.collection.scope.name;
    const collectionName = this.collection.name;

    let query = `
      SELECT DISTINCT profile_name
      FROM \`${bucketName}\`.\`${scopeName}\`.\`${collectionName}\`
      WHERE type = 'credential_profile'
    `;

    const params: any = {};

    if (apiType) {
      query += ' AND api_type = $apiType';
      params.apiType = apiType;
    }

    if (userId !== undefined) {
      query += ' AND user_id = $userId';
      params.userId = userId || null;
    }

    query += ' ORDER BY profile_name';

    const result = await this.collection.scope.query(query, { parameters: params });
    return result.rows.map((row: any) => row.profile_name);
  }

  async getDefaultProfile(apiType: AmazonApiType, userId?: string): Promise<string | null> {
    try {
      const docKey = this.getDefaultKey(apiType, userId);
      const result = await this.collection.get(docKey);
      return result.content.profile_name;
    } catch (error: any) {
      if (error.name === 'DocumentNotFoundError') {
        return null;
      }
      throw error;
    }
  }

  async setDefaultProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<void> {
    // Verify profile exists
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile) {
      throw new Error(`Profile ${profileName} (${apiType}) not found`);
    }

    const docKey = this.getDefaultKey(apiType, userId);
    await this.collection.upsert(docKey, {
      type: 'default_profile',
      api_type: apiType,
      user_id: userId || null,
      profile_name: profileName,
      updated_at: Date.now(),
    });
  }

  async deleteProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<void> {
    const docKey = this.getDocKey(profileName, apiType, userId);
    await this.collection.remove(docKey);

    // Clear default if this was the default profile
    const defaultProfile = await this.getDefaultProfile(apiType, userId);
    if (defaultProfile === profileName) {
      const defaultKey = this.getDefaultKey(apiType, userId);
      try {
        await this.collection.remove(defaultKey);
      } catch (error) {
        // Ignore if already deleted
      }

      // Set a new default if other profiles exist
      const remaining = await this.listProfiles(apiType, userId);
      if (remaining.length > 0) {
        await this.setDefaultProfile(remaining[0], apiType, userId);
      }
    }
  }
}
