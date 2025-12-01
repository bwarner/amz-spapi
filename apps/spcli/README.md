# spcli - Amazon Selling Partner API CLI

Command-line interface for interacting with Amazon SP-API (Selling Partner API).

## Setup

### 1. Create Configuration File

Copy the example config and fill in your credentials:

```bash
cp config.toml.example config.toml
```

Edit `config.toml` with your Amazon Seller Central credentials:

```toml
[sp_api]
client_id = "amzn1.application-oa2-client.YOUR_CLIENT_ID"
client_secret = "amzn1.oa2-cs.v1.YOUR_CLIENT_SECRET"
marketplace_id = "ATVPDKIKX0DER"  # US marketplace
region = "NA"
```

**Getting Credentials:**
1. Go to [Amazon Seller Central](https://sellercentral.amazon.com/apps/authorize/consent)
2. Create a new LWA application for SP-API
3. Copy the Client ID and Client Secret

### 2. Add Refresh Token

Generate a refresh token through Amazon's OAuth flow, then add credentials:

```bash
./spcli.sh credentials add --refresh-token "YOUR_REFRESH_TOKEN"
```

The CLI will automatically:
- Load client_id, client_secret, and marketplace_id from config.toml
- Store the refresh token securely in SQLite
- Manage access token refresh automatically

## Usage

### Catalog Commands

Get product information by ASIN:

```bash
# Get basic catalog item
./spcli.sh catalog get B0DFGKXTBZ

# Get with additional data
./spcli.sh catalog get B0DFGKXTBZ \
  --include-summaries \
  --include-images \
  --include-sales-ranks

# Bulk fetch from file
cat asins.txt | ./spcli.sh catalog get --format json
```

### Orders Commands

List orders within a date range:

```bash
# Last 7 days of orders
./spcli.sh orders list --days 7

# Orders from specific date range
./spcli.sh orders list \
  --created-after 2024-01-01T00:00:00Z \
  --created-before 2024-01-31T23:59:59Z

# Filter by status and fulfillment
./spcli.sh orders list --days 30 \
  --status Shipped,Unshipped \
  --fulfillment AFN \
  --format csv
```

Get order details:

```bash
# Single order
./spcli.sh orders get 111-1234567-1234567

# With line items
./spcli.sh orders get 111-1234567-1234567 --include-items

# Multiple orders from pipeline
./spcli.sh orders list --days 3 --format json | \
  jq -r '.[].orderId' | \
  ./spcli.sh orders get --format table
```

### Credential Management

```bash
# List stored profiles
./spcli.sh credentials list

# Show profile details
./spcli.sh credentials show default

# Add new profile
./spcli.sh credentials add \
  --profile-name production \
  --refresh-token "YOUR_TOKEN"

# Delete profile
./spcli.sh credentials delete old-profile

# Set default profile
./spcli.sh credentials set-default production
```

## Output Formats

- `json` - Full JSON response with all fields
- `table` - Tab-separated human-readable table (default for TTY)
- `csv` - Comma-separated values
- `asin` - Only ASIN values (for piping)

## Environment Variables

- `LOG_LEVEL` - Logging level (debug, info, warn, error)
- `NO_PRETTY` - Disable pretty logging

## Security

- ⚠️ **Never commit `config.toml`** - it contains sensitive credentials
- Credentials are stored in SQLite at `~/.config/amz-spapi/credentials.db`
- Access tokens are automatically refreshed and cached
- Refresh tokens are stored encrypted

## Pipeline Mode

The CLI is designed to work with Unix pipelines:

```bash
# Extract order IDs and fetch details
./spcli.sh orders list --days 1 --format json | \
  jq -r '.[].orderId' | \
  ./spcli.sh orders get --include-items > orders.json

# Get ASINs from orders
./spcli.sh orders get ORDER_ID --include-items --format json | \
  jq -r '.items[].ASIN' | \
  ./spcli.sh catalog get --include-images
```
