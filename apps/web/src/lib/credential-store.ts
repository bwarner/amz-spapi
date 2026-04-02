/**
 * Simplified Couchbase credential store for the web app (v1).
 *
 * WARNING: This v1 implementation stores tokens WITHOUT KMS encryption.
 * This is acceptable for development only. Before production, implement
 * proper KMS encryption per GitHub issue #11.
 *
 * @see packages/credential-store/src/lib/couchbase-credential-store.ts for KMS version
 */
import { getDocument, upsertDocument, deleteDocument, executeQuery } from '@amz-spapi/couchbase-utils';
import type {
  AmazonApiType,
  AmazonCredentialProfile,
  ICredentialRepository,
} from '@farvisionllc/models';

const SCOPE = 'credentials';
const COLLECTION = 'profiles';

function getDocKey(profileName: string, apiType: AmazonApiType, userId?: string): string {
  const userPart = userId || 'default';
  return `${apiType}::${userPart}::${profileName}`;
}

function getDefaultKey(apiType: AmazonApiType, userId?: string): string {
  const userPart = userId || 'default';
  return `DEFAULT::${apiType}::${userPart}`;
}

class WebCredentialStore implements ICredentialRepository {
  async setProfile(profile: AmazonCredentialProfile): Promise<void> {
    const key = getDocKey(profile.profile_name, profile.api_type, profile.user_id);
    await upsertDocument(SCOPE, COLLECTION, key, {
      ...profile,
      updated_at: Date.now(),
    });
  }

  async getProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<AmazonCredentialProfile | null> {
    const key = getDocKey(profileName, apiType, userId);
    const doc = await getDocument<AmazonCredentialProfile & { deleted?: boolean }>(SCOPE, COLLECTION, key);
    if (!doc || doc.deleted) return null;
    return doc;
  }

  async updateAccessToken(
    profileName: string,
    apiType: AmazonApiType,
    accessToken: string,
    expiresIn: number,
    userId?: string
  ): Promise<void> {
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileName} (${apiType})`);
    }
    profile.access_token = accessToken;
    profile.access_token_expires_at = Date.now() + expiresIn * 1000;
    profile.updated_at = Date.now();
    await this.setProfile(profile);
  }

  async isTokenExpired(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<boolean> {
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile || !profile.access_token_expires_at) {
      return true;
    }
    // Consider expired if within 5 minutes of expiry
    return Date.now() > profile.access_token_expires_at - 5 * 60 * 1000;
  }

  async listProfiles(apiType?: AmazonApiType, userId?: string): Promise<string[]> {
    const userPart = userId || 'default';
    // Use N1QL to find all profiles for this user matching the key pattern
    // Keys are: {apiType}::{userId}::{profileName}
    const prefix = apiType
      ? `${apiType}::${userPart}::%`
      : `%::${userPart}::%`;

    try {
      const result = await executeQuery<{ profile_name: string }>(
        SCOPE,
        `SELECT profile_name
         FROM \`${COLLECTION}\`
         WHERE META().id LIKE $prefix
         AND \`deleted\` IS MISSING`,
        { parameters: { prefix } }
      );
      return result.rows.map((r) => r.profile_name).filter(Boolean);
    } catch {
      // Fallback for when query service isn't available: check known default profile
      const profile = await this.getProfile('default', apiType || 'SP_API', userId);
      return profile ? [profile.profile_name] : [];
    }
  }

  async listFullProfiles(apiType?: AmazonApiType, userId?: string): Promise<AmazonCredentialProfile[]> {
    const userPart = userId || 'default';
    const prefix = apiType
      ? `${apiType}::${userPart}::%`
      : `%::${userPart}::%`;

    try {
      const result = await executeQuery<AmazonCredentialProfile>(
        SCOPE,
        `SELECT profile_name, api_type, marketplace_id, region, seller_id, advertiser_profile_id, created_at, updated_at
         FROM \`${COLLECTION}\`
         WHERE META().id LIKE $prefix
         AND \`deleted\` IS MISSING`,
        { parameters: { prefix } }
      );
      return result.rows;
    } catch {
      const profile = await this.getProfile('default', apiType || 'SP_API', userId);
      return profile ? [profile] : [];
    }
  }

  async getDefaultProfile(apiType: AmazonApiType, userId?: string): Promise<string | null> {
    const key = getDefaultKey(apiType, userId);
    const doc = await getDocument<{ profileName: string }>(SCOPE, COLLECTION, key);
    return doc?.profileName ?? null;
  }

  async setDefaultProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<void> {
    const key = getDefaultKey(apiType, userId);
    await upsertDocument(SCOPE, COLLECTION, key, { profileName });
  }

  async deleteProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<void> {
    const key = getDocKey(profileName, apiType, userId);
    await deleteDocument(SCOPE, COLLECTION, key);

    // If this was the default profile, also clear the default pointer
    const defaultProfileName = await this.getDefaultProfile(apiType, userId);
    if (defaultProfileName === profileName) {
      const defaultKey = getDefaultKey(apiType, userId);
      await deleteDocument(SCOPE, COLLECTION, defaultKey);
    }
  }
}

// Singleton instance
let instance: WebCredentialStore | null = null;

export function getCredentialStore(): WebCredentialStore {
  if (!instance) {
    instance = new WebCredentialStore();
  }
  return instance;
}
