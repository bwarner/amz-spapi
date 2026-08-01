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

`CB_DATA_API_URL`, `CB_USERNAME`, `CB_PASSWORD`, `CB_BUCKET`, `CB_SCOPE`.

`CB_SCOPE` is the environment, and collections are flat inside it
([ADR-0005](adr/0005-environment-scopes.md)). **There is no `prod` scope yet** —
whatever production points at today is not a production scope.

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
