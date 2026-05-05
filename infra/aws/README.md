# SellAvant AWS CDK

This CDK app provisions AWS infrastructure used by the SellAvant web app.

The CDK app creates stage-specific stacks for:

- shared media asset storage used by A+ content now and future image workflows
  like ads and listing optimization
- Bedrock runtime permissions for production AI calls

- private S3 bucket for uploaded image bytes
- CORS for the configured web origins
- versioning and lifecycle cleanup
- managed IAM policy for the app runtime to create presigned uploads and read assets for publishing
- CloudFormation outputs for `MEDIA_ASSETS_BUCKET` and `AWS_REGION`
- managed IAM policy for the app runtime to invoke the configured Bedrock
  language and embedding models

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

Bedrock model IDs can be overridden per stage or globally:

```sh
SELLAVANT_BEDROCK_MODEL_IDS=us.anthropic.claude-sonnet-4-6,us.anthropic.claude-haiku-4-5-20251001-v1:0
SELLAVANT_BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
```

If the web app runs on Vercel, configure an OIDC provider in AWS and pass the
provider ARN plus the expected Vercel subject. When those values are present,
CDK also creates a role and outputs `AwsBedrockRoleArn` for
`AWS_BEDROCK_ROLE_ARN`.

```sh
SELLAVANT_PROD_VERCEL_OIDC_PROVIDER_ARN=arn:aws:iam::123456789012:oidc-provider/oidc.vercel.com/...
SELLAVANT_PROD_VERCEL_OIDC_SUBJECT=owner:team:project:project-name:environment:production
SELLAVANT_PROD_VERCEL_OIDC_AUDIENCE=aws
```

## Bootstrap

Bootstrap each target account/region before deploy:

```sh
AWS_PROFILE=deployer npx cdk bootstrap \
  aws://853583158600/us-east-1 \
  --app "node --loader ts-node/esm infra/aws/bin/app.ts" \
  -c stage=dev
```

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

For Bedrock, set:

```env
AI_PROVIDER=bedrock
AWS_BEDROCK_ROLE_ARN=<AwsBedrockRoleArn output, when using Vercel OIDC>
AWS_BEDROCK_REGION=us-east-1
```

If no Bedrock role is created, attach `BedrockRuntimePolicyArn` to the runtime
principal that serves the web app.
