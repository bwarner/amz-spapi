#!/usr/bin/env bash
#
# Create or update a stage's Couchbase connection secret.
#
# The secret holds the WHOLE connection as one unit — host, bucket, scope,
# username, password — because they change together: a rebuilt cluster has a new
# hostname and new users. One write moves an environment, with no deploy.
# See docs/adr/0010-lambdas-reach-couchbase-over-the-data-api.md.
#
# The password is read from a prompt or stdin and passed to the AWS CLI through
# a pipe, never as an argument: an inline --secret-string puts it in your shell
# history and in the `aws` process's command line, where `ps` can read it.
#
#   ./scripts/couchbase-secret.sh dev             # create or rotate; asks only
#   ./scripts/couchbase-secret.sh staging         # for the password
#   ./scripts/couchbase-secret.sh dev --show      # print it, password redacted
#   ./scripts/couchbase-secret.sh dev --url https://new.data.cloud.couchbase.com
#
set -euo pipefail

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: couchbase-secret.sh <dev|staging|prod> [options]

  --url URL         Data API base URL. Defaults to the current secret,
                    then to the stage default. Required for prod.
  --bucket NAME     Couchbase bucket        (default: per stage, below)
  --scope NAME      Environment scope       (default: the stage name, ADR-0005)
  --username NAME   Database user           (default: per stage, below)
  --profile NAME    AWS profile             (default: per stage, below)
  --region NAME     AWS region              (default: us-east-1)
  --show            Print the current secret with the password redacted
  --dry-run         Show what would be written, then stop

The password is prompted for, or read from stdin if this is a pipe.
Existing values are reused for anything not passed, so rotating a password is:

  ./scripts/couchbase-secret.sh dev
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
STAGE="$1"; shift

# Defaults per stage, matching what the app already uses — dev from
# apps/web/.env.local, staging from apps/web/.env.staging. Everything here is an
# identifier, never a password, so running the script with no flags at all
# reproduces the current configuration and asks only for the password.
#
# Dev and staging share one AWS account and one Capella cluster, separated by
# scope AND by database user (ADR-0005) — a wrong scope then fails closed with
# `access denied` rather than reading the other environment's data.
#
# The secret NAME is the contract between this script and the CDK stack; it must
# match infra/aws/config/stages.ts.
CB_HOST=https://vnabxcz0z00zh27a.data.cloud.couchbase.com

case "$STAGE" in
  dev)
    SECRET=sellavant-dev-couchbase
    PROFILE=sellavant-dev
    BUCKET=sell-avant
    USERNAME=SellAvant
    URL_DEFAULT="$CB_HOST"
    ;;
  staging)
    SECRET=sellavant-staging-couchbase
    PROFILE=sellavant-dev
    BUCKET=sell-avant
    USERNAME=sellavant-staging
    URL_DEFAULT="$CB_HOST"
    ;;
  prod)
    # Prod is a DIFFERENT cluster (SellAvantProd) and has no scope yet, so there
    # is no host to default to — ADR-0010. --url is required here.
    SECRET=sellavant-prod-couchbase
    PROFILE=sellavant-prod
    BUCKET=SellAvantProd
    USERNAME=sellavant-prod
    URL_DEFAULT=""
    ;;
  *) die "unknown stage '$STAGE' (expected dev, staging or prod)" ;;
esac

SCOPE="$STAGE"
REGION=us-east-1
URL_EXPLICIT=""
SHOW=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)      URL_EXPLICIT="${2:?--url needs a value}"; shift 2 ;;
    --bucket)   BUCKET="${2:?--bucket needs a value}"; shift 2 ;;
    --scope)    SCOPE="${2:?--scope needs a value}"; shift 2 ;;
    --username) USERNAME="${2:?--username needs a value}"; shift 2 ;;
    --profile)  PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --region)   REGION="${2:?--region needs a value}"; shift 2 ;;
    --show)     SHOW=1; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)  usage ;;
    *) die "unknown option '$1'" ;;
  esac
done

aws_cb() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

# Fail on an expired SSO session here, with the command that fixes it, rather
# than inside a create-secret call where the error is about credentials.
if ! ACCOUNT="$(aws_cb sts get-caller-identity --query Account --output text 2>/dev/null)"; then
  die "profile '$PROFILE' has no valid credentials. Run: aws sso login --profile $PROFILE"
fi

EXISTING="$(aws_cb secretsmanager get-secret-value --secret-id "$SECRET" \
  --query SecretString --output text 2>/dev/null || true)"

# Always succeeds, printing nothing when there is no secret yet. It is read
# inside a command substitution, and under `set -e` a non-zero return there
# aborts the whole script — which is how an ordinary "creating from scratch"
# turned into silent no output.
field() {
  [[ -n "$EXISTING" ]] || return 0
  printf '%s' "$EXISTING" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { process.stdout.write(String(JSON.parse(s)[process.argv[1]] ?? "")) } catch {}
    })' "$1"
}

if [[ "$SHOW" == 1 ]]; then
  [[ -n "$EXISTING" ]] || die "secret '$SECRET' does not exist in account $ACCOUNT"
  printf 'secret   %s (account %s, %s)\n' "$SECRET" "$ACCOUNT" "$REGION"
  for k in dataApiUrl bucket scope username; do
    printf '  %-11s %s\n' "$k" "$(field "$k")"
  done
  printf '  %-11s %s\n' password '<redacted>'
  exit 0
fi

# Precedence: an explicit --url wins; otherwise keep whatever the secret already
# holds; only fall back to the stage default when creating from nothing. This
# ordering matters — defaulting ahead of the stored value would silently move a
# relocated cluster back on the next password rotation.
URL="${URL_EXPLICIT:-$(field dataApiUrl)}"
[[ -n "$URL" ]] || URL="$URL_DEFAULT"
[[ -n "$URL" ]] || die "no --url given and the secret has none. Find it in the Capella console under Connect > Data API."
[[ "$URL" == https://* ]] || die "--url must start with https:// (got '$URL')"

printf 'stage    %s\n'                      "$STAGE"
printf 'secret   %s\n'                      "$SECRET"
printf 'account  %s (profile %s, %s)\n'     "$ACCOUNT" "$PROFILE" "$REGION"
printf 'url      %s\n'                      "$URL"
printf 'bucket   %s\n'                      "$BUCKET"
printf 'scope    %s\n'                      "$SCOPE"
printf 'username %s\n'                      "$USERNAME"
printf 'action   %s\n' "$([[ -n "$EXISTING" ]] && echo 'update existing' || echo 'create new')"

[[ "$DRY_RUN" == 0 ]] || { printf '\ndry run — nothing written\n'; exit 0; }

if [[ -t 0 ]]; then
  # -s so it is not echoed; the trailing newline is ours because read ate it.
  read -rs -p "password for ${USERNAME}: " PASSWORD; printf '\n'
else
  read -r PASSWORD
fi
[[ -n "$PASSWORD" ]] || die "empty password"

# node rather than printf/jq: it escapes quotes and backslashes correctly, and a
# password containing " would otherwise produce malformed JSON that only fails
# later, at the first Data API call.
PAYLOAD_CMD=(node -e '
  const [dataApiUrl,bucket,scope,username] = process.argv.slice(1);
  let password = "";
  process.stdin.on("data", d => password += d).on("end", () => {
    process.stdout.write(JSON.stringify({
      dataApiUrl, bucket, scope, username, password: password.replace(/\n$/, ""),
    }));
  });' "$URL" "$BUCKET" "$SCOPE" "$USERNAME")

if [[ -n "$EXISTING" ]]; then
  printf '%s' "$PASSWORD" | "${PAYLOAD_CMD[@]}" | aws_cb secretsmanager put-secret-value \
    --secret-id "$SECRET" --secret-string file:///dev/stdin >/dev/null
  printf '\nupdated %s\n' "$SECRET"
  printf 'Warm Lambda containers pick this up within CB_SECRET_TTL_MS (default 10 min).\n'
else
  printf '%s' "$PASSWORD" | "${PAYLOAD_CMD[@]}" | aws_cb secretsmanager create-secret \
    --name "$SECRET" \
    --description "Couchbase connection for the $STAGE scope" \
    --secret-string file:///dev/stdin >/dev/null
  printf '\ncreated %s\n' "$SECRET"
fi

unset PASSWORD

# Prove it round-trips. `fromSecretNameV2` does not check existence at synth, so
# a name that does not resolve fails at the first Lambda invocation instead.
printf 'arn      %s\n' \
  "$(aws_cb secretsmanager get-secret-value --secret-id "$SECRET" --query ARN --output text)"
