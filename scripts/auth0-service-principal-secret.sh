#!/usr/bin/env bash
#
# Create or update a stage's Auth0 service-principal secret (#152).
#
# This is the identity an UNATTENDED worker authenticates as. A scheduled sync
# has no user, so it cannot carry a user's token; it presents this machine
# identity to the credential service, which mints a short-lived Amazon token for
# a named seller.
#
# It is NOT the Amazon material — that stays in the credentials function, and
# this secret cannot decrypt anything. It is still a credential that reaches an
# endpoint able to mint for any connected seller, which is why it belongs here
# and not in a Lambda environment variable: an env var is written into the
# CloudFormation template and returned by GetFunctionConfiguration to anyone with
# read access on the function.
#
# All four fields live together because they rotate together. Rotating the
# application changes clientId and clientSecret; moving tenants changes domain
# too. Split across a template and a secret, a rotation leaves a window where one
# half is new and the other is not, and Auth0 answers that with `invalid_client`
# — a message that says nothing about which half was stale.
#
# The client secret is read from a prompt or stdin and passed to the AWS CLI
# through a pipe, never as an argument: `ps` can read another user's command
# line.
#
#   ./scripts/auth0-service-principal-secret.sh dev            # create or rotate
#   ./scripts/auth0-service-principal-secret.sh dev --show     # print, redacted
#
set -euo pipefail

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: auth0-service-principal-secret.sh <dev|staging|prod> [options]

  --domain DOMAIN      Auth0 tenant, no scheme  (default: the current secret's)
  --audience URL       API identifier           (default: the current secret's)
  --client-id ID       M2M application id       (default: the current secret's)
  --profile NAME       AWS profile              (default: per stage)
  --region NAME        AWS region               (default: us-east-1)
  --show               Print the current secret with the secret redacted
  --dry-run            Show what would be written, then stop

The client SECRET is prompted for, or read from stdin if this is a pipe. The
other three are not secrets and may be passed as flags; existing values are
reused for anything not given, so rotating just the secret is:

  ./scripts/auth0-service-principal-secret.sh dev

Each stage is a DIFFERENT Auth0 tenant with its own M2M application, so there
are no defaults for domain, audience or client id — a value carried over from
another stage would look configured and fail at the token endpoint.

The secret NAME is the contract with infra/aws/config/stages.ts, and the client
id must also appear in that stage's `servicePrincipals` as `<client_id>@clients`
or the credential service will refuse the mint.
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
# Before the stage is read, so `--help` with no stage prints usage rather than
# failing with "unknown stage '--help'".
case "$1" in -h|--help) usage ;; esac
STAGE="$1"; shift

case "$STAGE" in
  dev)     SECRET=sellavant-dev-auth0-service-principal;     PROFILE=sellavant-dev ;;
  staging) SECRET=sellavant-staging-auth0-service-principal; PROFILE=sellavant-dev ;;
  prod)    SECRET=sellavant-prod-auth0-service-principal;    PROFILE=sellavant-prod ;;
  *) die "unknown stage '$STAGE' (expected dev, staging or prod)" ;;
esac

REGION=us-east-1
DOMAIN=""
AUDIENCE=""
CLIENT_ID=""
SHOW=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)    DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --audience)  AUDIENCE="${2:?--audience needs a value}"; shift 2 ;;
    --client-id) CLIENT_ID="${2:?--client-id needs a value}"; shift 2 ;;
    --profile)   PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --region)    REGION="${2:?--region needs a value}"; shift 2 ;;
    --show)      SHOW=1; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    -h|--help)   usage ;;
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
  printf '  %-14s %s\n' domain "$(field domain)"
  printf '  %-14s %s\n' audience "$(field audience)"
  printf '  %-14s %s\n' clientId "$(field clientId)"
  printf '  %-14s %s\n' clientSecret '<redacted>'
  exit 0
fi

# An explicit flag wins; otherwise keep what the secret already holds.
[[ -n "$DOMAIN"    ]] || DOMAIN="$(field domain)"
[[ -n "$AUDIENCE"  ]] || AUDIENCE="$(field audience)"
[[ -n "$CLIENT_ID" ]] || CLIENT_ID="$(field clientId)"
[[ -n "$DOMAIN"    ]] || die "no --domain given and the secret has none (e.g. sellavant-dev.us.auth0.com)"
[[ -n "$AUDIENCE"  ]] || die "no --audience given and the secret has none. It is the API identifier, and must match this stage's auth0Audience in infra/aws/config/stages.ts."
[[ -n "$CLIENT_ID" ]] || die "no --client-id given and the secret has none. Auth0 dashboard > Applications > the M2M app > Settings."

# The scheme is a common paste artefact and it silently breaks the token URL,
# which becomes https://https://tenant/oauth/token.
[[ "$DOMAIN" != http*://* ]] || die "--domain must have no scheme: use 'tenant.us.auth0.com', not '$DOMAIN'"

printf 'stage    %s\n'                  "$STAGE"
printf 'secret   %s\n'                  "$SECRET"
printf 'account  %s (profile %s, %s)\n' "$ACCOUNT" "$PROFILE" "$REGION"
printf 'domain   %s\n'                  "$DOMAIN"
printf 'audience %s\n'                  "$AUDIENCE"
printf 'clientId %s\n'                  "$CLIENT_ID"
printf 'action   %s\n' "$([[ -n "$EXISTING" ]] && echo 'update existing' || echo 'create new')"
printf '\nreminder: %s@clients must be in this stage'"'"'s servicePrincipals\n' "$CLIENT_ID"

[[ "$DRY_RUN" == 0 ]] || { printf '\ndry run — nothing written\n'; exit 0; }

if [[ -t 0 ]]; then
  # -s so it is not echoed; the trailing newline is ours because read ate it.
  read -rs -p "Auth0 client secret: " CLIENT_SECRET; printf '\n'
else
  read -r CLIENT_SECRET
fi
[[ -n "$CLIENT_SECRET" ]] || die "empty client secret"

# node rather than printf/jq: it escapes quotes and backslashes correctly, and a
# secret containing " would otherwise produce malformed JSON that only fails
# later, at the first token request.
#
# The secret goes in over stdin, so it is never an argv entry.
PAYLOAD="$(printf '%s' "$CLIENT_SECRET" | node -e '
  const [domain, audience, clientId] = process.argv.slice(1);
  let input = "";
  process.stdin.on("data", d => input += d).on("end", () => {
    process.stdout.write(JSON.stringify({
      domain, audience, clientId, clientSecret: input.trim(),
    }));
  });' "$DOMAIN" "$AUDIENCE" "$CLIENT_ID")"

unset CLIENT_SECRET

if [[ -n "$EXISTING" ]]; then
  printf '%s' "$PAYLOAD" | aws_sm secretsmanager put-secret-value \
    --secret-id "$SECRET" --secret-string file:///dev/stdin >/dev/null
  printf '\nupdated %s\n' "$SECRET"
  printf 'Warm Lambda containers pick this up within CB_SECRET_TTL_MS (default 10 min).\n'
else
  printf '%s' "$PAYLOAD" | aws_sm secretsmanager create-secret \
    --name "$SECRET" \
    --description "Auth0 service principal for unattended sync workers ($STAGE)" \
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
