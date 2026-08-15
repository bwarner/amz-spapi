/**
 * Seller credentials, behind the private API (#55).
 *
 * This function is where the credential slice lives now. It answers questions
 * *about* connections — which ones a seller has, which marketplace each covers,
 * whether one is usable — and it mints the short-lived access tokens that let a
 * caller act on one. What it never does is hand out the material: the refresh
 * token and the LWA client secret exist only inside this function, and only for
 * the length of one exchange with Amazon.
 *
 * That is the whole point. Before this, both sat in the Vercel runtime, where
 * the plaintext refresh token existed on every request that touched a
 * connection. The KMS grant and the Secrets Manager grant are now on this
 * function's role and nowhere else.
 *
 * The security argument rests on one thing: the caller's identity comes from
 * the JWT the gateway verified, and from nowhere else. See `subjectOf`.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { executeQuery, getDocument } from '@amz-spapi/couchbase-utils';
import { useSecretsManagerConnection } from '@amz-spapi/aws-secrets';
import { mintAccessToken } from './access-token.js';
import { connect, ConnectRequestSchema } from './connect.js';
import { disconnect } from './disconnect.js';
import {
  authorizeServiceMint,
  isServicePrincipal,
  SERVICE_MINT_ROUTE,
} from './service-principal.js';
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
 * absurd. See `@amz-spapi/aws-secrets`.
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
  /** Present on POST routes. API Gateway may base64-encode it. */
  body?: string | null;
  isBase64Encoded?: boolean;
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

/** The one route that produces a credential rather than describing one. */
export const ACCESS_TOKEN_ROUTE =
  'POST /credentials/{apiType}/{profileName}/access-token';

/** Where an OAuth authorization code is turned into a stored connection. */
export const CONNECT_ROUTE = 'POST /credentials/connect';

/** Where a connection is destroyed. */
export const DISCONNECT_ROUTE = 'DELETE /credentials/{apiType}/{profileName}';

/**
 * The request body, decoded.
 *
 * API Gateway base64-encodes a body it considers binary, which depends on the
 * content type the client sent — so a handler that reads `body` directly works
 * until somebody posts without a JSON content type, and then receives
 * base64 that fails to parse as JSON with an error about the wrong thing.
 */
function parseBody(event: CredentialsEvent | undefined): unknown {
  const raw = event?.body;
  if (!raw) return undefined;

  const text = event?.isBase64Encoded
    ? Buffer.from(raw, 'base64').toString('utf8')
    : raw;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Whether this request is asking for a token.
 *
 * `routeKey` is what API Gateway sends and is exact. The path fallback exists
 * for direct invocation — `sam local invoke` and the deploy check both build
 * events by hand — and is deliberately narrow: it requires POST as well as the
 * suffix, so no GET can reach the minting path by having a suggestive URL.
 */
function isAccessTokenRequest(event: CredentialsEvent | undefined): boolean {
  if (event?.routeKey) return event.routeKey === ACCESS_TOKEN_ROUTE;
  return (
    event?.requestContext?.http?.method === 'POST' &&
    (event?.rawPath ?? '').endsWith('/access-token')
  );
}

/**
 * Whether this request is asking to destroy a connection.
 *
 * The method is the whole distinction here — `DELETE` and `GET` share a path —
 * so the fallback insists on it rather than matching the path alone. Getting
 * this wrong in the permissive direction would delete a credential in answer to
 * a read.
 */
function isDisconnectRequest(event: CredentialsEvent | undefined): boolean {
  if (event?.routeKey) return event.routeKey === DISCONNECT_ROUTE;
  return event?.requestContext?.http?.method === 'DELETE';
}

/** Same rule, same reason, for the connect route. */
function isConnectRequest(event: CredentialsEvent | undefined): boolean {
  if (event?.routeKey) return event.routeKey === CONNECT_ROUTE;
  return (
    event?.requestContext?.http?.method === 'POST' &&
    (event?.rawPath ?? '').endsWith('/credentials/connect')
  );
}

/**
 * Whether this is the unattended mint route (#152).
 *
 * The fallback matches the FULL path rather than a suffix, unlike
 * `isAccessTokenRequest` — the two paths both end in `/access-token`, so a
 * suffix test would make them indistinguishable under direct invocation and the
 * more permissive of the two would win. Under API Gateway `routeKey` is exact
 * and the question does not arise.
 */
function isServiceMintRequest(event: CredentialsEvent | undefined): boolean {
  if (event?.routeKey) return event.routeKey === SERVICE_MINT_ROUTE;
  return (
    event?.requestContext?.http?.method === 'POST' &&
    (event?.rawPath ?? '').replace(/\/+$/, '') ===
      '/credentials/service/access-token'
  );
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
    // Both service checks come first, and they are a pair: the route decides
    // which kind of caller is expected, and each kind is refused on the other's
    // routes. Neither check is redundant — without the first a user token could
    // name someone else in a body, and without the second a machine token would
    // fall through to routes it has no business reaching.
    if (isServiceMintRequest(event)) {
      const authorized = await authorizeServiceMint({
        subject: userId,
        body: parseBody(event),
      });
      if (!authorized.ok) {
        logger.warn('refused a service mint', {
          actor: userId,
          error: authorized.failure.error,
        });
        return json(authorized.failure.status, {
          error: authorized.failure.error,
          detail: authorized.failure.detail,
        });
      }

      const { onBehalfOf, apiType, profileName } = authorized.request;
      const result = await mintAccessToken(onBehalfOf, apiType, profileName);

      // `actor` and `onBehalfOf` are separate fields on purpose. This is the
      // only record that a token was issued, and for unattended work the
      // question it has to answer is "which automated run acted for which
      // seller" — one merged id cannot answer it.
      if (result.ok) {
        logger.info('minted access token for a service principal', {
          actor: userId,
          onBehalfOf,
          apiType,
          profileName,
          sellerId: authorized.request.sellerId,
          domain: authorized.request.domain,
          refreshed: result.token.refreshed,
          expiresAt: result.token.expires_at,
        });
        return json(200, result.token);
      }

      logger.warn('could not mint access token for a service principal', {
        actor: userId,
        onBehalfOf,
        apiType,
        profileName,
        error: result.failure.error,
      });
      return json(result.failure.status, {
        error: result.failure.error,
        detail: result.failure.detail,
      });
    }

    // Mint-only. A machine token would otherwise reach these routes and be
    // treated as a user — harmless today, because `credentialDocKey` would look
    // up profiles the machine does not have and 404, but that is an accident of
    // the key layout rather than a rule. Stating the rule means a later change
    // to how documents are keyed cannot quietly turn it into a privilege.
    if (isServicePrincipal(userId)) {
      logger.warn('service principal reached a user route', {
        actor: userId,
        routeKey: event?.routeKey,
      });
      return json(403, {
        error: 'Forbidden',
        detail:
          'A service principal may only mint tokens, on ' +
          `"${SERVICE_MINT_ROUTE}".`,
      });
    }

    // Checked before the profile branch: `/credentials/connect` has no path
    // parameters, so it would otherwise fall through to the list route and
    // silently answer a connection attempt with a listing.
    if (isConnectRequest(event)) {
      const parsed = ConnectRequestSchema.safeParse(parseBody(event));
      if (!parsed.success) {
        return json(400, {
          error: 'BadRequest',
          // Field paths only. The body holds an authorization code, and a Zod
          // error formatted with its input would put it in the response and
          // then in whatever logs that.
          detail:
            'Malformed connect request: ' +
            parsed.error.issues
              .map((issue) => issue.path.join('.') || '(root)')
              .join(', '),
        });
      }

      const result = await connect(userId, parsed.data);

      if (result.ok) {
        logger.info('connected an amazon account', {
          userId,
          apiType: parsed.data.apiType,
          profiles: result.connected.profiles.length,
          default: result.connected.default,
        });
        return json(200, result.connected);
      }

      logger.warn('could not connect an amazon account', {
        userId,
        apiType: parsed.data.apiType,
        error: result.failure.error,
      });
      return json(result.failure.status, {
        error: result.failure.error,
        detail: result.failure.detail,
      });
    }

    if (profileName) {
      const apiType = parseApiType(apiTypeParam);
      if (!apiType) {
        return json(400, {
          error: 'BadRequest',
          detail: `Unknown apiType "${apiTypeParam}". Expected SP_API or ADS_API.`,
        });
      }

      if (isDisconnectRequest(event)) {
        const result = await disconnect(userId, apiType, profileName);
        if (!result.ok) {
          return json(result.failure.status, {
            error: result.failure.error,
            detail: result.failure.detail,
          });
        }

        // Info, because this is the audit trail for a credential being
        // destroyed — the one action here that is not reversible.
        logger.info('disconnected an amazon account', {
          userId,
          apiType,
          profileName,
          deleted: result.deleted,
          clearedDefault: result.clearedDefault,
        });
        return json(200, {
          disconnected: true,
          deleted: result.deleted,
          clearedDefault: result.clearedDefault,
        });
      }

      if (isAccessTokenRequest(event)) {
        const result = await mintAccessToken(userId, apiType, profileName);

        // Logged at info because this is the audit trail for every token this
        // service issues, and it is the only record that one was. The token
        // itself is not here and must never be: CloudWatch retains it and
        // anyone with log access can read it.
        if (result.ok) {
          logger.info('minted access token', {
            userId,
            apiType,
            profileName,
            refreshed: result.token.refreshed,
            expiresAt: result.token.expires_at,
          });
          return json(200, result.token);
        }

        logger.warn('could not mint access token', {
          userId,
          apiType,
          profileName,
          error: result.failure.error,
        });
        return json(result.failure.status, {
          error: result.failure.error,
          detail: result.failure.detail,
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
    // writes credential material to CloudWatch. A KMS or Secrets Manager
    // failure arrives here too, and those messages can quote what they were
    // handed.
    logger.error('credential request failed', {
      userId,
      error: redactErrorMessage(error),
    });
    return json(502, {
      error: 'UpstreamFailure',
      detail: 'The credential service could not complete this request.',
    });
  }
}
