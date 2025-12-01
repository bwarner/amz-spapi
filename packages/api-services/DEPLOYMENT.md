# API Services Deployment Guide

This package contains the AWS SAM infrastructure for the Amazon Seller Assistant backend.

## Prerequisites

1. **AWS CLI** - Configured with appropriate credentials
   ```bash
   aws configure
   ```

2. **AWS SAM CLI** - Install from https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
   ```bash
   # macOS
   brew install aws-sam-cli

   # Verify installation
   sam --version
   ```

3. **Node.js 20+** - For Lambda runtime

4. **Couchbase Capella** - Set up a Couchbase cluster (or local Couchbase)

5. **Auth0 Account** - For user authentication

## Infrastructure Components

### KMS Key (`CredentialsKmsKey`)
- **Purpose**: Encrypts sensitive Amazon API credentials (client secrets, refresh tokens, access tokens)
- **Key Policy**: Allows Lambda functions to encrypt/decrypt
- **Alias**: `alias/seller-assistant-credentials-{env}`

### API Gateway (`ApiGateway`)
- **Type**: HTTP API (cheaper and simpler than REST API)
- **CORS**: Configured for web access
- **Endpoints**:
  - `POST /api/credentials` - Store credentials
  - `GET /api/credentials/{profileName}` - Get credentials
  - `GET /api/credentials` - List all profiles
  - `DELETE /api/credentials/{profileName}` - Delete credentials
  - `GET /api/oauth/callback` - OAuth callback handler

### Lambda Functions

1. **CredentialServiceFunction**
   - Handles CRUD operations for credentials
   - Uses KMS for encryption/decryption
   - Stores data in Couchbase

2. **OAuthCallbackFunction**
   - Handles OAuth2 callbacks from Amazon LWA
   - Exchanges authorization code for tokens
   - Stores tokens securely

3. **TokenRefreshFunction**
   - Processes SQS messages to refresh expiring tokens
   - Batch processing with partial failure support

4. **TokenRefreshCheckFunction**
   - Runs every 30 minutes via EventBridge
   - Scans for tokens expiring within 1 hour
   - Queues refresh jobs to SQS

### SQS Queues

1. **TokenRefreshQueue**
   - Messages: `{ profileName, apiType, userId }`
   - Visibility timeout: 60 seconds
   - DLQ after 3 retries

2. **TokenRefreshDLQ**
   - Captures failed token refresh attempts
   - CloudWatch alarm triggers on messages

## Configuration

### Step 1: Update samconfig.toml

Edit `samconfig.toml` and replace placeholders:

```toml
[dev.deploy.parameters]
parameter_overrides = [
  "Environment=dev",
  "CouchbaseConnStr=couchbases://cb.xxx.cloud.couchbase.com",
  "CouchbaseUsername=admin",
  "CouchbasePassword=YourSecurePassword",
  "CouchbaseBucket=seller_ops_dev",
  "Auth0Domain=your-tenant.auth0.com",
  "Auth0ClientId=YOUR_AUTH0_CLIENT_ID",
  "Auth0ClientSecret=YOUR_AUTH0_CLIENT_SECRET"
]
```

**Security Best Practice**: Use AWS Secrets Manager or Parameter Store instead of hardcoding:

```bash
# Store secrets in AWS Systems Manager Parameter Store
aws ssm put-parameter \
  --name "/seller-assistant/dev/couchbase-password" \
  --value "YourSecurePassword" \
  --type "SecureString"

# Then reference in samconfig.toml
parameter_overrides = [
  "CouchbasePassword={{resolve:ssm:/seller-assistant/dev/couchbase-password}}"
]
```

### Step 2: Build the Lambda Code

```bash
# From the monorepo root
npx nx run api-services:build

# This should create dist/ with compiled Lambda handlers
```

### Step 3: Deploy to AWS

```bash
# Development
sam build --config-env dev
sam deploy --config-env dev

# Staging
sam build --config-env staging
sam deploy --config-env staging

# Production (with extra confirmation)
sam build --config-env prod
sam deploy --config-env prod --confirm-changeset
```

### Step 4: Test the Deployment

```bash
# Get the API endpoint from outputs
aws cloudformation describe-stacks \
  --stack-name seller-assistant-api-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text

# Test health endpoint (once implemented)
curl https://YOUR_API_ENDPOINT/api/health
```

## Environment Variables

Lambdas automatically receive these variables:

- `ENV` - Environment name (dev/staging/prod)
- `CREDENTIALS_KMS_KEY_ID` - KMS key ID for encryption
- `COUCHBASE_CONNSTR` - Couchbase connection string
- `COUCHBASE_USERNAME` - Couchbase username
- `COUCHBASE_PASSWORD` - Couchbase password
- `COUCHBASE_BUCKET` - Couchbase bucket name
- `POWERTOOLS_SERVICE_NAME` - For AWS Lambda Powertools
- `POWERTOOLS_METRICS_NAMESPACE` - CloudWatch metrics namespace
- `LOG_LEVEL` - Logging level

## Monitoring

### CloudWatch Logs

Lambda logs are automatically sent to CloudWatch Logs:

```bash
# View credential service logs
sam logs --stack-name seller-assistant-api-dev \
  --name CredentialServiceFunction \
  --tail
```

### X-Ray Tracing

All functions have tracing enabled. View traces in AWS X-Ray console.

### CloudWatch Alarms

- **TokenRefreshDLQAlarm** - Alerts when token refresh fails 3 times

## Local Development

### Start Local API

```bash
# Start local API Gateway + Lambda
sam local start-api --config-env dev

# API available at http://localhost:3000
curl http://localhost:3000/api/credentials
```

### Invoke Function Directly

```bash
# Test credential service
sam local invoke CredentialServiceFunction \
  --event events/store-credential.json \
  --config-env dev
```

### Create Test Events

Create `events/store-credential.json`:

```json
{
  "httpMethod": "POST",
  "path": "/api/credentials",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"profileName\":\"test\",\"apiType\":\"ADS_API\",\"clientId\":\"...\",\"clientSecret\":\"...\",\"marketplaceId\":\"ATVPDKIKX0DER\"}"
}
```

## Cleanup

To delete the entire stack:

```bash
sam delete --stack-name seller-assistant-api-dev --no-prompts
```

**Warning**: This will delete:
- KMS key (with 7-day recovery period)
- All Lambda functions
- API Gateway
- SQS queues
- CloudWatch logs (after retention period)

## Cost Estimation

### Free Tier (first 12 months)
- Lambda: 1M requests/month free
- API Gateway: 1M requests/month free
- KMS: 20,000 requests/month free
- CloudWatch Logs: 5GB ingestion/month free

### Typical Monthly Cost (after free tier)
- Lambda: ~$5-20 (depends on invocations)
- API Gateway: ~$3.50 per million requests
- KMS: $1/month + $0.03 per 10,000 requests
- SQS: ~$0.40 per million requests
- **Total estimated**: $10-30/month for moderate usage

## Troubleshooting

### Build Failures

```bash
# Validate SAM template
sam validate

# Build with verbose output
sam build --config-env dev --debug
```

### Deployment Failures

```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name seller-assistant-api-dev \
  --max-items 10
```

### KMS Access Denied

Ensure the Lambda execution role has KMS permissions:

```bash
aws kms describe-key --key-id alias/seller-assistant-credentials-dev
```

### Couchbase Connection Errors

Test Couchbase connectivity from Lambda:

```bash
# Add debug logging in Lambda
LOG_LEVEL=debug sam local invoke ...
```

## Next Steps

1. Implement Lambda handler functions in `src/handlers/`
2. Add unit tests with Jest
3. Set up CI/CD pipeline (GitHub Actions or AWS CodePipeline)
4. Configure custom domain name for API Gateway
5. Add API authentication (JWT validation from Auth0)
6. Implement rate limiting and throttling
7. Set up CloudWatch dashboards

## References

- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [AWS KMS Best Practices](https://docs.aws.amazon.com/kms/latest/developerguide/best-practices.html)
- [Lambda Powertools](https://docs.powertools.aws.dev/lambda/typescript/latest/)
