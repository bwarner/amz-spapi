# couchbase-utils

Access to Couchbase over the **Data API** (HTTP), not the native SDK. The native
SDK cannot run in the web runtime, so `createCouchbaseCluster()` deliberately
throws.

Single-key reads and writes go to the KV endpoints; anything set-shaped goes to
the query service. Expressing key lookups as N1QL made each one parse and plan a
statement to reach a document it already had the key for, and gave up what the KV
endpoints provide for free: CAS through ETag, create-only semantics, and atomic
counters.

## Configuration

| Variable          | Required | Purpose                                         |
| ----------------- | -------- | ----------------------------------------------- |
| `CB_DATA_API_URL` | yes      | Data API base URL                               |
| `CB_USERNAME`     | yes      | Cluster access username                         |
| `CB_PASSWORD`     | yes      | Cluster access password                         |
| `CB_BUCKET`       | yes      | Bucket name                                     |
| `CB_SCOPE`        | no       | Default scope when a caller passes none         |
| `CB_TEST_SCOPE`   | no       | Scope the integration tests provision (`itest`) |

## Data API behaviours these helpers are built around

Four of these were assumed wrong at first, and each is load-bearing. They are
pinned by `src/couchbase-utils.integration.spec.ts`.

- **CAS travels on an unquoted `ETag`.** A stale `If-Match` is answered **409
  `CasMismatch`**, not the RFC's 412. Wrapping the value in quotes the way the
  ETag spec suggests makes it **400 `InvalidArgument`** — echo it back verbatim.
- **`If-None-Match: *` is not create-only.** It is accepted, ignored, and
  returns 200 having overwritten the document. `POST` is the create-only verb and
  answers 409 `DocumentExists`; that is what `insertDocument` relies on.
- **`increment` stores `initial` and ignores `delta` when it creates the
  document.** `initial: 0` therefore drops the first increment silently — for a
  daily spend counter that makes the first paid call of each UTC day free, which
  is cap evasion rather than rounding. `incrementCounter` sends `initial = delta`
  so creation and increment agree. Omitting `initial` does not create the counter
  at all: 404.
- **`Expires` takes a Go duration string** (`"15552000s"`), or `"0"`, or ISO 8601.
  A bare seconds count is a 400. This sidesteps the KV protocol's threshold where
  a value over 30 days is read as an absolute Unix timestamp — the reason a
  180-day TTL once expired documents in 1970.
- **N1QL transactions work over the query endpoint.** `tximplicit: true` wraps a
  single statement; an explicit transaction threads the `txid` from `BEGIN WORK`
  through each statement to `COMMIT WORK` (or `ROLLBACK WORK`). `executeQuery`
  passes both options through.
- **Reserved words need backticks.** `rows` and `options` are reserved, and an
  unbackticked keyspace fails at parse time.

## Tests

The suite is a set of contract tests against a live cluster — assertions about
someone else's HTTP service, which nothing mockable can defend. It skips itself
unless `CB_DATA_API_URL`, `CB_USERNAME`, `CB_PASSWORD`, and `CB_BUCKET` are all
set, so `nx affected -t test` stays green in CI where no cluster credentials
exist.

```bash
set -a && . apps/web/.env.local && set +a && npx nx test couchbase-utils
```

A skipped suite proves nothing. Run it against a real cluster when you change
this package.

The suite provisions its own scope (`itest`, with a `docs` collection and a
`rows` collection whose name is deliberately a reserved word) and deletes every
key it writes. It never touches an application collection — the cost ledger is an
auditable record and test rows have no business in it.
