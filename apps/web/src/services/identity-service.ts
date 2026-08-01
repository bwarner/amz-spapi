import { auth0 } from '../lib/auth0';
import {
  ApiError,
  ApiService,
  privateApiUrl,
  type ApiServiceOptions,
} from './api-service';

/** What `GET /me` answers with. Mirrors `apps/lambdas/me`. */
export type Me = {
  userId: string;
  email?: string;
  name?: string;
  scopes: string[];
  service: string;
  stage: string;
  requestId?: string;
  at: string;
};

/**
 * Identity as the private API sees it (#54).
 *
 * One service per domain, so a route handler calls a method rather than
 * importing the data layer. This one exists to prove the authenticated hop:
 * what it returns is the set of claims API Gateway verified, which is the same
 * subject the BFF already has from the session — matching values are the
 * evidence that the round trip works.
 */
export class IdentityService extends ApiService {
  /**
   * The caller, according to the API.
   *
   * Page-shaped by construction: one call, everything the view needs. See
   * ADR-0007 for why that is the rule rather than a coincidence.
   */
  async getMe(): Promise<Me> {
    return this.request<Me>('/me');
  }
}

/**
 * An `IdentityService` bound to the current request's user.
 *
 * Call from a route handler or server action. Throws `ApiError(401)` when the
 * session cannot produce an access token for the API audience, which is what
 * an expired session or a missing `AUTH0_AUDIENCE` looks like from here.
 */
export async function identityService(
  overrides: Partial<ApiServiceOptions> = {}
): Promise<IdentityService> {
  return new IdentityService({
    apiUrl: overrides.apiUrl ?? privateApiUrl(),
    accessToken: overrides.accessToken ?? (await currentAccessToken()),
    fetchImpl: overrides.fetchImpl,
  });
}

/**
 * The user's access token for the private API.
 *
 * `getAccessToken` throws rather than returning null when there is no session
 * or the audience is unconfigured, and those are different problems with the
 * same symptom — a 401 the user cannot act on. Translating here means the
 * route handler sees one typed error instead of an Auth0 SDK exception.
 */
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
