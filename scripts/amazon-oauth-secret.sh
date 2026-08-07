#!/usr/bin/env bash
#
# Create or update a stage's Amazon LWA application credentials secret (#55).
#
# These are OUR two LWA applications — SP-API and Ads — not a seller's. Their
# client secrets mint access tokens from EVERY connected seller's refresh token,
# which is why they belong here and not in a Vercel environment variable or a
# Lambda env var: the first is readable in a dashboard, the second is returned
# by GetFunctionConfiguration to anyone with read access on the function.
#
# Both applications live in one secret because they are registered and rotated
# together, and because a stage holding one but not the other fails at the first
# token refresh rather than at deploy.
#
# Secrets are read from a prompt or stdin and passed to the AWS CLI through a
# pipe, never as an argument: an inline --secret-string puts them in your shell
# history and in the `aws` process's command line, where `ps` can read them.
#
#   ./scripts/amazon-oauth-secret.sh dev            # create or rotate
#   ./scripts/amazon-oauth-secret.sh dev --show     # print it, secrets redacted
#
set -euo pipefail

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: amazon-oauth-secret.sh <dev|staging|prod> [options]

  --sp-client-id ID    SP-API LWA client id   (default: the current secret's)
  --ads-client-id ID   Ads API LWA client id  (default: the current secret's)
  --profile NAME       AWS profile            (default: per stage)
  --region NAME        AWS region             (default: us-east-1)
  --show               Print the current secret with the secrets redacted
  --dry-run            Show what would be written, then stop

The two client SECRETS are prompted for, or read from stdin as two lines
(SP-API first, then Ads) if this is a pipe. Client ids are not secret and may
be passed as flags; existing values are reused for anything not given, so
rotating just the secrets is:

  ./scripts/amazon-oauth-secret.sh dev

The secret NAME is the contract with infra/aws/config/stages.ts. Changing one
without the other deploys a function that fails at its first token refresh.
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
STAGE="$1"; shift

case "$STAGE" in
  dev)     SECRET=sellavant-dev-amazon-oauth;     PROFILE=sellavant-dev ;;
  staging) SECRET=sellavant-staging-amazon-oauth; PROFILE=sellavant-dev ;;
  prod)    SECRET=sellavant-prod-amazon-oauth;    PROFILE=sellavant-prod ;;
  *) die "unknown stage '$STAGE' (expected dev, staging or prod)" ;;
esac

REGION=us-east-1
SP_CLIENT_ID=""
ADS_CLIENT_ID=""
SHOW=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sp-client-id)  SP_CLIENT_ID="${2:?--sp-client-id needs a value}"; shift 2 ;;
    --ads-client-id) ADS_CLIENT_ID="${2:?--ads-client-id needs a value}"; shift 2 ;;
    --profile)       PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --region)        REGION="${2:?--region needs a value}"; shift 2 ;;
    --show)          SHOW=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       usage ;;
    *) die "unknown option '$1'" ;;
  esac
done

aws_sm() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

# Fail on an expired SSO session here, with the command that fixes it, rather
# than inside a create-secret call where the error is about credentials.
if ! ACCOUNT="$(aws_sm sts get-caller-identity --query Account --output text 2>/dev/null)"; then
  die "profile '$PROFILE' has no valid credentials. Run: aws sso login --profile $PROFILE"
fi

EXISTING="$(aws_sm secretsmanager get-secret-value --secret-id "$SECRET" \
  --query SecretString --output text 2>/dev/null || true)"

# Always succeeds, printing nothing when there is no secret yet. It is read
# inside a command substitution, and under `set -e` a non-zero return there
# would abort the whole script.
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
  printf '  %-18s %s\n' spApiClientId "$(field spApiClientId)"
  printf '  %-18s %s\n' spApiClientSecret '<redacted>'
  printf '  %-18s %s\n' adsClientId "$(field adsClientId)"
  printf '  %-18s %s\n' adsClientSecret '<redacted>'
  exit 0
fi

# An explicit flag wins; otherwise keep what the secret already holds. There is
# no stage default: a wrong client id looks configured and fails at Amazon with
# `invalid_client`, which says nothing about where it came from.
[[ -n "$SP_CLIENT_ID"  ]] || SP_CLIENT_ID="$(field spApiClientId)"
[[ -n "$ADS_CLIENT_ID" ]] || ADS_CLIENT_ID="$(field adsClientId)"
[[ -n "$SP_CLIENT_ID"  ]] || die "no --sp-client-id given and the secret has none. Find it in the Amazon developer console under Apps & Services > Develop Apps."
[[ -n "$ADS_CLIENT_ID" ]] || die "no --ads-client-id given and the secret has none."

printf 'stage    %s\n'                  "$STAGE"
printf 'secret   %s\n'                  "$SECRET"
printf 'account  %s (profile %s, %s)\n' "$ACCOUNT" "$PROFILE" "$REGION"
printf 'sp  id   %s\n'                  "$SP_CLIENT_ID"
printf 'ads id   %s\n'                  "$ADS_CLIENT_ID"
printf 'action   %s\n' "$([[ -n "$EXISTING" ]] && echo 'update existing' || echo 'create new')"

[[ "$DRY_RUN" == 0 ]] || { printf '\ndry run — nothing written\n'; exit 0; }

if [[ -t 0 ]]; then
  # -s so they are not echoed; the trailing newlines are ours because read ate
  # them.
  read -rs -p "SP-API client secret: " SP_SECRET;  printf '\n'
  read -rs -p "Ads client secret:    " ADS_SECRET; printf '\n'
else
  read -r SP_SECRET
  read -r ADS_SECRET
fi
[[ -n "$SP_SECRET"  ]] || die "empty SP-API client secret"
[[ -n "$ADS_SECRET" ]] || die "empty Ads client secret"

# node rather than printf/jq: it escapes quotes and backslashes correctly, and a
# secret containing " would otherwise produce malformed JSON that only fails
# later, at the first token refresh.
#
# The two secrets go in over stdin as two lines, so neither is ever an argv
# entry — `ps` can read another user's command line, and this is the one value
# in the system that unlocks every connected seller.
PAYLOAD="$(printf '%s\n%s\n' "$SP_SECRET" "$ADS_SECRET" | node -e '
  const [spApiClientId, adsClientId] = process.argv.slice(1);
  let input = "";
  process.stdin.on("data", d => input += d).on("end", () => {
    const [spApiClientSecret, adsClientSecret] = input.split("\n");
    process.stdout.write(JSON.stringify({
      spApiClientId, spApiClientSecret, adsClientId, adsClientSecret,
    }));
  });' "$SP_CLIENT_ID" "$ADS_CLIENT_ID")"

unset SP_SECRET ADS_SECRET

if [[ -n "$EXISTING" ]]; then
  printf '%s' "$PAYLOAD" | aws_sm secretsmanager put-secret-value \
    --secret-id "$SECRET" --secret-string file:///dev/stdin >/dev/null
  printf '\nupdated %s\n' "$SECRET"
  printf 'Warm Lambda containers pick this up within CB_SECRET_TTL_MS (default 10 min).\n'
else
  printf '%s' "$PAYLOAD" | aws_sm secretsmanager create-secret \
    --name "$SECRET" \
    --description "Amazon LWA application credentials (SP-API and Ads) for $STAGE" \
    --secret-string file:///dev/stdin >/dev/null
  printf '\ncreated %s\n' "$SECRET"
fi

unset PAYLOAD

# Prove it round-trips. `fromSecretNameV2` does not check existence at synth, so
# a name that does not resolve fails at the first Lambda invocation instead.
#
# Retried because Secrets Manager is eventually consistent on create: a read
# immediately after a successful CreateSecret can still answer
# ResourceNotFoundException, which reads exactly like the failure this check
# exists to catch.
for attempt in 1 2 3 4 5; do
  if ARN="$(aws_sm secretsmanager get-secret-value --secret-id "$SECRET" \
      --query ARN --output text 2>/dev/null)"; then
    printf 'arn      %s\n' "$ARN"
    exit 0
  fi
  sleep "$attempt"
done
die "wrote '$SECRET' but could not read it back. Check the console."
