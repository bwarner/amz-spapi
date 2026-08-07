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
 * describes connections, or is a token that expires within the hour. There is
 * no method here that returns a refresh token or a client secret, and that is
 * the point rather than an oversight — those live in the Lambda now, and a
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

/**
 * A token for calling Amazon, and nothing that could produce another (#55).
 *
 * Short-lived by construction — roughly an hour, and always at least five
 * minutes of it left. `expires_at` is here so a caller can decide to re-request
 * before starting long work, rather than discovering the expiry as a 401
 * halfway through.
 */
export type AccessToken = {
  access_token: string;
  /** Unix ms. */
  expires_at: number;
  token_type: 'bearer';
  /** Whether the API exchanged a refresh token, or answered from its cache. */
  refreshed: boolean;
};

/**
 * Everything needed to redeem an Amazon authorization code (#55, step 3).
 *
 * No `userId`. The API takes the caller from the verified JWT, as it does
 * everywhere else here — and the OAuth `state` blob's own `userId` is ignored
 * on both sides, because state is a CSRF token rather than a claim about who is
 * connecting.
 */
export type ConnectRequest = {
  apiType: AmazonApiType;
  /** Single-use, expires in minutes, worthless without the client secret. */
  code: string;
  profileName: string;
  marketplaceId: string;
  /** Must match the one the authorize request used; Amazon checks it. */
  redirectUri: string;
  sellerId?: string;
};

/**
 * What was connected. One profile for SP-API, one per advertiser for Ads.
 *
 * Public views only — the refresh token this call just created is not in here,
 * and there is no shape of this response that would carry it.
 */
export type Connected = {
  profiles: CredentialProfileView[];
  default: string;
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

  /**
   * A short-lived access token for one connection.
   *
   * POST rather than GET because it is not a read: it may exchange a refresh
   * token at Amazon and write the result back. It is also the reason no cache
   * header ever belongs on this response.
   *
   * **A client built from this cannot refresh itself.** `SpApiClient` and
   * `AdClient` self-refresh on a 401 only when they hold the refresh token and
   * client secret, and by design the BFF holds neither. So a caller that gets a
   * 401 from Amazon mid-request must come back here for a new token and retry,
   * rather than expecting the client to recover on its own. That is the cost of
   * the plaintext not being here, and it is the intended trade.
   *
   * Named `mintAccessToken` rather than `accessToken` because `ApiService`
   * already has an `accessToken` — the CALLER'S Auth0 token, which is a
   * different credential entirely, and the two must not be reachable under one
   * name.
   */
  async mintAccessToken(
    apiType: AmazonApiType,
    profileName: string
  ): Promise<AccessToken> {
    return this.request<AccessToken>(
      `/credentials/${encodeURIComponent(apiType)}/${encodeURIComponent(
        profileName
      )}/access-token`,
      { method: 'POST' }
    );
  }

  /**
   * Forget a connection.
   *
   * A real delete, not a tombstone: the point of disconnecting is that the
   * refresh token stops existing. Idempotent — `deleted: false` means it was
   * already gone, which is a success, not a 404, so a double-click or a retried
   * request does not surface an error.
   */
  async disconnect(
    apiType: AmazonApiType,
    profileName: string
  ): Promise<{ deleted: boolean; clearedDefault: boolean }> {
    return this.request<{ deleted: boolean; clearedDefault: boolean }>(
      `/credentials/${encodeURIComponent(apiType)}/${encodeURIComponent(
        profileName
      )}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Redeem an authorization code and store the connection it produces.
   *
   * The BFF's side of the OAuth callback. What goes up is the code; what comes
   * back is a description of what was connected. The refresh token exists only
   * inside the Lambda, which is the entire point of the callback handing the
   * code over rather than redeeming it itself.
   */
  async connect(request: ConnectRequest): Promise<Connected> {
    return this.request<Connected>('/credentials/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
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
