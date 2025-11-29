# CLI Tools Usage Guide

This monorepo contains two separate CLI tools for Amazon APIs:

## 🛒 spcli - Selling Partner API CLI

**Authorization Method**: Self-Authorization (Private App)

### Setup

1. **Create an SP-API app** in Amazon Seller Central:
   - Go to Settings → User Permissions → Developer Central
   - Create a new self-authorized app
   - Copy the **LWA Client ID** and **LWA Client Secret**
   - Generate a **Refresh Token** (you'll get this immediately)

2. **Configure** `apps/spcli/config.toml`:
   ```toml
   [sp_api]
   client_id = "amzn1.application-oa2-client.YOUR_CLIENT_ID"
   client_secret = "amzn1.oa2-cs.v1.YOUR_CLIENT_SECRET"
   marketplace_id = "ATVPDKIKX0DER"  # US marketplace
   region = "NA"
   profile_name = "default"
   ```

3. **Add credentials** with your refresh token:
   ```bash
   ./spcli.sh credentials add \
     --refresh-token "Atzr|YOUR_REFRESH_TOKEN" \
     --config apps/spcli/config.toml
   ```

### Commands

```bash
# List stored credentials
./spcli.sh credentials list

# Show credential details
./spcli.sh credentials show

# Delete credentials
./spcli.sh credentials delete <profile-name>

# Query catalog (coming soon)
./spcli.sh catalog

# Query orders (coming soon)
./spcli.sh orders
```

---

## 📊 adscli - Advertising API CLI

**Authorization Method**: OAuth Flow (Public App)

### Setup

1. **Create an Ads API app** in Amazon Advertising Console:
   - Register your application
   - Copy the **Client ID** and **Client Secret**
   - Set redirect URI to `http://localhost:3000/oauth/callback`

2. **Configure** `apps/adscli/config.toml`:
   ```toml
   [ads_api]
   client_id = "amzn1.application-oa2-client.YOUR_CLIENT_ID"
   client_secret = "amzn1.oa2-cs.v1.YOUR_CLIENT_SECRET"
   redirect_uri = "http://localhost:3000/oauth/callback"
   marketplace_id = "ATVPDKIKX0DER"
   region = "NA"
   profile_name = "default"
   ```

3. **Authorize** via OAuth:
   ```bash
   # Easiest method - opens browser automatically
   ./adscli.sh oauth login --api ads --config apps/adscli/config.toml
   ```

### Commands

```bash
# OAuth authorization
./adscli.sh oauth login --api ads        # Interactive browser flow
./adscli.sh oauth authorize --api ads    # Manual flow (step 1)
./adscli.sh oauth callback --code <code> --state <state>  # Manual flow (step 2)

# Credential management
./adscli.sh credentials list
./adscli.sh credentials show

# API operations
./adscli.sh get-profiles  # Get advertiser profiles
```

---

## Why Two Separate CLIs?

### SP-API
- ✅ Supports self-authorization
- ✅ Simple workflow: copy refresh token from Seller Central
- ❌ No OAuth redirect needed
- **Use case**: Developer tools, private automation

### Ads API
- ❌ Does NOT support self-authorization
- ✅ Requires full OAuth flow
- ✅ Browser-based authorization
- **Use case**: Public apps, multi-user scenarios

---

## Architecture

Both CLIs share:
- **Credential Store**: Encrypted SQLite database (`~/.amazon-seller-assistant/credentials.db`)
- **Token Refresh**: Automatic LWA token refresh mechanism
- **Encryption**: AES-256-GCM for sensitive data

Separation:
- Stored by `api_type` field: `SP_API` vs `ADS_API`
- Different authorization flows
- Separate config files

---

## Troubleshooting

### Special Characters in Refresh Tokens

Amazon refresh tokens contain pipe characters (`|`). Always use quotes:

```bash
# ✅ Correct
./spcli.sh credentials add --refresh-token "Atzr|..."

# ❌ Wrong (shell interprets | as pipe)
./spcli.sh credentials add --refresh-token Atzr|...
```

### Why Not Use `npx nx run`?

The Nx `run-commands` executor doesn't properly escape special characters. Use the wrapper scripts instead:

```bash
# ❌ Doesn't work (shell escaping issues)
npx nx run spcli -- credentials add --refresh-token "Atzr|..."

# ✅ Use wrapper
./spcli.sh credentials add --refresh-token "Atzr|..."

# ✅ Or run directly
node dist/apps/spcli/main.js credentials add --refresh-token "Atzr|..."
```

---

## Development

Build both CLIs:
```bash
npx nx build spcli adscli
```

The wrapper scripts auto-build if needed, but you can build manually first for faster execution.

---

## Security Notes

- Credentials are stored in `~/.amazon-seller-assistant/credentials.db`
- Sensitive fields are encrypted with AES-256-GCM
- Encryption key is derived from machine-specific data
- For production web app, use AWS KMS instead
