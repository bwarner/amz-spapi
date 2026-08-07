# aws-secrets

Secrets fetched from AWS Secrets Manager at runtime, cached per container.

Two things need this, and they share the cache, the TTL and the redaction rules
rather than each having their own:

| Reader                          | Secret holds                                   | Used by                              |
| ------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `useSecretsManagerConnection()` | the whole Couchbase connection                 | every Lambda that touches Couchbase  |
| `getAmazonOAuthApp(apiType)`    | the LWA and Ads application client id + secret | `credentials`, to mint access tokens |

## The Couchbase connection

Register once at module scope in a Lambda:

```ts
import { useSecretsManagerConnection } from '@amz-spapi/aws-secrets';

useSecretsManagerConnection();
```

It installs a provider into `@amz-spapi/couchbase-utils`, which otherwise reads
the five `CB_*` variables from the environment.

The secret holds the **whole connection** — `dataApiUrl`, `bucket`, `scope`,
`username`, `password` — because they change as one unit: a rebuilt cluster has
a new hostname _and_ new users. One write moves an environment, with no deploy.
Create and rotate it with `scripts/couchbase-secret.sh`.

## The Amazon OAuth application credentials

```ts
import { getAmazonOAuthApp } from '@amz-spapi/aws-secrets';

const { clientId, clientSecret } = await getAmazonOAuthApp('SP_API');
```

`LWA_CLIENT_SECRET` and `ADS_CLIENT_SECRET` mint access tokens from **every**
connected seller's refresh token, which is why they are here and not in
`process.env` (#55). Both applications live in one secret because they are
registered and rotated together, and because a stage that had one and not the
other would fail at the first refresh rather than at deploy. Create and rotate
with `scripts/amazon-oauth-secret.sh`.

The client id comes from the secret too, though it is not itself secret: taking
the id from the profile document and the secret from here would, for a profile
connected under a since-replaced application, present Amazon with a mismatched
pair and get back `invalid_client` — with nothing in the message pointing at
where the two halves diverged.

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
| `CB_CREDENTIALS_SECRET_ID`                                               | on AWS                  | Secret **name**, holding all five Couchbase fields  |
| `AMAZON_OAUTH_SECRET_ID`                                                 | to mint tokens          | Secret **name**, holding both LWA applications      |
| `CB_DATA_API_URL`, `CB_BUCKET`, `CB_SCOPE`, `CB_USERNAME`, `CB_PASSWORD` | `sam local invoke` only | Fallback when no secret id is set — never calls AWS |
| `CB_SECRET_TTL_MS`                                                       | no                      | Cache lifetime for every secret, default 10 minutes |

## Caching

Module scope, so a fetched secret survives between invocations for the
container's life. Without it every Couchbase operation would call Secrets
Manager — a single `credentials` request makes three, a `sync-worker` run makes
thousands.

**Safe here for a specific reason, which does not generalise.** Everything
cached is per _stage_: the cluster login, our own application's client secret.
Every invocation of every function in an environment uses the same values, so
one container reusing an entry across two users' requests hands the second
exactly what it would have fetched anyway. Caching anything _per-user_ here — a
seller's access token, a decrypted profile — would bleed between requests,
because Lambda reuses one container for many callers. The test is whether the
cached value depends on who is asking.

What is cached is the **promise**, not the resolved value, so concurrent
operations on a cold container collapse into one `GetSecretValue` rather than
one each. A rejected fetch is not cached, so a transient AWS error does not
poison the container for the rest of the TTL.

The TTL exists for rotation: cached forever, a warm container would keep
presenting a rotated-away password until it happened to be recycled.
`invalidateSecret()` is the better answer — refetching when the thing the secret
authenticates against rejects it — which needs a retry-on-401 wrapper in
`couchbase-utils` first. See
[ADR-0010](../../docs/adr/0010-lambdas-reach-couchbase-over-the-data-api.md).
