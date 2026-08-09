# admincli

Administration for **Sellavant itself** — workspaces, membership, invitations.

Distinct from `spcli` and `adscli`, which talk to Amazon on a seller's behalf
and know nothing about who our users are. This one knows only about our users
and nothing about Amazon.

## Why it exists

Signup is open and new accounts provision their own workspace at `/onboarding`,
so nobody is locked out by default. What this exists for is everything the web
UI deliberately will not do: create a workspace on somebody's behalf, grant
membership without an invitation round trip, repair a workspace that predates a
schema change, and answer data-subject requests.

`admincli` reaches Couchbase directly, so it works when nothing else does. It is
the escape hatch first and a batch tool second: inviting twenty pilot sellers is
a loop here and twenty form submissions in the UI.

## Running it

```bash
./admincli.sh --help
```

The wrapper builds on first use and loads `apps/web/.env.local` for the
Couchbase Data API connection, so it targets whichever scope `CB_SCOPE` names.
Point it elsewhere with `ENV_FILE`:

```bash
ENV_FILE=apps/web/.env.staging ./admincli.sh members list --workspace ws_…
```

It refuses to start if `CB_DATA_API_URL`, `CB_USERNAME`, `CB_PASSWORD`,
`CB_BUCKET` or `CB_SCOPE` is missing, rather than failing partway through a
write.

## Diagnosing a lockout

Start here. `check` reports what the gate would decide and why:

```bash
./admincli.sh check --sub 'auth0|abc123' --email 'someone@example.com'
```

`hasWorkspace: false` means the account exists but has not completed
onboarding — it is not stuck, it just has not created a workspace yet.

To find a user's subject when you only know they have used the app:

```sql
SELECT userId, COUNT(*) AS chats, MAX(updatedAt) AS lastActive
FROM chat_conversations GROUP BY userId ORDER BY lastActive DESC
```

## Fixing one

Provision a workspace and its owner in one step:

```bash
./admincli.sh workspaces create \
  --name 'Acme Trading' \
  --owner-sub 'auth0|abc123' \
  --owner-email 'owner@acme.com'
```

Membership is keyed on the Auth0 **subject**, not the email, and `resolveAccess`
returns at the membership check before it ever looks at an address. So granting
by subject fixes a lockout even when you are unsure which email the account
carries.

Add someone to an existing workspace with no invitation round trip:

```bash
./admincli.sh members grant \
  --workspace ws_… --sub 'auth0|def456' \
  --email 'contractor@agency.com' --role admin
```

Idempotent — re-run to change a role.

## Invitations

```bash
./admincli.sh invitations create \
  --workspace ws_… --email 'seller@example.com' --role member \
  --invited-by 'auth0|abc123'
```

Email delivery is not wired up, so the printed `link` is the deliverable — send
it yourself. Use `--base-url` to override the host (defaults to `APP_BASE_URL`).

```bash
./admincli.sh invitations list --workspace ws_…
./admincli.sh invitations revoke --id inv_…
```

`invitations accept --id … --sub … --email …` completes an invitation on a
user's behalf, for the support case where they cannot. The email is still
checked against the invitation unless you pass `--force`.

## Output

`--format table` (default) for reading, `--format json` for piping. Epoch
timestamps are rendered as ISO dates in table mode.

Diagnostics always go to **stderr**, so stdout stays pure for `jq` even when
`LOG_LEVEL=debug` is inherited from the app's env file:

```bash
./admincli.sh members list --workspace ws_… --format json \
  | jq -r '.[] | "\(.role)\t\(.email)"'
```

Exit code is 0 on success and 1 on failure, with the reason on stderr.

## Where the logic lives

Nothing here implements workspace or invitation rules. They live in
`libs/identity` (`@amz-spapi/identity`), which the web app imports too — one
implementation, so a CLI grant and a UI invitation cannot drift into disagreeing
about expiry, role or uniqueness.

## Data-subject requests (GDPR)

The privacy policy offers both export and deletion. These are how they are
answered. Ownership of every collection is declared in `libs/data-rights`, and a
test cross-checks that list against the DDL schema — so a collection added later
cannot be silently missed by either operation.

### Export (Art. 15 / 20)

```bash
./admincli.sh users export --sub 'auth0|abc123' --out subject.json
```

Machine-readable JSON. Object storage is listed by reference rather than
inlined — a real account is hundreds of images, and base64 in a JSON file is not
"commonly used" in the Art. 20 sense.

The stored Amazon credential (`encrypted_secrets`) is redacted. It concerns the
subject, but an export travels by email and lands in a downloads folder;
answering an access request must not create a credential disclosure.

Trading data is exported for **every** seller account they hold, including ones
shared with another user. Exclusivity constrains deletion, not access.

### Erasure (Art. 17)

```bash
# Always look first. This is the default.
./admincli.sh users purge --sub 'auth0|abc123'

# Then, deliberately:
./admincli.sh users purge --sub 'auth0|abc123' \
  --email 'them@example.com' --apply --confirm 'auth0|abc123'
```

Hard delete — a `deletedAt` flag is not erasure. `--apply` additionally requires
`--confirm` to repeat the subject exactly, because the realistic mistake is not
a mistyped flag but the right command aimed at the wrong person.

Covers the three things a naive sweep misses: `reports_*` and `sync_*` are keyed
by Amazon **seller id**, not by subject; `ops_spend_counters` has no queryable
field at all (the subject is hashed into the key); and `media_assets` rows are
metadata whose **bytes live in S3**.

`--email` also revokes pending invitations to that address — otherwise a live
grant would re-admit the person the moment they signed up again.

**Shared seller accounts are never purged.** If two users hold credentials for
the same Amazon account — an owner and their agency — that trading data belongs
to both, and erasing it for one would destroy the other's records. Those seller
ids are reported and skipped, and the erasure must be treated as partial until
the shared access is resolved.

Exits non-zero if any stored file could not be deleted. An erasure that half
worked must not look like one that worked.
