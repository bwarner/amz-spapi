# couchbase-secrets

The Couchbase cluster login, fetched from AWS Secrets Manager at runtime.

Register once at module scope in a Lambda:

```ts
import { useSecretsManagerConnection } from '@amz-spapi/couchbase-secrets';

useSecretsManagerConnection();
```

It installs a provider into `@amz-spapi/couchbase-utils`, which otherwise reads
the five `CB_*` variables from the environment.

The secret holds the **whole connection** — `dataApiUrl`, `bucket`, `scope`,
`username`, `password` — because they change as one unit: a rebuilt cluster has
a new hostname _and_ new users. One write moves an environment, with no deploy.
Create and rotate it with `scripts/couchbase-secret.sh`.

## Why this is a separate package

So `@aws-sdk/client-secrets-manager` lives somewhere the Next.js app never
imports. Branching inside `couchbase-utils` would not be enough: even a dynamic
`import()` is resolved by Next's bundler whether or not the branch runs.

## Why none of it is an environment variable

A Lambda environment variable is **not a secret**. It is written into the
CloudFormation template, shown in the console, and returned by
`GetFunctionConfiguration` to anyone with read access on the function.

## Configuration

| Variable                                                                 | Required                | Purpose                                             |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------- |
| `CB_CREDENTIALS_SECRET_ID`                                               | on AWS                  | Secret **name**, holding all five fields            |
| `CB_DATA_API_URL`, `CB_BUCKET`, `CB_SCOPE`, `CB_USERNAME`, `CB_PASSWORD` | `sam local invoke` only | Fallback when no secret id is set — never calls AWS |
| `CB_SECRET_TTL_MS`                                                       | no                      | Cache lifetime, default 10 minutes                  |

## Caching

Module scope, so the fetched login survives between invocations for the
container's life. Without it every Couchbase operation would call Secrets
Manager — a single `credentials` request makes three, a `sync-worker` run makes
thousands.

**Safe here for a specific reason, which does not generalise.** This credential
is per _stage_: every invocation of every function in an environment uses the
same cluster login, so one container reusing it across two users' requests hands
the second exactly what it would have fetched anyway. Caching anything
_per-user_ at module scope — a seller's access token, a decrypted profile —
would bleed between requests, because Lambda reuses one container for many
callers. The test is whether the cached value depends on who is asking.

What is cached is the **promise**, not the resolved value, so concurrent
operations on a cold container collapse into one `GetSecretValue` rather than
one each. A rejected fetch is not cached, so a transient AWS error does not
poison the container for the rest of the TTL.

The TTL exists for rotation: cached forever, a warm container would keep
presenting a rotated-away password until it happened to be recycled.
`invalidateCachedConnection()` is exported for the better answer — refetching
when the cluster rejects the credential — which needs a retry-on-401 wrapper in
`couchbase-utils` first. See
[ADR-0010](../../docs/adr/0010-lambdas-reach-couchbase-over-the-data-api.md).
