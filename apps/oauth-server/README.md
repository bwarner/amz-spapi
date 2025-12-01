# OAuth Server

A standalone OAuth callback server for Amazon Advertising API and Selling Partner API authentication.

## Overview

This server provides a seamless OAuth experience by:
- Starting a local Express server on `localhost:3000`
- Automatically opening your browser to the Amazon authorization page
- Receiving the OAuth callback with the authorization code
- Exchanging the code for access and refresh tokens
- Storing credentials in the local SQLite database
- Shutting down automatically after completion

## Usage

### Via adscli (Recommended)

The easiest way to use this is through the `adscli oauth login` command:

```bash
# Using config file (config.toml with [ads_api] section)
npx nx run adscli:run oauth login

# For SP-API
npx nx run adscli:run oauth login --api sp

# Override config with CLI options
npx nx run adscli:run oauth login \
  --client-id amzn1.application-oa2-client.YOUR_CLIENT_ID \
  --client-secret YOUR_SECRET \
  --marketplace-id ATVPDKIKX0DER \
  --region NA
```

### Standalone (Advanced)

You can also run the oauth-server directly:

```bash
# Using environment variables
CLIENT_ID=amzn1.application-oa2-client.YOUR_ID \
CLIENT_SECRET=YOUR_SECRET \
MARKETPLACE_ID=ATVPDKIKX0DER \
REGION=NA \
API_TYPE=ADS_API \
PROFILE_NAME=default \
node dist/apps/oauth-server/main.js
```

### Via Nx serve

```bash
# Set environment variables first, then:
npx nx serve oauth-server
```

## Configuration

### Environment Variables

- `CLIENT_ID` (required) - Amazon API client ID
- `CLIENT_SECRET` (required) - Amazon API client secret
- `REDIRECT_URI` - OAuth redirect URI (default: `http://localhost:3000/oauth/callback`)
- `MARKETPLACE_ID` - Amazon marketplace ID (default: `ATVPDKIKX0DER` for US)
- `REGION` - Region: NA, EU, or FE (default: `NA`)
- `API_TYPE` - API type: `ADS_API` or `SP_API` (default: `ADS_API`)
- `PROFILE_NAME` - Name for the credential profile (default: `default`)
- `PORT` - Server port (default: `3000`)

### Config File (via adscli)

Create a `config.toml` file:

```toml
[ads_api]
client_id = "amzn1.application-oa2-client.YOUR_CLIENT_ID"
client_secret = "YOUR_SECRET"
redirect_uri = "http://localhost:3000/oauth/callback"
marketplace_id = "ATVPDKIKX0DER"
region = "NA"
profile_name = "default"

[sp_api]
# Similar configuration for SP-API
```

## How It Works

1. **Server Starts**: Launches Express server on specified port
2. **Authorization URL Generated**: Creates OAuth URL with CSRF protection (state parameter)
3. **Browser Opens**: Automatically opens the authorization URL in your default browser
4. **User Authorizes**: You log in to Amazon and approve the app
5. **Callback Received**: Amazon redirects to `http://localhost:3000/oauth/callback`
6. **Token Exchange**: Server exchanges the authorization code for tokens
7. **Credentials Stored**: Tokens are encrypted and stored in SQLite database at `~/.amazon-seller-assistant/credentials.db`
8. **Success Page**: Browser shows success page with profile details
9. **Server Stops**: Server automatically shuts down

## Security Features

- **CSRF Protection**: State parameter validates callback authenticity
- **AES-256-GCM Encryption**: Credentials encrypted at rest in SQLite
- **Automatic Cleanup**: Server shuts down after OAuth completion
- **Local Only**: Server only listens on localhost

## Endpoints

- `GET /health` - Health check endpoint
- `GET /oauth/callback` - OAuth callback endpoint (used by Amazon)

## Error Handling

The server provides user-friendly error pages for:
- Authorization failures
- Missing authorization code
- Missing state parameter (security error)
- Token exchange failures

All errors are logged to console and displayed in the browser.

## Integration

This server is designed to be imported and used programmatically:

```typescript
import { startOAuthServer } from './apps/oauth-server/src/main.js';

const result = await startOAuthServer({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_SECRET',
  redirectUri: 'http://localhost:3000/oauth/callback',
  marketplaceId: 'ATVPDKIKX0DER',
  region: 'NA',
  apiType: 'ADS_API',
  profileName: 'default',
  port: 3000,
});

if (result.success) {
  console.log(`Profile ${result.profileName} created!`);
} else {
  console.error(`OAuth failed: ${result.error}`);
}
```

## Dependencies

- `express` - Web server
- `open` - Auto-open browser
- `@farvisionllc/credential-store` - Credential storage
- `@farvisionllc/models` - Type definitions

## Related

- [adscli](../adscli/README.md) - Command-line interface for Amazon Ads API
- [credential-store](../../packages/credential-store/README.md) - Credential storage package
