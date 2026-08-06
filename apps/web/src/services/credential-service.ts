import type { AmazonApiType } from '@farvisionllc/models';
import { auth0 } from '../lib/auth0';
import {
  ApiError,
  ApiService,
  privateApiUrl,
  type ApiServiceOptions,
} from './api-service';

/**
 * Credentials as the private API reports them (#55).
 *
 * The BFF's half of moving the credential slice off Vercel. What comes back
 * describes connections; it never contains one. There is no method here that
 * returns a refresh token, a client secret or an access token, and that is the
 * point rather than an oversight — the Lambda is where those live now, and a
 * method that returned one would put the plaintext back in the runtime this
 * slice exists to remove it from.
 *
 * The user id is not a parameter anywhere below. The Lambda takes it from the
 * verified JWT, so the caller's identity travels in the token and cannot be
 * chosen by whoever builds the URL.
 */

/**
 * One connection, without the credential.
 *
 * Mirrors `PublicCredentialProfile` in `@farvisionllc/models`, plus the flag
 * the Lambda adds. Declared structurally rather than imported wholesale so a
 * change to storage shows up here as a type error rather than silently
 * widening what the BFF believes it can read.
 */
export type CredentialProfileView = {
  profile_name: string;
  api_type: AmazonApiType;
  user_id?: string;
  client_id: string;
  marketplace_id: string;
  region?: 'NA' | 'EU' | 'FE';
  seller_id?: string;
  advertiser_profile_id?: string;
  created_at: number;
  updated_at: number;
  /** Whether a refresh token is held. Never the token. */
  has_refresh_token: boolean;
  /**
   * False for a profile written before #55, whose stored document carries no
   * flag. `has_refresh_token` is then a default rather than a fact, and a
   * caller that cares about the difference has to check this.
   */
  has_refresh_token_known: boolean;
  access_token_expires_at?: number;
};

export type CredentialListing = {
  profiles: CredentialProfileView[];
  defaults: { SP_API: string | null; ADS_API: string | null };
};

export class CredentialService extends ApiService {
  /**
   * Every connection the caller has, with the default for each API.
   *
   * Page-shaped: one call answers the whole connections view, per ADR-0007.
   */
  async list(apiType?: AmazonApiType): Promise<CredentialListing> {
    const query = apiType ? `?apiType=${encodeURIComponent(apiType)}` : '';
    return this.request<CredentialListing>(`/credentials${query}`);
  }

  /** One connection, or null when the caller has no such profile. */
  async get(
    apiType: AmazonApiType,
    profileName: string
  ): Promise<CredentialProfileView | null> {
    try {
      return await this.request<CredentialProfileView>(
        `/credentials/${encodeURIComponent(apiType)}/${encodeURIComponent(
          profileName
        )}`
      );
    } catch (error) {
      // A profile that is not there is an ordinary answer to "do I have this
      // connection", not a failure the caller should handle as one. Every
      // other status still throws.
      if (error instanceof ApiError && error.upstreamStatus === 404) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * A `CredentialService` bound to the current request's user.
 *
 * Same contract as `identityService`: throws `ApiError(401)` when the session
 * cannot mint an access token for the API audience.
 */
export async function credentialService(
  overrides: Partial<ApiServiceOptions> = {}
): Promise<CredentialService> {
  return new CredentialService({
    apiUrl: overrides.apiUrl ?? privateApiUrl(),
    accessToken: overrides.accessToken ?? (await currentAccessToken()),
    fetchImpl: overrides.fetchImpl,
  });
}

async function currentAccessToken(): Promise<string> {
  try {
    const { token } = await auth0.getAccessToken();
    if (!token) {
      throw new ApiError(401, 'The session produced no access token.');
    }
    return token;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;

    throw new ApiError(
      401,
      'Could not get an access token for the private API. The session may ' +
        'have expired, or AUTH0_AUDIENCE may not match the API identifier.',
      undefined,
      { cause }
    );
  }
}
