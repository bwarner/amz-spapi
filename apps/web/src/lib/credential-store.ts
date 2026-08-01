/**
 * Couchbase credential store for the web app.
 *
 * Secrets are encrypted under KMS before they reach the database and decrypted
 * on the way out, so a caller sees a plain `AmazonCredentialProfile` and never
 * handles ciphertext (#11). What is stored is a different shape from what is
 * returned: `client_secret`, `refresh_token` and `access_token` are replaced by
 * a single `encrypted_secrets` blob.
 *
 * There is no path that reads a plaintext profile. A document written before
 * encryption fails loudly and names the migration rather than being read as-is
 * — a store that accepts both would leave plaintext working indefinitely, which
 * is the state this exists to end.
 */
import {
  getDocument,
  upsertDocument,
  deleteDocument,
  executeQuery,
  collectionName,
} from '@amz-spapi/couchbase-utils';
import type {
  AmazonApiType,
  AmazonCredentialProfile,
  ICredentialRepository,
} from '@farvisionllc/models';
import {
  decryptSecrets,
  encryptSecrets,
  type CredentialContext,
} from './credential-encryption';

const SCOPE = 'credentials';
const COLLECTION = 'profiles';

/**
 * A profile as it exists in Couchbase: metadata in the clear, secrets not.
 *
 * The clear fields are the ones queries filter and list on. None of them is a
 * credential.
 */
export type StoredProfile = Omit<
  AmazonCredentialProfile,
  'client_secret' | 'refresh_token' | 'access_token'
> & {
  encrypted_secrets: string;
  deleted?: boolean;
};

function contextOf(profile: {
  profile_name: string;
  api_type: AmazonApiType;
  user_id?: string;
}): CredentialContext {
  return {
    userId: profile.user_id,
    apiType: profile.api_type,
    profileName: profile.profile_name,
  };
}

function getDocKey(
  profileName: string,
  apiType: AmazonApiType,
  userId?: string
): string {
  const userPart = userId || 'default';
  return `${apiType}::${userPart}::${profileName}`;
}

function getDefaultKey(apiType: AmazonApiType, userId?: string): string {
  const userPart = userId || 'default';
  return `DEFAULT::${apiType}::${userPart}`;
}

class WebCredentialStore implements ICredentialRepository {
  async setProfile(profile: AmazonCredentialProfile): Promise<void> {
    const key = getDocKey(
      profile.profile_name,
      profile.api_type,
      profile.user_id
    );

    // Destructured out rather than deleted afterwards, so a secret cannot
    // survive into the stored document by being forgotten here.
    const { client_secret, refresh_token, access_token, ...metadata } = profile;

    const stored: StoredProfile = {
      ...metadata,
      updated_at: Date.now(),
      encrypted_secrets: await encryptSecrets(
        { client_secret, refresh_token, access_token },
        contextOf(profile)
      ),
    };

    await upsertDocument(SCOPE, COLLECTION, key, stored);
  }

  async getProfile(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<AmazonCredentialProfile | null> {
    const key = getDocKey(profileName, apiType, userId);
    const doc = await getDocument<StoredProfile>(SCOPE, COLLECTION, key);
    if (!doc || doc.deleted) return null;

    if (!doc.encrypted_secrets) {
      // Written before #11. Reading it would mean handling plaintext secrets
      // on a path that is supposed to have none, so refuse and say what fixes
      // it.
      throw new Error(
        `Credential profile "${profileName}" (${apiType}) predates encryption ` +
          `and has no encrypted_secrets. Run: npx tsx apps/web/scripts/encrypt-credentials.ts`
      );
    }

    const secrets = await decryptSecrets(doc.encrypted_secrets, contextOf(doc));

    // Shaped back into what callers expect; `encrypted_secrets` is an artefact
    // of storage and has no business leaving this file.
    const {
      encrypted_secrets: _ciphertext,
      deleted: _deleted,
      ...metadata
    } = doc;
    return { ...metadata, ...secrets };
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

  async listProfiles(
    apiType?: AmazonApiType,
    userId?: string
  ): Promise<string[]> {
    const userPart = userId || 'default';
    // Use N1QL to find all profiles for this user matching the key pattern
    // Keys are: {apiType}::{userId}::{profileName}
    const prefix = apiType ? `${apiType}::${userPart}::%` : `%::${userPart}::%`;

    try {
      const result = await executeQuery<{ profile_name: string }>(
        SCOPE,
        `SELECT profile_name
         FROM \`${collectionName(SCOPE, COLLECTION)}\`
         WHERE META().id LIKE $prefix
         AND \`deleted\` IS MISSING`,
        { parameters: { prefix } }
      );
      return result.rows.map((r) => r.profile_name).filter(Boolean);
    } catch {
      // Fallback for when query service isn't available: check known default profile
      const profile = await this.getProfile(
        'default',
        apiType || 'SP_API',
        userId
      );
      return profile ? [profile.profile_name] : [];
    }
  }

  async listFullProfiles(
    apiType?: AmazonApiType,
    userId?: string
  ): Promise<AmazonCredentialProfile[]> {
    const userPart = userId || 'default';
    const prefix = apiType ? `${apiType}::${userPart}::%` : `%::${userPart}::%`;

    try {
      const result = await executeQuery<AmazonCredentialProfile>(
        SCOPE,
        `SELECT profile_name, api_type, marketplace_id, region, seller_id, advertiser_profile_id, created_at, updated_at
         FROM \`${collectionName(SCOPE, COLLECTION)}\`
         WHERE META().id LIKE $prefix
         AND \`deleted\` IS MISSING`,
        { parameters: { prefix } }
      );
      return result.rows;
    } catch {
      const profile = await this.getProfile(
        'default',
        apiType || 'SP_API',
        userId
      );
      return profile ? [profile] : [];
    }
  }

  async getDefaultProfile(
    apiType: AmazonApiType,
    userId?: string
  ): Promise<string | null> {
    const key = getDefaultKey(apiType, userId);
    const doc = await getDocument<{ profileName: string }>(
      SCOPE,
      COLLECTION,
      key
    );
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
