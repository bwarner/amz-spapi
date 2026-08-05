# Lambda apps

One Nx app per Lambda. **CDK deploys them; SAM only ever runs them locally** —
see [ADR-0001](../../docs/adr/0001-cdk-deploys-sam-is-local-invoke.md).

Nothing here is registered by hand in the CDK stack. `LambdasStack` discovers
every directory under `apps/lambdas/` that declares a `metadata.lambda` block and
builds the function from that declaration, so adding a Lambda is adding an app.

## The contract

```jsonc
// apps/lambdas/<name>/project.json
{
  "name": "lambda-<name>",
  "metadata": {
    "lambda": {
      "packaging": "zip", // or "image"
      "handler": "main.handler", // file.export in the built artefact
      "description": "…",
      "timeoutSeconds": 10, // optional, default 30
      "memoryMb": 256, // optional, default 512
      "routes": ["GET /orders", "GET /orders/{orderId}"], // optional
      "couchbase": true // optional, default false — see below
    }
  }
}
```

The entry point is `src/main.ts` exporting `handler`. Keeping one handler name
across every function is what lets the stack stay generic.

A directory with no `metadata.lambda` is not deployed — helpers and fixtures can
live here. Anything malformed **fails the synth** rather than deploying as the
wrong kind of artefact, which would look like a successful deploy and fail on
first invocation.

## Reading Couchbase

Declare `"couchbase": true` and the stack sets `CB_CREDENTIALS_SECRET_ID` and
grants the function read on that secret. Then call
`useSecretsManagerConnection()` once at module scope:

```ts
import { useSecretsManagerConnection } from '@amz-spapi/couchbase-secrets';

useSecretsManagerConnection();
```

**Nothing about the connection is an environment variable** — the host, bucket,
scope and login all live inside the secret and are fetched at runtime, cached
for the container's life. An environment variable is in the CloudFormation
template and in `GetFunctionConfiguration`, and keeping the five together means
a cluster move is one secret write rather than a deploy.
See [ADR-0010](../../docs/adr/0010-lambdas-reach-couchbase-over-the-data-api.md),
and `docs/deployment-environment.md` for creating the secret.

It is opt-in rather than derived from your dependencies because it governs an
IAM grant, and the Couchbase user's permissions are scope-wide (ADR-0005): a
function holding it can read **every** collection in the environment, including
`credentials_profiles`. A test cross-checks the declaration against each app's
dependencies, so forgetting either half fails CI with the line to add.

A stage with no `couchbase` block in `infra/aws/config/stages.ts` **fails the
synth** if any app declares this — `prod` has none, deliberately.

## Versions and the `live` alias

Every function gets a published version per change and a fixed alias, `live`,
pointing at it. Callers — the HTTP API, and event sources later — invoke the
alias, never `$LATEST`.

`$LATEST` is mutable and there is only ever one of it, so deploying over it
destroys what was there and leaves nothing to roll back to. A published version
is immutable and stays invocable, and a moving alias is the seam CodeDeploy
needs to shift traffic gradually instead of all at once. Nothing you write
names a version, so this stays invisible until the day it matters.

## Being reachable over HTTP

Declare `routes` and the stack puts the function behind the HTTP API. The
entries are API Gateway route keys — `METHOD /path`, exactly the string
`HttpApi.addRoutes` takes — so a function is reachable by editing its own
project, never the CDK. Omit `routes` and the function is not HTTP-facing, which
is the normal case for queue and event consumers.

The method is required. A bare `/orders` would have to be given a method by the
API stack, and the only honest default is _all of them_, which quietly exposes
`DELETE` on a handler whose author was thinking about `GET`. Two apps claiming
one route key fails the synth, naming both files.

Declaring no routes at all builds no API — there is no empty gateway waiting for
someone to need it.

### Every route is authenticated

Routes require a valid Auth0 access token ([#54](https://github.com/bwarner/amz-spapi/issues/54)).
API Gateway validates it against the tenant's JWKS — signature, `iss`, `aud`,
`exp` — before your function is invoked, so an unauthenticated request never
reaches it and is never billed. The verified claims arrive at
`event.requestContext.authorizer.jwt.claims`; `claims.sub` is the Auth0 user id,
the same value `session.user.sub` gives the web app.

There is no authorizer Lambda. The gateway does the validation itself — see
[ADR-0007](../../docs/adr/0007-page-shaped-endpoints-and-gateway-jwt-validation.md),
which also records what would justify adding one.

**Still check for a subject.** `metadata.lambda.routes` cannot express "public",
so today authentication is all-or-nothing per stage — but a stage with no Auth0
settings configured deploys open, and synth warns loudly when that happens. A
handler that assumes `sub` is present would treat an unauthenticated caller as a
verified one, so read it and refuse when it is missing, the way
`apps/lambdas/me` does.

Endpoints should be **page-shaped** — one call per view, not one per row. The
reasoning, and what it costs to get wrong, is in ADR-0007.

## Choosing packaging: can it be bundled?

**No → `image`.** Native binaries and model files: ONNX, `sharp`,
`@imgly/background-removal-node`. Also the only way past 250MB unzipped. Write a
`Dockerfile` that copies the build output into the AWS base image, and have the
build **copy that Dockerfile into `dist/apps/lambdas/<name>/`** — the esbuild
target's `assets` option does this. The built directory is the Docker build
context, so the Dockerfile has to be inside it.

There are no `container` or `push` targets. CDK builds the image and pushes it
at deploy time, tagged with a hash of that directory, into the ECR repository
`cdk bootstrap` created. Nothing records which image is current, because the
tag _is_ the content — see
[ADR-0006](../../docs/adr/0006-lambda-images-are-content-addressed-assets.md).
Deploying an image Lambda therefore needs Docker running; synth does not.

**Yes → `zip`.** An esbuild bundle from `nx build`, which is faster to deploy and
to cold-start. The bundle ships **no `node_modules`**: pnpm's linked layout does
not survive packaging, and bundling makes workspace-dependency resolution a
non-issue at runtime.

Either way the artefact is `dist/apps/lambdas/<name>` and `handler` in
`project.json` is what runs — the zip path passes it as the function handler,
the image path as the container `CMD`, so no Dockerfile can disagree with it.

Constructs that bundle for you — `NodejsFunction`, or a Dockerfile that compiles
TypeScript — are deliberately not used. They build at synth time, outside Nx,
which would stop `nx affected` from governing what gets deployed. Nx compiles;
CDK only packages what Nx produced.

## Running one locally

```bash
nx build lambda-health
echo '{}' > /tmp/event.json
sam local invoke Health \
  --template apps/lambdas/health/template.yaml \
  --event /tmp/event.json
```

That runs the real AWS Lambda Node 24 container against the artefact CDK would
deploy. Two things that will bite:

- **`--event` must contain valid JSON.** An empty file gives
  `SyntaxError: Unexpected end of JSON input` from the runtime, which looks like
  a bug in your handler and is not.
- **SAM resolves AWS credentials even for a local invoke.** With an expired SSO
  session it fails with `TokenRetrievalError` before running anything. Either
  refresh the session, or hand it throwaway values:

  ```bash
  env -u AWS_PROFILE AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
    AWS_DEFAULT_REGION=us-east-1 sam local invoke …
  ```

For an image Lambda the template declares `PackageType: Image` and an `ImageUri`
of a locally built tag, so build the image first — `sam local invoke` will not
build it for you, and CDK's build only happens at deploy.

Each app's `template.yaml` exists only for this. It must never be deployed, and
its `Description` says so.

## Deploying

```bash
nx build lambda-health          # the stack refuses to synth without the artefact
nx run infra-aws:synth
npx cdk deploy --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=dev sellavant-dev-lambdas
```

Synth fails loudly if a zip app has no build output, naming the command that
produces it — synthesising against a stale build would deploy whatever happened
to be on disk.
