# ADR-0001: CDK deploys AWS infrastructure; SAM is used only for local invoke

- **Status:** Accepted
- **Date:** 2026-07-30
- **Deciders:** Byron Warner
- **Epic:** [#51](https://github.com/bwarner/amz-spapi/issues/51)
- **Issue:** [#52](https://github.com/bwarner/amz-spapi/issues/52)

## Context

The repository carried two infrastructure-as-code stories and no decision between
them.

**CDK** — `infra/aws`, with `bin/app.ts`, a dev/staging/prod stage config, and
`MediaAssetsStack`. Real, deployed, and the source of the S3 bucket the A+ image
pipeline writes to.

**SAM** — `packages/api-services/template.yaml`, deployment-shaped
(`CodeUri: ./dist`, `Runtime: nodejs20.x`, `Handler: handlers/<name>.handler`),
declaring four functions: `credentials`, `oauth-callback`, `token-refresh` and
`token-refresh-check`. The package contained **zero handler files**, and nothing
in the workspace imported it.

So the template described a system nobody had built, next to a CDK app that had
actually shipped. Anyone reading the repo to answer "how do we deploy a Lambda?"
would find two answers, one of them fictional.

This is the same failure mode as the `typecheck` breakage in
[#48](https://github.com/bwarner/amz-spapi/issues/48), where eleven projects
shared one output directory and the config said something the build did not, and
as the Bedrock stack removed in `203e748`, where `A-PLUS.md` had said "no
Bedrock" for weeks while a deployed IAM role said otherwise. Configuration that
nothing enforces drifts, and the drift is silent.

`~/devel/scansafeguard` — the same Nx + pnpm + Vercel shape, further along — had
already resolved this. Twenty Lambdas deploy from CDK as `DockerImageFunction`
off ECR. Exactly one SAM template exists, and it states the arrangement in its
own description:

```
Local development template for StripeEventHandler Lambda - Infrastructure managed by CDK
```

with `PackageType: Image` and `ImageUri: stripe-event-handler:local`.

## Decision

**CDK owns all AWS infrastructure. SAM is used only for `sam local invoke`, and
never to deploy.**

Any SAM template in this repository must be a local-development harness,
reference a locally built image or artifact, and say so in its `Description`.

Consequences for how functions are built are recorded separately in
[#53](https://github.com/bwarner/amz-spapi/issues/53): each Lambda is an Nx app,
packaged as a container image when it has native dependencies and as an
esbuild-bundled zip when it does not.

## Options considered

### A. CDK deploys, SAM for local invoke ✅ chosen

One deployment tool, one place where infrastructure is described, and the local
story preserved. Matches the CDK app that already exists here and the arrangement
proven across twenty functions in the sibling repository.

### B. SAM deploys the Lambdas, CDK keeps the rest

Would have split infrastructure across two tools with two state models —
CloudFormation stacks from two sources, two ways to wire an IAM policy, two
places to look when a permission is missing. The existing `MediaAssetsStack` and
the media bucket it owns would still be CDK, so the split would be permanent
rather than transitional.

SAM's advantage is terser Lambda definitions. That is not worth a second
deployment tool for a solo maintainer.

### C. SAM everywhere, retire CDK

Rejected on cost and fit. `MediaAssetsStack` is deployed and working, SAM is
weaker for non-Lambda resources, and it would mean rewriting infrastructure that
has no defect.

### D. Delete the SAM template and have no local-invoke story

Tempting, since the template was fiction. Rejected because container Lambdas —
the reports/ONNX path in [#36](https://github.com/bwarner/amz-spapi/issues/36) —
are genuinely awkward to exercise without `sam local invoke`, and the sibling
repository demonstrates the harness earning its keep.

## Consequences

**Positive**

- One answer to "how is this deployed", discoverable from `infra/aws`.
- Local invoke stays available for container Lambdas without implying deployment.
- `nx affected` can drive builds and deploys through one graph
  ([#53](https://github.com/bwarner/amz-spapi/issues/53)).

**Negative / costs**

- Lambda definitions in CDK are more verbose than SAM's `AWS::Serverless::Function`.
- Contributors who know SAM must learn the CDK constructs.
- CDK synth on Node 24 currently emits a `ts-node/esm` loader deprecation
  warning; harmless, but it will need attention eventually.

**Follow-through required by this decision**

- `packages/api-services` is removed. Under
  [#53](https://github.com/bwarner/amz-spapi/issues/53) a Lambda is an Nx **app**
  at `apps/lambdas/<name>`, not a package, so the package could not have become
  the home for the four handlers its template named. Its only source was an
  unused `AmazonSPAPI` stub superseded by `sp-client`. The intended handler set
  is preserved in [#55](https://github.com/bwarner/amz-spapi/issues/55).
- [#36](https://github.com/bwarner/amz-spapi/issues/36) is re-titled: its content
  (EventBridge, SQS fan-out, container Lambda) is unaffected, only the deployment
  tool changes.

## References

- Epic [#51](https://github.com/bwarner/amz-spapi/issues/51), issue [#52](https://github.com/bwarner/amz-spapi/issues/52)
- `~/devel/scansafeguard`: `apps/stripe-event-handler/template.yaml`, `infra/ssg-cdk/lib/ssg-stripe-event-handler.ts`
- `infra/aws/README.md`
