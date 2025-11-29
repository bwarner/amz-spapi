#!/usr/bin/env bash
# Ads API CLI wrapper - handles special characters in refresh tokens correctly

# Build if needed
if [ ! -f "dist/apps/adscli/main.js" ]; then
  npx nx build adscli >/dev/null 2>&1
fi

# Run with proper argument forwarding
node dist/apps/adscli/main.js "$@"
