# admincli

Administration for **Sellavant itself** — workspaces, membership, invitations.

Distinct from `spcli` and `adscli`, which talk to Amazon on a seller's behalf
and know nothing about who our users are. This one knows only about our users
and nothing about Amazon.

## Why it exists

The web UI at `/team` can only be used by somebody already inside a workspace,
and the invite gate has exactly one bootstrap route: the
`PLATFORM_OWNER_EMAILS` environment variable. That is fine until it is wrong. A
typo, an Auth0 account under a different address, or a process that has not been
restarted since the variable was added, and nobody can get in — including the
person who would fix it.

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

`ownerListConfigured: false` means the running app process predates
`PLATFORM_OWNER_EMAILS` — restart it. `matchesOwnerList: false` with the list
populated means the address is wrong. The two have identical symptoms in the
browser and completely different fixes.

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
