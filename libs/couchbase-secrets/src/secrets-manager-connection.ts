import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  setConnectionProvider,
  type CouchbaseConnection,
} from '@amz-spapi/couchbase-utils';

/**
 * The Couchbase cluster login, fetched from Secrets Manager at runtime.
 *
 * Exists because a Lambda environment variable is NOT a secret: it is written
 * into the CloudFormation template, shown in the console, and returned by
 * `GetFunctionConfiguration` to anyone with read access on the function. The
 * other four `CB_*` values are stage identifiers and travel as environment
 * variables; only the login comes from here.
 *
 * Separate from `@amz-spapi/couchbase-utils` so that `@aws-sdk/*` lives in a
 * package the Next.js app never imports.
 */

/**
 * Module scope, so it survives between invocations.
 *
 * Lambda freezes and thaws the execution environment rather than tearing it
 * down, so anything at module scope is reused for the container's life — which
 * is what makes caching here worth doing at all. Without it, EVERY Couchbase
 * operation would call Secrets Manager: a single `credentials` request does
 * three, and a `sync-worker` run does thousands.
 *
 * SAFE HERE, and the reason is specific rather than general. This credential is
 * per STAGE — every invocation of every function in an environment uses the
 * same cluster login, so one container reusing it across two users' requests
 * hands the second user exactly what it would have fetched anyway. That does
 * NOT generalise: caching anything per-user at module scope (a seller's access
 * token, a decrypted profile) would bleed between requests, because Lambda
 * reuses one container for many callers. The test that matters is whether the
 * cached value depends on who is asking. This one does not.
 */
let client: SecretsManagerClient | undefined;
let cached: { fetchedAt: number; value: Promise<CouchbaseConnection> } | null =
  null;

/**
 * How long a fetched login is reused.
 *
 * The cost argument, so the number is not arbitrary. `GetSecretValue` is
 * $0.05 per 10,000 calls. At this TTL a container alive for an hour makes six
 * calls; fifty warm containers over a day is ~7,200 calls, about $0.04. Without
 * caching the same load is millions of calls and a per-operation round trip
 * added to every read. The cache is the whole saving; the TTL barely moves it.
 *
 * What the TTL actually buys is rotation. Cached forever, a warm container
 * keeps presenting a rotated-away password until it happens to be recycled —
 * failing every request in the meantime with no way to recover. Ten minutes
 * bounds that.
 *
 * `invalidate()` below is the better answer and makes the TTL a backstop rather
 * than the mechanism; see its comment.
 */
const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * Everything the secret must hold.
 *
 * All five together rather than credentials alone: they change as one unit when
 * a cluster is rebuilt, so one write updates a whole environment and no deploy
 * is needed. The trade recorded in ADR-0010 is that the bucket and scope are no
 * longer visible in a `cdk diff` — acceptable because ADR-0005 gives each scope
 * its own database user, making a wrong scope fail closed with `access denied`
 * rather than silently reading another environment's data.
 */
const REQUIRED_KEYS = [
  'dataApiUrl',
  'bucket',
  'scope',
  'username',
  'password',
] as const;

function ttlMs(): number {
  const override = Number(process.env['CB_SECRET_TTL_MS']);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_TTL_MS;
}

/**
 * Forget the cached login so the next call refetches.
 *
 * Call this when the cluster rejects the credential — a 401 or 403 from the
 * Data API after a rotation is exactly the signal that the cached value is
 * stale, and refetching once beats waiting out the TTL while every request
 * fails. Wiring it to the Data API's auth-failure path is a follow-up (it needs
 * a retry-once-on-401 wrapper around the seven call sites in
 * `couchbase-utils`); until then the TTL is what recovers a rotation.
 */
export function invalidateCachedConnection(): void {
  cached = null;
}

async function fetchFromSecretsManager(
  secretId: string
): Promise<CouchbaseConnection> {
  client ??= new SecretsManagerClient({});

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  if (!response.SecretString) {
    // A binary secret is a different thing stored under the same name, which
    // usually means the wrong secret id rather than a corrupt one.
    throw new Error(
      `Secret "${secretId}" has no SecretString. It must be JSON holding ` +
        `${REQUIRED_KEYS.join(', ')}.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.SecretString);
  } catch {
    // Deliberately not including the parse error or the body. A JSON syntax
    // error quotes the text around the fault, and the text here is the
    // password.
    throw new Error(
      `Secret "${secretId}" is not valid JSON. It must hold ` +
        `${REQUIRED_KEYS.join(', ')}.`
    );
  }

  const fields = (parsed ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_KEYS.filter(
    (key) => typeof fields[key] !== 'string' || !fields[key]
  );
  if (missing.length) {
    // Names the missing keys, never the value of the ones that were present.
    throw new Error(
      `Secret "${secretId}" is missing ${missing.join(', ')}. It must hold ` +
        `${REQUIRED_KEYS.join(', ')} as strings.`
    );
  }

  return {
    dataApiUrl: fields['dataApiUrl'] as string,
    bucket: fields['bucket'] as string,
    scope: fields['scope'] as string,
    username: fields['username'] as string,
    password: fields['password'] as string,
  };
}

/**
 * Resolve the login, reusing an in-flight or recent fetch.
 *
 * The cached entry is the PROMISE, not the resolved value. On a cold container
 * several operations start concurrently and all of them ask; caching the value
 * would let every one of them miss and issue its own `GetSecretValue`, so the
 * first request after a cold start would pay for as many API calls as it makes
 * Couchbase operations. Caching the promise collapses them to one.
 *
 * A failed fetch is not cached — the entry is cleared on rejection so a
 * transient Secrets Manager error does not poison the container for the rest of
 * the TTL.
 */
function resolve(secretId: string): Promise<CouchbaseConnection> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttlMs()) {
    return cached.value;
  }

  const value = fetchFromSecretsManager(secretId).catch((error) => {
    if (cached?.value === value) cached = null;
    throw error;
  });

  cached = { fetchedAt: now, value };
  return value;
}

/**
 * Take the whole Couchbase connection from Secrets Manager.
 *
 * Called once at module scope by every Lambda that touches Couchbase, so the
 * registration happens during init rather than per request.
 */
export function useSecretsManagerConnection(): void {
  setConnectionProvider(async () => {
    const secretId = process.env['CB_CREDENTIALS_SECRET_ID'];

    if (!secretId) {
      // `sam local invoke` (ADR-0001) has no AWS credentials to call Secrets
      // Manager with, so the environment still works there.
      const fromEnv = {
        dataApiUrl: process.env['CB_DATA_API_URL'],
        bucket: process.env['CB_BUCKET'],
        scope: process.env['CB_SCOPE'],
        username: process.env['CB_USERNAME'],
        password: process.env['CB_PASSWORD'],
      };
      if (Object.values(fromEnv).every(Boolean)) {
        return fromEnv as CouchbaseConnection;
      }

      // Thrown from inside the provider rather than at registration, so the
      // failure arrives in the handler's error path with request context
      // instead of as an opaque Lambda init failure.
      throw new Error(
        'No Couchbase connection available. Set CB_CREDENTIALS_SECRET_ID to ' +
          'the Secrets Manager secret name (deployed), or CB_DATA_API_URL, ' +
          'CB_BUCKET, CB_SCOPE, CB_USERNAME and CB_PASSWORD (sam local invoke).'
      );
    }

    return resolve(secretId);
  });
}
