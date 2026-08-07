import {
  LWA_TOKEN_ENDPOINTS,
  LwaTokenResponseSchema,
  type AmazonRegion,
} from '@farvisionllc/models';

/**
 * Talking to Login with Amazon, in the one place that holds the client secret (#55).
 *
 * Two grants use this — `authorization_code` when an account is first connected
 * and `refresh_token` on every mint afterwards — and they differ only in the
 * form fields. Sharing the transport is not about saving ten lines: it is about
 * the error handling. The request body contains the client secret, so nothing
 * here may log a request, and Amazon's error body may echo what it was sent, so
 * only the error CODE may be passed on. Two copies of that reasoning would
 * become one copy of that reasoning and one leak.
 */

/** Amazon is not slow at this. A hung exchange must not eat the whole budget. */
const TIMEOUT_MS = 10_000;

/** What the HTTP layer should answer with, and why. */
export type ServiceFailure = {
  status: number;
  error: string;
  detail: string;
};

export type LwaTokens = {
  accessToken: string;
  /** Present on an authorization_code grant; only sometimes on a refresh. */
  refreshToken?: string;
  /** Unix ms, computed here so no caller has to remember `expires_in` is seconds. */
  expiresAt: number;
};

export type LwaResult =
  | { ok: true; tokens: LwaTokens }
  | { ok: false; failure: ServiceFailure };

/**
 * What a rejected grant means, which is different for the two grant types.
 *
 * Amazon answers both with `invalid_grant`. For a refresh that means the seller
 * revoked us and the fix is to reconnect; for an authorization code it usually
 * means the code was already used or has expired — codes are single-use and
 * live about five minutes — and the fix is to start the flow again. Same code,
 * different instruction, and telling a user to reconnect when they just did is
 * how a support thread starts.
 */
type GrantKind = {
  /** For the error message. */
  subject: string;
  remedy: string;
  rejectedError: string;
};

const REFRESH: GrantKind = {
  subject: 'refresh token',
  remedy: 'Reconnect the account.',
  rejectedError: 'RefreshTokenRejected',
};

const AUTHORIZATION_CODE: GrantKind = {
  subject: 'authorization code',
  remedy:
    'The code is single-use and short-lived — start the connection again.',
  rejectedError: 'AuthorizationCodeRejected',
};

export function refreshGrant(
  region: AmazonRegion | undefined,
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<LwaResult> {
  return post(
    region,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    REFRESH
  );
}

export function authorizationCodeGrant(
  region: AmazonRegion | undefined,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<LwaResult> {
  return post(
    region,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      // Amazon requires this to match the one the authorize request used, and
      // checks it. It is not a second authorisation — the code is already bound
      // to that URI — which is why it is safe for the BFF to name its own.
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    AUTHORIZATION_CODE
  );
}

async function post(
  region: AmazonRegion | undefined,
  body: URLSearchParams,
  grant: GrantKind
): Promise<LwaResult> {
  const endpoint =
    LWA_TOKEN_ENDPOINTS[region ?? 'NA'] ?? LWA_TOKEN_ENDPOINTS.NA;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      failure: {
        status: 502,
        error: 'UpstreamFailure',
        // Names the endpoint, never the body — the body is the secret.
        detail: `Could not reach ${endpoint}: ${
          cause instanceof Error ? cause.name : 'unknown error'
        }.`,
      },
    };
  }

  if (!response.ok) {
    const amazonError = await readErrorCode(response);

    if (amazonError === 'invalid_grant') {
      return {
        ok: false,
        failure: {
          // Not 502: nothing failed and no retry helps. The user has to act.
          status: 409,
          error: grant.rejectedError,
          detail: `Amazon rejected the ${grant.subject}. ${grant.remedy}`,
        },
      };
    }

    return {
      ok: false,
      failure: {
        status: 502,
        error: 'LwaError',
        detail: `Amazon returned ${response.status}${
          amazonError ? ` (${amazonError})` : ''
        } for the token exchange.`,
      },
    };
  }

  const parsed = LwaTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        status: 502,
        error: 'LwaError',
        // The issue PATHS, not the data. A Zod error formatted with its input
        // would print the access token it is complaining about.
        detail:
          'Amazon returned a token response in an unexpected shape: ' +
          parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
      },
    };
  }

  return {
    ok: true,
    tokens: {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: Date.now() + parsed.data.expires_in * 1000,
    },
  };
}

/** Amazon's error CODE only. Never the description, which can echo input. */
async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}
