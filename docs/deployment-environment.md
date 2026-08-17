# Deployment environment contract

Every environment variable the deployed web app needs, and **where its value
comes from**. Vercel's dashboard holds the values; this file is the record of
what must be set and why, because nothing else in the repository says so.

`vercel env pull` reproduces values onto a machine that is already linked to the
project. It does not help if the project is rebuilt, and it tells you nothing
about which of forty variables actually matters. That is what this is for.

> Values are never committed here. Secrets live in Vercel; identifiers that are
> already public (account ids, ARNs, bucket names) are written out because
> hiding them buys nothing and guessing them costs time.

## AWS access

The deployed app holds **no AWS credential**. Vercel signs a short-lived OIDC
token per deployment and STS exchanges it for temporary credentials
([ADR-0002](adr/0002-aws-account-topology.md), and
`infra/aws/lib/vercel-access-stack.ts`).

| Variable       | Production                                             | Source                                                   |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `AWS_ROLE_ARN` | `arn:aws:iam::108248327073:role/sellavant-prod-vercel` | `VercelRoleArn` output of `<app>-<stage>-vercel-access`  |
| `AWS_REGION`   | `us-east-1`                                            | `WebEnvAwsRegion` output of `<app>-<stage>-media-assets` |

There must be **no** `AWS_PROFILE` and no `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`. A profile name sends the SDK looking for a
`~/.aws/config` that does not exist in a Vercel function, and a static key pair
would be a permanent unrotated credential that can decrypt every seller's
refresh token.

Vercel **OIDC Federation must be enabled** on the project. Without it no
`VERCEL_OIDC_TOKEN` is issued and every AWS call fails with no credential found.
Check by pulling the environment and looking for `VERCEL_OIDC_TOKEN`.

## Stored credential encryption (#11)

| Variable                | Production                         | Source                                                          |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `KMS_CREDENTIAL_KEY_ID` | `alias/sellavant-prod-credentials` | `CredentialsKeyAlias` output of `<app>-<stage>-credentials-key` |

The alias, not the ARN: it survives key replacement. Needed to **write** a
credential — connecting an account, and every token refresh. Reads do not need
it, because KMS resolves the key from the ciphertext, which is also why key
rotation needs no re-encrypt step.

## Media assets

| Variable              | Production                                           | Source                                           |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `MEDIA_ASSETS_BUCKET` | `sellavant-media-assets-prod-108248327073-us-east-1` | `MediaAssetsBucketName` output of `media-assets` |

S3 permissions come from the `<app>-<stage>-media-assets-runtime` managed
policy, attached to the Vercel role by the `vercel-access` stack. There is
nothing to configure per environment beyond the bucket name.

## Auth0

| Variable                                 | Notes                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `AUTH0_DOMAIN`                           | Tenant, e.g. `sellavant-dev.us.auth0.com`                        |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Application credentials                                          |
| `AUTH0_SECRET`                           | `openssl rand -hex 32`; session cookie encryption                |
| `AUTH0_AUDIENCE`                         | **Must equal the Auth0 API identifier exactly**                  |
| `AUTH0_SCOPE`                            | `openid profile email`, plus `offline_access` for refresh tokens |
| `APP_BASE_URL`                           | Origin the callback returns to                                   |

`AUTH0_AUDIENCE` is the one that fails invisibly. It must match the API
identifier character for character; a mismatch is a 401 that the token cannot
explain, because the token is perfectly valid. The same value is what the API
Gateway authorizer is built with, so the two move together
([ADR-0007](adr/0007-page-shaped-endpoints-and-gateway-jwt-validation.md)).

`offline_access` in the scope only yields a refresh token if **Allow Offline
Access** is also enabled on the API itself. Auth0 does not error when it is not
— it silently issues none, and sessions end at the access token's lifetime.

### Tenant configuration this repository cannot carry

Under a per-app authorization policy the application must be granted the API on
**both** the user-delegated and client-access paths — separate grants, and
authorizing one leaves login failing with `Client "…" is not authorized to
access resource server "…"`. The API's signing algorithm must be **RS256** with
JWE off, because API Gateway validates RSA only.

## Couchbase

On **Vercel**: `CB_DATA_API_URL`, `CB_USERNAME`, `CB_PASSWORD`, `CB_BUCKET`,
`CB_SCOPE`.

`CB_SCOPE` is the environment, and collections are flat inside it
([ADR-0005](adr/0005-environment-scopes.md)). Dev and staging are two scopes in
the `sell-avant` bucket; production is the `prod` scope in a **different
bucket**, `SellAvantProd`, on the **same cluster**.

That the bucket differs is incidental — the boundary is the per-scope database
user, not the host. All three environments dial the same hostname, and a
misconfigured one gets `access denied` rather than another environment's data.

### On AWS, nothing about the connection is an environment variable

A Lambda environment variable is **not a secret**: it is written into the
CloudFormation template, shown in the console, and returned by
`GetFunctionConfiguration` to anyone with read access on the function.

Lambdas therefore carry **only a pointer**, and fetch the whole connection at
runtime ([ADR-0010](adr/0010-lambdas-reach-couchbase-over-the-data-api.md)):

| Variable                                                                 | Set by                                 | Holds                            |
| ------------------------------------------------------------------------ | -------------------------------------- | -------------------------------- |
| `CB_CREDENTIALS_SECRET_ID`                                               | CDK, from `infra/aws/config/stages.ts` | The **name** of the secret below |
| `CB_DATA_API_URL`, `CB_BUCKET`, `CB_SCOPE`, `CB_USERNAME`, `CB_PASSWORD` | **never set on AWS**                   | — they live inside the secret    |

The secret holds all five as one unit, because they change together — a rebuilt
cluster has a new hostname _and_ new users:

```json
{
  "dataApiUrl": "https://<id>.data.cloud.couchbase.com",
  "bucket": "sell-avant",
  "scope": "dev",
  "username": "SellAvant",
  "password": "..."
}
```

**Create and rotate it with `scripts/couchbase-secret.sh`**, which picks the AWS
profile and account per stage (`sellavant-dev` for dev and staging,
`sellavant-prod` for prod) and never puts the password on a command line:

```bash
# create, or rotate the password. Every identifier defaults to what the app
# already uses, so this asks for the password and nothing else.
./scripts/couchbase-secret.sh dev
./scripts/couchbase-secret.sh staging
./scripts/couchbase-secret.sh prod

# move the cluster - no code change, no deploy
./scripts/couchbase-secret.sh dev --url https://<new-id>.data.cloud.couchbase.com

# inspect, password redacted
./scripts/couchbase-secret.sh dev --show

# check first, writing nothing
./scripts/couchbase-secret.sh dev --dry-run
```

Defaults come from what each environment already runs: dev is `SellAvant` on
scope `dev` in `sell-avant`, staging is `sellavant-staging` on scope `staging` in
the same bucket, and prod is `sellavant-prod` on scope `prod` in `SellAvantProd`.
Three separate users, so ADR-0005's fail-closed boundary holds. All three share
one cluster, so none of them needs `--url` — that flag is for moving a cluster,
not for reaching production.

Warm Lambda containers pick up a change within `CB_SECRET_TTL_MS` (10 min
default); cold ones immediately.

Two things worth knowing:

- **Existence is not checked at synth.** `fromSecretNameV2` resolves by name, so
  a missing or misnamed secret fails at the first invocation rather than at
  deploy. The stack outputs `CouchbaseSecretName`, and the script prints the ARN
  after writing, so both can be checked first.
- **Only Lambdas declaring `metadata.lambda.couchbase: true` are granted read.**
  The Couchbase user's permissions are scope-wide (ADR-0005), so that grant lets
  a function read every collection in the environment - `health` and `me`
  deliberately do not have it.

## The Amazon LWA application credentials

Our two LWA applications — SP-API and Ads — live in one secret per stage,
`sellavant-<stage>-amazon-oauth`, named by `amazonOauth.secretName` in
`infra/aws/config/stages.ts` (#55):

```json
{
  "spApiClientId": "amzn1.application-oa2-client....",
  "spApiClientSecret": "amzn1.oa2-cs.v1....",
  "adsClientId": "amzn1.application-oa2-client....",
  "adsClientSecret": "amzn1.oa2-cs.v1...."
}
```

Both applications together because they are registered and rotated together,
and because a stage holding one but not the other fails at the first token
refresh rather than at deploy.

These client secrets mint access tokens from **every connected seller's**
refresh token. That is why they are not a Vercel environment variable and not a
Lambda one: the first is readable in a dashboard and present in every build,
the second is returned by `GetFunctionConfiguration` to anyone with read access
on the function.

**Create and rotate with `scripts/amazon-oauth-secret.sh`**, which never puts a
secret on a command line:

```bash
# create, or rotate both secrets. Client ids default to the current secret's.
./scripts/amazon-oauth-secret.sh dev

# first time, or after replacing an application
./scripts/amazon-oauth-secret.sh dev --sp-client-id amzn1.… --ads-client-id amzn1.…

# inspect, secrets redacted
./scripts/amazon-oauth-secret.sh dev --show
```

Only the `credentials` Lambda is granted read on this, together with
`kms:Decrypt` on the credentials key — see `apps/lambdas/README.md`. Nothing
else should hold either, and a test asserts it.

All three stages now have both secrets, so a Lambda declaring either flag
deploys against prod rather than failing the synth. That guard is still the
behaviour worth relying on: a stage whose secret is absent fails at synth, which
is why a missing one is a build error and never a runtime surprise.

## What is not reproducible from this repository

Recorded so the gap is known rather than discovered:

- **Vercel environment variable values.** They exist only in the dashboard. This
  file is the contract; the values are not in version control. Codifying them
  would mean the Vercel SDK (`vercel.projects.createProjectEnv`) driven by a
  script — `vercel.ts` cannot do it, as it configures builds and routing, not
  environment variables.
- **The AWS accounts themselves.** Created with `organizations create-account`.
  [ADR-0002](adr/0002-aws-account-topology.md) records what exists and why.
- **Identity Center assignments.** Console-managed.
- **The Auth0 tenant.** Applications, APIs, grants and signing algorithm are all
  configured in the Auth0 dashboard.
