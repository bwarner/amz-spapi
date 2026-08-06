import {
  setConnectionProvider,
  type CouchbaseConnection,
} from '@amz-spapi/couchbase-utils';
import {
  getCachedSecret,
  invalidateSecret,
  requireStringFields,
} from './secret-cache.js';

/**
 * The Couchbase cluster login, fetched from Secrets Manager at runtime.
 *
 * Exists because a Lambda environment variable is NOT a secret: it is written
 * into the CloudFormation template, shown in the console, and returned by
 * `GetFunctionConfiguration` to anyone with read access on the function. The
 * other `CB_*` values are stage identifiers and travel as environment
 * variables; only the login comes from here.
 *
 * The caching, the TTL and the redaction rules are in `secret-cache.ts`, shared
 * with the Amazon OAuth reader.
 */

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
  const secretId = process.env['CB_CREDENTIALS_SECRET_ID'];
  if (secretId) invalidateSecret(secretId);
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

    return getCachedSecret(secretId, (parsed) =>
      requireStringFields(secretId, parsed, REQUIRED_KEYS)
    );
  });
}
