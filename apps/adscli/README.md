# Amazon Advertising API CLI (adscli)

Command-line interface for managing Amazon Advertising API credentials and making API calls.

## Features

- 🔐 **Secure OAuth Flow**: Complete OAuth 2.0 authorization with Amazon LWA
- 💾 **Encrypted Local Storage**: Credentials stored securely in SQLite with AES-256-GCM encryption
- 🔄 **Automatic Token Refresh**: Tokens refresh automatically when expired
- 📁 **Config File Support**: Store OAuth client credentials in `config.toml`
- 🎯 **Multiple Profiles**: Manage multiple Amazon accounts/profiles
- 🚀 **Ready for SP-API**: Same CLI works for both Ads API and Selling Partner API

## Installation

Build the CLI:

```bash
npx nx run adscli:build
```

The built CLI will be at `dist/apps/adscli/main.js`

## Configuration

### Option 1: Using config.toml (Recommended)

Copy the example config:

```bash
cd apps/adscli
cp config.example.toml config.toml
```

Edit `config.toml` with your OAuth credentials:

```toml
[ads_api]
client_id = "amzn1.application-oa2-client.YOUR_CLIENT_ID"
client_secret = "amzn1.oa2-cs.v1.YOUR_CLIENT_SECRET"
redirect_uri = "http://localhost:3000/oauth/callback"
marketplace_id = "ATVPDKIKX0DER"  # US marketplace
region = "NA"
profile_name = "default"

[sp_api]
client_id = "amzn1.application-oa2-client.YOUR_SP_CLIENT_ID"
client_secret = "amzn1.oa2-cs.v1.YOUR_SP_CLIENT_SECRET"
redirect_uri = "http://localhost:3000/oauth/callback"
marketplace_id = "ATVPDKIKX0DER"
region = "NA"
profile_name = "default"
```

**Important**: Keep this file secure! It contains your client secret.

### Option 2: Command-line Arguments

You can also provide credentials via command-line arguments (overrides config file):

```bash
node main.js oauth authorize \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_SECRET \
  --redirect-uri http://localhost:3000/callback \
  --marketplace-id ATVPDKIKX0DER
```

## Usage

### 1. OAuth Authorization

#### Step 1: Start Authorization Flow

With config file:
```bash
node main.js oauth authorize
```

With command-line options:
```bash
node main.js oauth authorize \
  --client-id amzn1.application-oa2-client.YOUR_ID \
  --client-secret amzn1.oa2-cs.v1.YOUR_SECRET \
  --redirect-uri http://localhost:3000/oauth/callback \
  --marketplace-id ATVPDKIKX0DER \
  --region NA \
  --profile-name my-ads-account
```

For SP-API:
```bash
node main.js oauth authorize --api sp
```

This will output:
- An authorization URL
- A state parameter (save this!)

#### Step 2: Authorize in Browser

1. Visit the authorization URL in your browser
2. Log in with your Amazon account
3. Grant permissions
4. Copy the authorization code from the redirect URL

#### Step 3: Complete Authorization

With config file:
```bash
node main.js oauth callback \
  --code ANVzLyourAuthCode \
  --state eyJhcGlUeXBlIjoiQURTX0FQSSIsI...
```

With command-line options:
```bash
node main.js oauth callback \
  --code ANVzLyourAuthCode \
  --state eyJhcGlUeXBlIjoiQURTX0FQSSIsI... \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_SECRET \
  --redirect-uri http://localhost:3000/oauth/callback \
  --marketplace-id ATVPDKIKX0DER
```

For Ads API, optionally provide:
```bash
--advertiser-profile-id 1234567890
```

For SP-API, optionally provide:
```bash
--seller-id A1234567890123
```

### 2. Manage Credentials

#### List all profiles
```bash
node main.js credentials list
```

#### Show profile details
```bash
node main.js credentials show [profile-name]
```

Example output:
```
Profile Details:
  Name: default
  API Type: ADS_API
  Client ID: amzn1.application-oa2-client.3ba...
  Marketplace: ATVPDKIKX0DER
  Region: NA
  Advertiser Profile ID: 1234567890
  Has Access Token: Yes
  Has Refresh Token: Yes
  Token Expires: 2025-11-28T18:32:45.123Z
```

#### Set default profile
```bash
node main.js credentials set-default my-ads-account
```

#### Delete a profile
```bash
node main.js credentials delete old-profile
```

### 3. Make API Calls

#### Get advertiser profiles
```bash
node main.js get-profiles
```

With a specific profile:
```bash
node main.js get-profiles --profile my-ads-account
```

The API client automatically refreshes expired tokens!

## Credential Storage

Credentials are stored securely at:
```
~/.amazon-seller-assistant/credentials.db
```

The database contains:
- **Encrypted fields**: client_secret, refresh_token, access_token (AES-256-GCM)
- **Plain fields**: profile_name, client_id, marketplace_id, region, etc.

The encryption key is derived from your machine's hostname and username. For production use, consider using a password-protected key.

## Global Options

- `-c, --config <path>`: Config file path (default: `config.toml`)
- `-l, --log-level <level>`: Log level (error, warn, info, debug, trace)
- `-p, --profile <name>`: Credential profile to use (default: `default`)

## Examples

### Complete OAuth Flow with Config File

```bash
# 1. Edit config.toml with your credentials
vim config.toml

# 2. Start authorization
node main.js oauth authorize

# 3. Visit URL, authorize, copy code

# 4. Complete authorization
node main.js oauth callback \
  --code YOUR_CODE \
  --state YOUR_STATE

# 5. Make API calls
node main.js get-profiles
```

### Multiple Profiles

```bash
# Authorize first account
node main.js oauth authorize --profile-name production

# Authorize second account
node main.js oauth authorize --profile-name staging

# List profiles
node main.js credentials list

# Use specific profile
node main.js get-profiles --profile production
```

### SP-API Example

```bash
# Authorize SP-API
node main.js oauth authorize --api sp --profile-name sp-production

# Complete callback
node main.js oauth callback \
  --code YOUR_CODE \
  --state YOUR_STATE \
  --seller-id A1234567890123

# Use SP-API (when implemented)
node main.js sp get-orders --profile sp-production
```

## Marketplace IDs

Common marketplace IDs:

| Marketplace | ID | Region |
|------------|------------|--------|
| US | ATVPDKIKX0DER | NA |
| Canada | A2EUQ1WTGCTBG2 | NA |
| Mexico | A1AM78C64UM0Y8 | NA |
| UK | A1F83G8C2ARO7P | EU |
| Germany | A1PA6795UKMFR9 | EU |
| France | A13V1IB3VIYZZH | EU |
| Italy | APJ6JRA9NG5V4 | EU |
| Spain | A1RKKUPIHCS9HS | EU |
| Japan | A1VC38T7YXB528 | FE |
| Australia | A39IBJ37TRP1C6 | FE |

## Troubleshooting

### "Config validation failed"

- Check that all required fields are present in `config.toml`
- Ensure field names match exactly (e.g., `client_id` not `clientId`)

### "OAuth state has expired"

- The state parameter is only valid for 15 minutes
- Start a new authorization flow with `oauth authorize`

### "Token refresh failed"

- Your refresh token may have been revoked
- Re-authorize with `oauth authorize` and `oauth callback`

### "Profile not found"

- List available profiles: `node main.js credentials list`
- Create a new profile with the OAuth flow

## Security Best Practices

1. **Never commit `config.toml`**: Add it to `.gitignore`
2. **Use config.example.toml as a template**: Share the example, not the real config
3. **Rotate credentials regularly**: Especially if they may have been exposed
4. **Limit redirect URIs**: Only use localhost or HTTPS URLs you control
5. **Monitor API usage**: Check for unexpected activity in Amazon's console

## Development

The CLI is built with:
- **Commander.js**: CLI framework
- **Pino**: Logging
- **Better-SQLite3**: Database
- **Zod**: Schema validation
- **TOML**: Config parsing

Directory structure:
```
apps/adscli/
├── src/
│   └── main.ts          # CLI implementation
├── config.toml          # Your OAuth credentials (gitignored)
├── config.example.toml  # Template
└── README.md           # This file
```

## Next Steps

1. Implement more API commands (campaigns, ad groups, keywords, etc.)
2. Add batch operations
3. Add report generation
4. Create interactive mode
5. Add SP-API commands

## Related Documentation

- [Amazon Advertising API](https://advertising.amazon.com/API/docs)
- [Amazon SP-API](https://developer-docs.amazon.com/sp-api/)
- [LWA OAuth Guide](https://developer.amazon.com/docs/login-with-amazon/documentation.html)
