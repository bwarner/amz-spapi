# ADR-0006: Container Lambdas are deployed as content-addressed CDK image assets

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Byron Warner
- **Epic:** [#51](https://github.com/bwarner/amz-spapi/issues/51)
- **Issue:** [#53](https://github.com/bwarner/amz-spapi/issues/53)
- **Builds on:** [ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md)

## Context

ADR-0001 settled that CDK deploys and SAM only invokes locally, and left "how
functions are built" to [#53](https://github.com/bwarner/amz-spapi/issues/53).
That produced two packaging paths in `LambdasStack`: an esbuild zip, and a
container image for functions with native dependencies. The zip path shipped and
works. The image path was written, never exercised — no app declared
`packaging: "image"`, no Dockerfile existed, and it had no test — and it named
the image to deploy like this:

```ts
code: lambda.DockerImageCode.fromEcr(repository, { tagOrDigest: 'latest' });
```

A comment conceded that `latest` was "deliberate for now and wrong later" for
reproducibility. It is worse than that. **The deploy would not have happened at
all.** The [UpdateFunctionCode API reference][update] states:

> For a function defined as a container image, Lambda resolves the image tag to
> an image digest. In Amazon ECR, if you update the image tag to a new image,
> Lambda does not automatically update the function.

and the [container image guide][nodejs-image] is more explicit still:

> To deploy the new image to the same Lambda function, you must use the
> `update-function-code` command, **even if the image tag in Amazon ECR remains
> the same**.

CloudFormation issues `UpdateFunctionCode` only when a template property
changes. With a constant `:latest`, the template is byte-identical no matter what
was pushed, so the call is never made: `push` then `cdk deploy` reports success
and leaves the previous code running. AWS's own remedy — call
`update-function-code` explicitly — is written for the imperative CLI and does
not survive the move to CloudFormation.

A second, unrelated defect: the ECR repository was created by the same stack as
the function that reads it. On a new stage CloudFormation would create an empty
repository and then fail to create a function pointing at a tag inside it, and
`removalPolicy: DESTROY` would take the repository out on rollback. There is no
ordering within one stack that fixes this.

`~/devel/scansafeguard` had already hit the first problem and solved it: an SSM
parameter per lambda per environment holds a `branch-sha` version, read at synth
with `ssm.StringParameter.valueFromLookup` so the resolved string lands in the
template and CloudFormation sees a diff. It works, and it costs a parameter
written to two accounts by CI, a `cdk context --reset` step in both the deploy
script and the workflow to stop the cached lookup going stale, a synth that
needs AWS credentials, and a rollback that cannot be done from git because the
parameter still points at the newer image.

## Decision

**A container Lambda's image is a CDK image asset, identified by a hash of the
build output. Nothing else records which image is deployed.**

```ts
code: lambda.DockerImageCode.fromImageAsset(artefact, {
  platform: Platform.LINUX_AMD64,
  cmd: [app.handler],
});
```

`artefact` is `dist/apps/lambdas/<name>` — the same directory the zip path
reads — and the app's build copies its `Dockerfile` into it, because the built
directory is the Docker build context and Docker cannot reach outside one.

This satisfies the AWS guidance by construction. The tag _is_ the content hash,
so it is immutable in the way a digest is, and the template changes exactly when
the built output changes, which is exactly when CloudFormation must call
`UpdateFunctionCode`.

Images go to the repository `cdk bootstrap` provides
(`cdk-<qualifier>-container-assets-<account>-<region>`). `LambdasStack` creates
no ECR repository, so the bootstrap-ordering defect above is gone rather than
worked around.

## Options considered

### A. CDK image asset ✅ chosen

No image tag, no version parameter, no push target, no context cache to reset,
and rollback is `git checkout` — an older commit produces the older hash. AWS's
own answer for CDK: assets are hashed at synth and
"[uploaded to Amazon ECR by the AWS CDK CLI or your app's CI/CD pipeline][assets]".

### B. SSM parameter resolved at synth (the scansafeguard pattern)

Proven across twenty functions next door, and the right call there. Rejected
here because every part of it is machinery for keeping a _name_ in step with a
content change, which content addressing removes. Its specific costs — the
`cdk.context.json` cache that silently deploys yesterday's image, a synth that
fails offline, and rollback that lives outside git — are all avoidable, and
nothing in AWS's guidance recommends it.

### C. Digest file written by a `push` target and read at synth

Keeps immutability and allows per-function repositories, but reintroduces a
build artefact that CI must carry from the push job to the deploy job, and a
fresh clone cannot synth without pushing first. Worth revisiting only if a
function ever needs an image CDK cannot build.

### D. Keep `:latest`

Rejected: it does not deploy. See Context.

## Consequences

**Positive**

- A deploy is a no-op when nothing changed, and a real update when something
  did — with no bookkeeping to get wrong.
- Identical build outputs dedupe to one stored image.
- Synth needs neither Docker nor AWS credentials, so `nx run infra-aws:synth`
  stays in the CI gate.
- `handler` in `project.json` governs both packaging paths, as the container
  `CMD` for images and the function handler for zips.

**Negative / costs**

- One shared bootstrap repository instead of one per function, so there are no
  per-function `maxImageCount` lifecycle rules. Every deploy adds an image and
  none are pruned; `cdk gc --type ecr` (still behind `--unstable`) is the
  intended cleanup and needs a scheduled run before this matters.
- `cdk deploy` needs Docker for image Lambdas. Synth does not.
- The image cannot be built somewhere CDK is not, which is exactly the
  constraint that would send us to option C.

**Follow-through required by this decision**

- An app declaring `packaging: "image"` must copy its `Dockerfile` into the
  build output. Synth refuses otherwise, naming the file.
- `cdk gc` should be scheduled before the shared repository has had time to
  accumulate.

## References

- [UpdateFunctionCode — AWS Lambda API Reference][update]
- [Deploy Node.js Lambda functions with container images][nodejs-image]
- [Assets and the AWS CDK][assets]
- `infra/aws/lib/lambdas-stack.ts`, `infra/aws/lib/lambdas-stack.spec.ts`
- `apps/lambdas/README.md`
- `~/devel/scansafeguard`: `infra/ssg-cdk/lib/utils.ts`,
  `scripts/deploy-lambda-cdk.sh`, `.github/workflows/deploy-lambdas.yml`

[update]: https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html
[nodejs-image]: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html
[assets]: https://docs.aws.amazon.com/cdk/v2/guide/assets.html
