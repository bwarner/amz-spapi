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
      "memoryMb": 256 // optional, default 512
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

## Choosing packaging: can it be bundled?

**No → `image`.** Native binaries and model files: ONNX, `sharp`,
`@imgly/background-removal-node`. Also the only way past 250MB unzipped. Add a
`Dockerfile` that copies the Nx build output into the AWS base image, and
`container` / `push` targets. CDK creates one ECR repository per function so a
rollback is per-function.

**Yes → `zip`.** An esbuild bundle from `nx build`, which is faster to deploy and
to cold-start. The bundle ships **no `node_modules`**: pnpm's linked layout does
not survive packaging, and bundling makes workspace-dependency resolution a
non-issue at runtime.

`NodejsFunction` is deliberately not used. It bundles with its own esbuild at
synth time, which would rebuild the code outside Nx and stop `nx affected` from
governing what gets deployed.

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
