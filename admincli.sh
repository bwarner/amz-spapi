#!/usr/bin/env bash
# Sellavant admin CLI — workspaces, members, invitations.
#
# Distinct from spcli.sh / adscli.sh, which talk to Amazon. This one administers
# the product itself, and is the escape hatch when the invite gate has locked
# everybody out: it reaches Couchbase directly and needs nobody to be signed in.
#
# Reads the app's environment file for the Couchbase Data API connection, so it
# targets whichever scope CB_SCOPE names. Override with ENV_FILE=… to point at
# staging or prod.

set -euo pipefail

ENV_FILE="${ENV_FILE:-apps/web/.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "No env file at $ENV_FILE. Set ENV_FILE=<path> to choose another." >&2
  exit 1
fi

# Build if needed (output suppressed to keep stdout clean for piping).
if [ ! -f "dist/apps/admincli/main.js" ]; then
  npx nx build admincli >/dev/null 2>&1
fi

# `env -u ELECTRON_RUN_AS_NODE` because a VSCode integrated terminal exports it,
# and it makes node misinterpret its own arguments.
#
# `--env-file` rather than sourcing: the shell re-expands values, so a Couchbase
# password containing $, ` or ! arrives truncated and the only symptom is an
# authentication failure indistinguishable from a wrong password.
exec env -u ELECTRON_RUN_AS_NODE node --env-file="$ENV_FILE" dist/apps/admincli/main.js "$@"
