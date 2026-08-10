# The Stripe price catalogue

**Status: built and working, 2026-08-09.** This started as a handoff describing
work to do. It is now a record of what was done and why, kept because the
reasoning is not obvious from the code alone.

Verified end to end in dev: the catalogue holds all four rows, a second
`sync-prices` rewrites nothing, `billing verify` is clean, and the 13
`price-catalog` e2e specs pass. The four price ids the sync resolved are
character-for-character the ones the deleted `STRIPE_PRICE_*` variables held,
which is the migration proving itself.

One manual step remains, listed at the bottom: the dead `STRIPE_PRICE_*`
variables in the two Vercel scopes.

## What changed

Stripe price ids moved out of environment variables and into Couchbase, kept
current by the webhook. `STRIPE_PRICE_*` is gone from the code and from every
env file.

## Why

Three numbers could disagree: what the pricing page showed (the plan table),
what checkout charged (the Stripe price named by
`STRIPE_PRICE_<PLAN>_<INTERVAL>`), and what `provision` inspected (a price it
found by metadata). `provision` compared the third against the first and never
read the env vars at all, so the link between the quote and the charge — a
hand-copied id, in four env files and two Vercel scopes — was unverified.

`billing verify` was added to close that gap by starting from the env var. The
catalogue removes the gap instead of checking it: the page and checkout now
resolve to the same row.

It also survives a Stripe outage, which is where the idea started.

## The load-bearing rule

**A row is written ONLY when the Stripe amount matches the plan table.** This is
what makes page-vs-checkout divergence structurally impossible rather than
merely detectable — there is no way to express "sell this plan at a price the
page does not advertise", so no code path can read one. A stray price created in
the dashboard can never become the thing we sell.

The corollary is deliberate: a mismatch makes a plan **unsellable** rather than
mispriced. That is the right direction. A checkout that 503s is a bug somebody
fixes today; a checkout that quietly charges $299 against a $99 quote is a
refund, a chargeback and an apology.

## Where it lives

- **`libs/billing/src/lib/catalog.ts`** — `priceForPlan`, `readPriceCatalog`,
  `syncPriceCatalog`, `applyCatalogEvent`, `isCatalogEvent`.
- **`billing_prices`** collection, keyed `<planId>::<interval>`. One KV get on
  the checkout path — no query, no index.
- **`catalogPriceSchema`** in `packages/models/src/lib/billing.ts`, with the
  plan/interval enums it already owned. Parsed on read: a row we cannot parse is
  a row we must not charge against.

Populated by `provision --apply`, refreshed by `admincli billing sync-prices`,
and kept current by `price.*` / `product.*` webhook deliveries.

## Decisions worth knowing

- **A projection, not a second source of truth.** Stripe stays authoritative.
  `syncPriceCatalog` recomputes desired state rather than patching, so it is
  idempotent and a second run writes nothing.
- **Events trigger a re-read of Stripe, never a write from the payload.** A
  `price.updated` that deactivates one price says nothing about whether another
  matching price exists; acting on the payload alone would leave a plan
  unsellable with a good price sitting next to it.
- **Withdrawn rows are deactivated, not deleted.** "Went away" and "never
  existed" are different operational problems, and `billing verify` needs to
  tell them apart.
- **Ownership is checked on every sync.** The Stripe account is shared with
  ScanSafeguard and My Awesome Resume; without it the catalogue fills with
  theirs.
- **The pricing page does NOT read the catalogue.** It uses `isPurchasable(plan)`
  from the plan table. The page is marketing and must render when Couchbase is
  unreachable — making "is this for sale" a database question would blank the
  Buy buttons during an outage of a system the visitor has no relationship with.
  The write-time rule already guarantees the advertised amount equals the
  catalogued one, so nothing is lost. Whether a price is actually wired up is a
  different question, asked at checkout, where failing is safe.
- **Checkout and `/start` fail CLOSED.** An unreachable catalogue is treated
  exactly like a missing row: 503. Proceeding on a remembered id is the silent
  mischarge this collection exists to prevent.
- **`billing verify` survived, re-pointed.** Most divergence is now prevented at
  write time, but one drift remains that no write-time rule can catch: the plan
  table edited AFTER a sync, leaving a correct-looking row quoting yesterday's
  price. That is now its headline case.

## Traps

- **`provision --apply` used to REPLACE a webhook endpoint's event list.**
  `ensureWebhook` matches by origin+path and then updates; until 2026-08-09 that
  update passed `enabled_events: WEBHOOK_EVENTS` with no merge, so whatever was
  subscribed before was silently gone. It unions now, and two tests hold the
  line. Why it mattered: the live endpoint was created in the DASHBOARD
  (description `Sellavant production`, not provision's `Sellavant — workspace
subscription state`), so it carries ~68 events the code has never heard of.
  Expect the same shape of bug anywhere else provision adopts an object it did
  not create. The portal configuration IS written wholesale, deliberately —
  its embedded price list must not go stale — but nothing else should be.
- **A dynamic `import()` of a workspace library in a spec marks it lazy-loaded**,
  and `@nx/enforce-module-boundaries` then rejects the ordinary static import in
  the source file. It reads as a nonsense error about a file you did not touch.
  Declare a `vi.fn()` at module scope and reference it from the `vi.mock`
  factory instead.
- **Nx Cloud remote cache** served a stale `models` declaration for a while;
  fixed by scoping three `tsconfig.spec.json` outDirs, but if a phantom
  `TS2305: has no exported member` appears, that is the shape of it and
  `NX_SKIP_REMOTE_CACHE=true` confirms it.
- **`admincli.sh` only builds when `dist/apps/admincli/main.js` is ABSENT.**
  A stale binary after a source change is silent — it cost a duplicate Stripe
  webhook endpoint. Run `npx nx build admincli` after editing it.
- `vercel env add` needs the repo ROOT as cwd, or it reports `not_linked`.
  Vercel stores these as Sensitive, so values cannot be read back to verify.

## Bootstrapping a new environment

`admincli billing provision --apply` is now a **required** step, not an optional
one: it writes the catalogue, and checkout reads its price ids from there. Until
it runs, every purchase answers 503. Said so in `apps/admincli/README.md`.

`provision` needs a Couchbase connection now as well as `STRIPE_SECRET_KEY`. A
run whose Stripe half succeeded and whose catalogue write failed reports it and
exits non-zero rather than claiming success.

## Also fixed

**`data-rights` had no `test` target** — only the plugin-inferred `vite:test` —
so CI's `nx affected -t lint typecheck test build` skipped 20 passing tests,
including the manifest cross-check that stops a new collection being silently
excluded from GDPR export and deletion. It now declares an explicit `test`
target using the `@nx/vite:test` executor, the same way `billing` does. This
mattered directly: `billing_prices` is a new collection.

## Trap: a collection the Data API silently refuses to serve

Hit on 2026-08-09, on the very first use of `billing_prices` in dev. Worth
recording because every symptom points away from the cause.

The collection existed and the QUERY service served it fine — `SELECT … FROM
\`billing_prices\``returned in ~1.3s. But every Data API **KV** call against it
hung until the client's 10s timeout, which surfaced as`Couchbase Data API timed out`. `priceForPlan`is a KV get, so checkout answered
503 while`readPriceCatalog` worked perfectly.

What it was NOT, each ruled out by measurement rather than reasoning:

- **Not the client, the retry wrapper, or the `::` in the key.** A raw `fetch`
  straight at the Data API behaved identically.
- **Not new collections in general.** A throwaway collection created seconds
  earlier answered KV in 62ms.
- **Not corruption of that particular collection.** Dropping and recreating it
  changed nothing; it hung again immediately.
- **Not the creation method.** `couchbase-ddl.ts` issues the same plain
  `CREATE COLLECTION` used for the throwaway.

It was tied to the NAME. `billing_pricesv2`, same scope, same statement, worked
in 60ms while `billing_prices` hung — consistent with the Data API holding a
stale collection UID against that name.

**Restarting the cluster cleared it**, and no code or schema change was needed.
The collection now answers in ~700ms and the catalogue populates.

If this recurs: probe KV immediately after creating a collection rather than
assuming a successful `CREATE` means a usable collection, and reach for a
cluster restart before renaming anything. Resist "fixing" it by moving
`priceForPlan` onto a N1QL query — a single-key read is right, and the
workaround would outlive the problem.

## Still to do

**Remove the dead `STRIPE_PRICE_*` variables from both Vercel scopes.** Nothing
reads them, so they are harmless where they sit — this is tidying, not a fix,
and it touches deployed environments, so it was left for a deliberate hand:

```bash
# From the repo ROOT, or vercel reports not_linked.
for v in STRIPE_PRICE_PILOT_MONTHLY STRIPE_PRICE_PILOT_YEARLY \
         STRIPE_PRICE_SCALE_MONTHLY STRIPE_PRICE_SCALE_YEARLY; do
  vercel env rm "$v" production --yes
  vercel env rm "$v" preview --yes
done
```

## Useful commands

```bash
ENV_FILE=apps/web/.env.local ./admincli.sh billing verify
ENV_FILE=apps/web/.env.prod  ./admincli.sh billing verify
ENV_FILE=apps/web/.env.local ./admincli.sh billing sync-prices
ENV_FILE=apps/web/.env.local ./admincli.sh billing provision --base-url https://local.sellavant.com
npx tsx --env-file=apps/web/.env.local scripts/couchbase-ddl.ts --env dev --apply
```

Run checks the way CI does:

```bash
NX_DAEMON=false pnpm exec nx affected -t typecheck lint test build --base=main
```
