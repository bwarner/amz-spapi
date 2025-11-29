#!/usr/bin/env bash
# SP-API CLI wrapper - handles special characters in refresh tokens correctly

# Build if needed
if [ ! -f "dist/apps/spcli/main.js" ]; then
  npx nx build spcli >/dev/null 2>&1
fi

# Run with proper argument forwarding
node dist/apps/spcli/main.js "$@"
