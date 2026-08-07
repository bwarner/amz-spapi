# ADR-0010: Lambdas reach Couchbase over the Data API, with the login fetched at runtime

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Byron Warner
- **Depends on:** [ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md), [ADR-0005](0005-environment-scopes.md), [ADR-0006](0006-lambda-images-are-content-addressed-assets.md)

## Context

`libs/couchbase-utils` reaches Couchbase Capella over the **Data API** (HTTP).
That choice was made for the web runtime — Vercel cannot load a native addon —
and was recorded only in the library's README, never as a decision.

[#55](https://github.com/bwarner/amz-spapi/issues/55) made it a real question.
Three Lambda apps now import the library (`credentials`, `sync-dispatcher`,
`sync-worker`), and on AWS the constraint that forced the Data API does not
apply: a Lambda can load the native SDK. So the choice had to be made again on
its merits rather than inherited.

A second problem surfaced with it. **No CDK code set any `CB_*` variable.**
`common()` in `lambdas-stack.ts` set `SERVICE_NAME`, `STAGE` and `NODE_OPTIONS`
and nothing else, so all three functions deployed cleanly and would have thrown
on their first request — including the two already merged under
[#36](https://github.com/bwarner/amz-spapi/issues/36). And one of the five
values is a credential, which cannot travel the way the other four do: **a
Lambda environment variable is not a secret.** It is written into the
CloudFormation template, shown in the console, and returned by
`GetFunctionConfiguration` to anyone with read access on the function.

## Decision

**One transport: the Data API, in Lambdas as well as on Vercel.**

**The whole connection lives in one pre-created Secrets Manager secret** —
`{"dataApiUrl","bucket","scope","username","password"}` — fetched at runtime and
cached at module scope for the container's life. The only environment variable
is `CB_CREDENTIALS_SECRET_ID`, a pointer holding the secret's name.

All five together rather than "config in the template, credentials in the
secret", which was the first design. They change as **one unit**: a rebuilt
cluster has a new hostname _and_ new users, so splitting them leaves a window
where a function holds the new host with the old login. Kept together, moving an
environment is one secret write and no deploy at all.

The cost, accepted deliberately: the bucket and scope no longer appear in a
`cdk diff`, so the pipeline does not show which database an environment points
at. That is tolerable **only** because ADR-0005 gives each scope its own
database user — a wrong scope fails closed with `access denied` rather than
silently reading another environment's data. Without that property this split
would be unsafe.

`libs/couchbase-utils` gained an injected `ConnectionProvider` whose default
remains the environment, so Vercel, the CLIs and the scripts are unchanged and
still read all five `CB_*` variables. `libs/aws-secrets` supplies the AWS
implementation and exists so `@aws-sdk/*` lives in a package the Next.js app
never imports — a dynamic `import()` inside `couchbase-utils` would not be
enough, since Next's bundler resolves the branch whether or not it runs.

**CDK references the secret by name (`fromSecretNameV2`) and does not create
it.** It is created and rotated by `scripts/couchbase-secret.sh`, which resolves
the AWS profile per stage.

**The grant is opt-in per app**, declared as `metadata.lambda.couchbase: true`.

## Why the native SDK was rejected

Packaging turned out **not** to be the deciding factor, contrary to the first
analysis. `esbuild external: ['couchbase']` plus a `LayerVersion` is viable: the
runtime footprint is ~15MB, not the 73MB the package occupies (70MB of that is
`deps/` C++ _source_, unused once a prebuilt binary exists), pnpm's
`supportedArchitectures` can fetch the linux-x64 prebuild without a container,
and CDK's `Code.fromAsset` would hash the layer the same way ADR-0006 requires.
That option is genuinely open.

What decided it:

1. **A second implementation of the same storage semantics.**
   `couchbase-utils` encodes six Data-API behaviours that were each assumed
   wrong at first and are pinned by its integration suite — CAS on an
   _unquoted_ `ETag` answered **409** rather than the RFC's 412;
   `If-None-Match: *` silently overwriting, so `POST` is the create-only verb;
   `increment` storing `initial` and **ignoring** `delta`; `Expires` as a Go
   duration string. The SDK spells every one differently. A second transport
   means a second implementation with its own contract suite, operating on the
   _same documents the web app writes_ — credential profiles and sync cursors.
   Vercel cannot use the SDK, so that divergence would be **permanent**, not
   transitional.
2. **Cold start.** `credentials` is request-scoped behind API Gateway with a
   15s timeout. `Cluster.connect()` + `waitUntilReady()` is a TLS handshake, a
   cluster-config fetch and KV connections to every node, paid before the first
   operation on every cold start.
3. **Freeze/thaw.** The SDK's C++ core runs background config-poll and heartbeat
   threads. Lambda freezes the execution environment between invocations, so the
   first operation after a thaw commonly surfaces as a spurious timeout against
   a connection the runtime believes is live. Stateless HTTP has no such state.

Accepted cost: an HTTP round trip per operation, on a connection undici keeps
alive for the container's life, plus the transient Data-API 5xx failure mode —
which is already bounded by the retry added in
[#95](https://github.com/bwarner/amz-spapi/pull/95).

**If this is ever revisited it will be for `sync-worker` alone** (300s, batch,
many KV writes per run, where per-operation latency dominates and cold start
does not), and it should be a **layer with zip packaging, not an OCI image** —
a layer is content-addressed by `Code.fromAsset`, keeps the faster deploy path,
and avoids making Docker a requirement for deploying the credentials API.
Nothing in this decision blocks that: the provider seam and the secret wiring
are needed either way.

## Why the secret is not created by CDK

CDK must supply _some_ value when it creates a secret. `generateSecretString`
mints a random one that is **not** the Couchbase password and must be
overwritten by hand — and until it is, it is indistinguishable from a real
value, failing only at the first 401. `secretStringValue` would put the real
password in the template, which is the thing being avoided. A logical-id change
would also make CloudFormation replace the secret and silently regenerate it,
breaking a working stage, and stack-ownership puts a shared cluster credential
inside the blast radius of a routine teardown. This is the same reasoning
`credentials-key-stack.ts` uses to give the KMS key its own stack.

Referencing by **name** rather than ARN survives the secret being recreated,
which changes the random six-character ARN suffix.

## Consequences

- One storage library, one set of semantics, one contract suite, across every
  runtime.
- No part of the connection exists in a CloudFormation template or a function
  configuration — not the password, and not the host, bucket or scope either. A
  test asserts the synthesised template contains none of `CB_PASSWORD`,
  `CB_USERNAME`, `CB_DATA_API_URL`, `CB_BUCKET` or `CB_SCOPE`.
- Moving a cluster — including the possible us-east-1 correction below — is
  `scripts/couchbase-secret.sh <stage> --url <new>`, with no code change, no PR
  and no deploy. Warm containers pick it up within the TTL.
- A stage with no `couchbase` config **fails synth** if any Lambda declares the
  flag — deliberately an error rather than the warning the Auth0 case gets,
  because an unauthenticated route still functions while an unconfigured
  Couchbase Lambda cannot. `prod` has no config, so it cannot deploy one by
  accident.
- `grantRead` scopes to `…:secret:<name>-??????`, a six-character wildcard —
  marginally wider than an exact ARN, which would mean hardcoding a suffix that
  changes whenever the secret is recreated.
- `fromSecretNameV2` does **not** validate existence at synth, so a missing
  secret fails at the first invocation rather than at deploy. The stack outputs
  `CouchbaseSecretName` so an operator can check first.
- The grant is opt-in because the Couchbase user's permissions are **scope-wide**
  (ADR-0005): any function holding it can read every collection in the
  environment, `credentials_profiles` included. `health` and `me` must not have
  it, and a test asserts a non-declaring function gets neither the config nor
  the grant.

## Follow-ups

- **Invalidate on 401 rather than relying on the TTL.** The cache refetches
  after ten minutes, which bounds how long a warm container keeps presenting a
  rotated-away password. Refetching on an auth failure instead would be strictly
  better — one fetch per container, and instant recovery — but needs a
  retry-once-on-401 wrapper around the seven call sites in `couchbase-utils`.
  `invalidateCachedConnection()` is already exported for it.
- **Confirm the cluster's region.** All stages run in `us-east-1`. The cluster
  node answers on an IP that could not be confirmed against AWS's published
  ranges, so co-location is unverified. Capella cannot change a cluster's region
  in place, so correcting it would mean a new cluster and a data migration.
