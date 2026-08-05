/**
 * Seller credential profiles, read from behind the private API (#55).
 *
 * The first step of moving the credential slice out of the Vercel runtime.
 * This function answers questions *about* credentials — which connections a
 * seller has, which marketplace each covers, whether one is usable — without
 * ever handling the credential itself. It does not decrypt, and it holds no
 * KMS grant, so there is no path through it that produces a plaintext secret.
 *
 * Minting access tokens is the next step and lands here too. Keeping the read
 * side separate first means the seam, the routes and the authorization are
 * proven before any secret depends on them.
 *
 * The whole security argument rests on one thing: the caller's identity comes
 * from the JWT the gateway verified, and from nowhere else. See `subjectOf`.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { executeQuery, getDocument } from '@amz-spapi/couchbase-utils';
import { useSecretsManagerConnection } from '@amz-spapi/couchbase-secrets';
import {
  CREDENTIALS_COLLECTION,
  CREDENTIALS_DOMAIN,
  credentialDocKey,
  defaultProfileDocKey,
  toPublicProfile,
  type AmazonApiType,
  type PublicCredentialProfile,
  type StoredCredentialProfile,
} from '@farvisionllc/models';

const logger = new Logger({ serviceName: 'credentials' });

/**
 * Take the whole Couchbase connection from Secrets Manager.
 *
 * At module scope so it runs once during init, and so the fetched login is
 * cached for the container's life rather than per request — a Lambda
 * environment variable is not a secret, but a fetch per operation would be
 * absurd. See `@amz-spapi/couchbase-secrets`.
 */
useSecretsManagerConnection();

/**
 * The slice of the API Gateway event this depends on.
 *
 * Hand-written rather than pulled from `@types/aws-lambda`, matching
 * `apps/lambdas/me`: this is the entire contract, and writing it out makes the
 * dependency on `claims.sub` impossible to miss.
 */
export type CredentialsEvent = {
  routeKey?: string;
  rawPath?: string;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    http?: { method?: string };
    authorizer?: { jwt?: { claims?: Record<string, string | undefined> } };
  };
};

export type LambdaResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * Who is asking, according to the gateway.
 *
 * The only source of identity in this function. It is deliberately NOT a path
 * parameter, a query string or a body field: every one of those is chosen by
 * the caller, so reading a user id from one would let anyone request anyone
 * else's credentials by editing a URL. The gateway checked the signature,
 * issuer, audience and expiry before this ran, so `sub` is the one value here
 * that an attacker cannot set.
 *
 * Undefined means the authorizer did not run — the route was left unprotected,
 * or the function was invoked directly. Either way the request is refused
 * rather than served with an unproven identity.
 */
export function subjectOf(event: CredentialsEvent | undefined) {
  return event?.requestContext?.authorizer?.jwt?.claims?.['sub'];
}

/**
 * An error message with any response body cut off.
 *
 * The data layer reports a failure as `Couchbase Data API 500: {…}` with the
 * raw body appended, and for this collection that body is the credential
 * document — `encrypted_secrets` and all. Logging the message whole puts
 * credential material into CloudWatch, where it is retained and readable by
 * anyone with log access.
 *
 * Everything up to the first brace is the diagnostic part — the operation and
 * the status — and everything after it is the document. Keeping only the
 * former is enough to tell what failed without recording what it held.
 */
export function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const bodyStart = message.search(/[{[]/);
  return bodyStart === -1
    ? message
    : `${message.slice(0, bodyStart).trim()} [body redacted]`;
}

const json = (statusCode: number, payload: unknown): LambdaResult => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

/**
 * A stored profile as the outside world may see it.
 *
 * `has_refresh_token` is read from the document rather than inferred. A
 * document written before #55 does not carry it, and guessing either way is
 * worse than admitting the gap: `false` shows a working connection as broken,
 * `true` sends the user into a flow that fails at Amazon. Absent stays absent,
 * and the caller decides what to do about it.
 */
function publicView(
  stored: StoredCredentialProfile
): PublicCredentialProfile & { has_refresh_token_known: boolean } {
  const known = typeof stored.has_refresh_token === 'boolean';
  return {
    ...toPublicProfile(stored, {
      hasRefreshToken: stored.has_refresh_token ?? false,
    }),
    has_refresh_token_known: known,
  };
}

/**
 * Every profile belonging to one user.
 *
 * Filtered on `user_id` as a bound parameter rather than by interpolating the
 * subject into a key pattern. An Auth0 subject is opaque and arrives from a
 * token, not from us; building a `LIKE` pattern out of it would make `%` in a
 * subject match other users' documents.
 */
export async function listProfiles(
  userId: string,
  apiType?: AmazonApiType
): Promise<Array<ReturnType<typeof publicView>>> {
  const result = await executeQuery<StoredCredentialProfile>(
    CREDENTIALS_DOMAIN,
    `SELECT p.*
       FROM \`${CREDENTIALS_DOMAIN}_${CREDENTIALS_COLLECTION}\` AS p
      WHERE p.user_id = $userId
        AND p.api_type IS NOT MISSING
        ${apiType ? 'AND p.api_type = $apiType' : ''}
        AND p.\`deleted\` IS MISSING`,
    { parameters: apiType ? { userId, apiType } : { userId } }
  );

  return result.rows.map(publicView);
}

export async function getProfile(
  userId: string,
  apiType: AmazonApiType,
  profileName: string
): Promise<ReturnType<typeof publicView> | null> {
  const stored = await getDocument<StoredCredentialProfile>(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    // Built from the verified subject, so a caller cannot name another user's
    // document however they spell the path parameters.
    credentialDocKey(profileName, apiType, userId)
  );

  if (!stored || stored.deleted) return null;
  return publicView(stored);
}

export async function getDefaultProfileName(
  userId: string,
  apiType: AmazonApiType
): Promise<string | null> {
  const doc = await getDocument<{ profileName?: string }>(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    defaultProfileDocKey(apiType, userId)
  );
  return doc?.profileName ?? null;
}

/** Reject anything that is not one of the two API types. */
function parseApiType(value: string | undefined): AmazonApiType | undefined {
  return value === 'SP_API' || value === 'ADS_API' ? value : undefined;
}

export async function handler(event?: CredentialsEvent): Promise<LambdaResult> {
  const userId = subjectOf(event);
  if (!userId) {
    return json(401, {
      error: 'Unauthenticated',
      detail: 'No verified subject on the request.',
    });
  }

  const apiTypeParam =
    event?.pathParameters?.['apiType'] ??
    event?.queryStringParameters?.['apiType'];
  const profileName = event?.pathParameters?.['profileName'];

  try {
    if (profileName) {
      const apiType = parseApiType(apiTypeParam);
      if (!apiType) {
        return json(400, {
          error: 'BadRequest',
          detail: `Unknown apiType "${apiTypeParam}". Expected SP_API or ADS_API.`,
        });
      }

      const profile = await getProfile(userId, apiType, profileName);
      return profile
        ? json(200, profile)
        : json(404, {
            error: 'NotFound',
            detail: 'No such credential profile.',
          });
    }

    // A bad apiType on the list route filters to nothing rather than erroring,
    // so it is rejected here too — an empty list reads as "no connections",
    // which is a different and more alarming answer than "you asked wrongly".
    if (apiTypeParam && !parseApiType(apiTypeParam)) {
      return json(400, {
        error: 'BadRequest',
        detail: `Unknown apiType "${apiTypeParam}". Expected SP_API or ADS_API.`,
      });
    }

    const apiType = parseApiType(apiTypeParam);
    const [profiles, spDefault, adsDefault] = await Promise.all([
      listProfiles(userId, apiType),
      getDefaultProfileName(userId, 'SP_API'),
      getDefaultProfileName(userId, 'ADS_API'),
    ]);

    return json(200, {
      profiles,
      defaults: { SP_API: spDefault, ADS_API: adsDefault },
    });
  } catch (error) {
    // Redacted, not raw. A data-layer error appends the response body, and for
    // this collection that body IS the credential document — logging it whole
    // writes credential material to CloudWatch.
    logger.error('credential read failed', {
      userId,
      error: redactErrorMessage(error),
    });
    return json(502, {
      error: 'UpstreamFailure',
      detail: 'Could not read credential profiles.',
    });
  }
}
