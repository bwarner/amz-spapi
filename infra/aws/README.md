# SellAvant AWS CDK

This CDK app provisions AWS infrastructure used by the SellAvant web app.

The CDK app creates stage-specific stacks for:

- shared media asset storage used by A+ content now and future image workflows
  like ads and listing optimization

- private S3 bucket for uploaded image bytes
- CORS for the configured web origins
- versioning and lifecycle cleanup
- managed IAM policy for the app runtime to create presigned uploads and read assets for publishing
- CloudFormation outputs for `MEDIA_ASSETS_BUCKET` and `AWS_REGION`

Asset metadata remains in Couchbase. Image bytes live in S3.

## Profiles

Your root/management account profile is expected to be:

```ini
[profile orgadmin]
sso_session = farvisionllc
sso_account_id = 132664187310
sso_role_name = OrgAdmin
region = us-east-1
output = json
```

Run SSO login first:

```sh
aws sso login --profile orgadmin
```

For normal CDK deploys, use a profile that logs directly into the target
workload account. On this machine the shared-services account profile is:

- `deployer` for account `058264463518`

The SellAvant development workload account is:

- `853583158600` / `bfwarner+sellavant-dev@gmail.com`

Do not use `orgadmin` for a shared-services deploy unless the target account has
already been bootstrapped to trust the management account CDK roles. CDK will
otherwise try to assume `cdk-hnb659fds-*` roles in the workload account and fail.

Before diff/deploy, verify the profile resolves to the stage account:

```sh
aws sts get-caller-identity --profile deployer
```

## Organization Layout

SellAvant accounts should live under:

```text
Root r-8xck
└── Farvision LLC ou-8xck-blr0k4hc
    ├── SellAvant ou-8xck-p9uto1vg
    │   └── SellAvant Development 853583158600
    ├── ScanSafeGuard ou-8xck-9mn8ixso
    └── Shared-Services ou-8xck-zcaz2c2r
```

The `SellAvant` OU and `SellAvant Development` account were created for this
app.

## Stages

Supported stages are configured in `config/stages.ts`:

- `dev`
- `staging`
- `prod`

By default, `dev` and `staging` target the shared-services account visible in
your organization screenshot, and `prod` targets the management account until a
production member account is assigned. Override account/region without editing
code by setting:

```sh
SELLAVANT_DEV_ACCOUNT_ID=123456789012
SELLAVANT_STAGING_ACCOUNT_ID=123456789012
SELLAVANT_PROD_ACCOUNT_ID=123456789012
SELLAVANT_AWS_REGION=us-east-1
```

Stage-specific regions are also supported with `SELLAVANT_DEV_REGION`,
`SELLAVANT_STAGING_REGION`, and `SELLAVANT_PROD_REGION`.

SELLAVANT_PROD_VERCEL_OIDC_AUDIENCE=aws

````

## Bootstrap

Bootstrap each target account/region before deploy:

```sh
AWS_PROFILE=deployer npx cdk bootstrap \
  aws://853583158600/us-east-1 \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=dev
````

## Synthesize

```sh
AWS_PROFILE=deployer npx cdk synth \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=dev
```

## Diff

```sh
AWS_PROFILE=deployer npx cdk diff \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=dev
```

## Deploy

```sh
AWS_PROFILE=deployer npx cdk deploy \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=dev
```

After deploy, copy the outputs into the web app environment:

```env
AWS_REGION=us-east-1
MEDIA_ASSETS_BUCKET=<MediaAssetsBucketName output>
```

Also attach `MediaAssetsRuntimePolicyArn` to whichever IAM principal runs the
web app server-side code that creates presigned URLs.

### Staging and prod deploy from CI, not from here

For `staging` and `prod`, the commands above are the fallback, not the routine.
`.github/workflows/deploy-web.yml` deploys the CDK stacks and then the web app —
AWS first, so the web half never goes live referencing infrastructure that does
not exist.

- **staging** deploys on every push to `main`. That frequency is the point: a
  broken template or a missing artefact fails on the merge that caused it,
  rather than for the first time during a release.
- **prod** deploys when a GitHub Release is published.

Note the `--require-approval never` the workflow passes. Every run of these
stacks touches IAM, and the prompt that guards that interactively is a hung job
on a runner.

### Bootstrapping the CI role, once

`sellavant-<stage>-github-access` grants the role CI assumes, which means CI
cannot create it: the first deploy has to come from a workstation.

```sh
# prod, into 108248327073
AWS_PROFILE=sellavant-prod npx cdk deploy \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=prod sellavant-prod-github-access

# staging, into the dev/staging account 853583158600
AWS_PROFILE=sellavant-dev npx cdk deploy \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=staging sellavant-staging-github-access
```

Then set each stack's `GitHubDeployRoleArn` output as `AWS_DEPLOY_ROLE_ARN` — a
**variable**, not a secret — on the matching GitHub environment (`production`
and `staging`). After that, CI deploys these stacks along with everything else.

Staging creates the account-level GitHub OIDC provider, because dev owns only
the _Vercel_ one and IAM keys providers by URL. If dev ever adopts CI deploys,
`ownsOidcProvider` moves to dev and staging references it.

If a later change breaks the role's own trust policy, CI locks itself out. The
recovery is this same command, which is why the workstation path has to keep
working.

Synth reads Lambda build output off disk and refuses without it, so build the
artefacts before any diff or deploy:

```sh
pnpm exec nx run-many -t build --projects='lambda-*'
```

Models are served through the Vercel AI Gateway, so no AWS AI permissions are
required here. See `A-PLUS.md`.
