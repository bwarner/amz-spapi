# ADR-0008: Stored bytes are retained by policy, not metered for billing

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** Byron Warner
- **Depends on:** [ADR-0005](0005-environment-scopes.md)

## Context

[#74](https://github.com/bwarner/amz-spapi/issues/74) filed the question rather
than the answer: once documents persist ([#50](https://github.com/bwarner/amz-spapi/issues/50),
[#73](https://github.com/bwarner/amz-spapi/issues/73)), sellers accumulate stored
bytes indefinitely and we pay for them. It asked to decide the shape before the
data volume makes backfill awkward.

**The existing ledger cannot express it.** `ops.cost_ledger` records one
document per paid _call_ — user, feature, vendor, operation, units, cost. That
shape assumes something happened. Storage has no call: it is a recurring charge
against a standing quantity, accruing whether or not the seller opens the app.
`ops.spend_counters` is the wrong instrument too — a pre-flight cap that refuses
paid calls cannot refuse bytes already sitting in a bucket.

**Nothing is attributed today.** S3 objects via `persistGeneratedFileAsset` and
Couchbase records both grow without a per-user footprint, so "what does this
seller cost us to keep?" is currently unanswerable.

## Decision

**Retention policy, not a billing meter.** Every collection and every asset
class gets a retention rule; nothing gets a storage charge. The one exception —
documents — is retained indefinitely and deliberately not charged for.

**Attribution now, metering only if a price is ever attached.** Assets and
documents carry their owner so footprint is _measurable_. No sweep, no counter,
no ledger rows for storage.

## Options considered

| Option                              | Why not                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Retention rules only** _(chosen)_ | Most of the eventual bill is avoidable rather than chargeable. A generated image nobody used does not need to live forever, and deleting it costs nothing to build.                                                                              |
| Periodic sweep writing ledger rows  | Real work — a schedule, per-user footprint measurement, a new row type — to produce a number nobody currently charges against. It also invents a second meaning for `cost_ledger`, whose rows are today all attributable to a call someone made. |
| Separate storage counter            | Same cost, and a counter that no cap can act on. `spend_counters` exists to refuse a call before it happens; bytes are already stored by the time you would read it.                                                                             |

### Why documents are the exception

Reconciliation ([#43](https://github.com/bwarner/amz-spapi/issues/43)) works
across documents that arrive weeks apart, and a supplier dispute can surface
long after that. A retention rule that deletes an invoice is a retention rule
that breaks the feature the invoice was kept for. So documents are retained
indefinitely — which is exactly why #74 identified them as the thing worth
charging for, and exactly why they cannot be the thing we delete.

That is affordable because documents are the _smallest_ class. A PDF invoice is
tens of kilobytes; a generated image is megabytes. The bill is dominated by the
things we can delete.

## The open questions, answered

**Metered by peak, average, or end-of-period?** None. Nothing is metered. Should
that change, end-of-period: it is the only one measurable without a time series,
and a seller can act on it — "delete these and your next bill is smaller" is
advice; a peak they have already passed is not.

**Charged per-seller, or a plan quota with overage?** Neither yet. When it
arrives, a quota: a per-byte charge on evidence a seller is _required_ to keep
for reconciliation punishes exactly the behaviour the product asks for.

**Does deleting a document reclaim the bytes, given assets dedupe on sha256?**
No, and it must not try. One asset may back several documents, so deleting the
record must leave the object. Reference counting is rejected: a count that drifts
either leaks bytes or — far worse — deletes an asset another document still
cites, and the failure surfaces months later as evidence missing from a dispute.
Orphaned bytes are the cheap failure; a lost invoice is not. Sweeping genuinely
unreferenced assets is a separate, auditable job that can run when there is a
reason to.

**The Couchbase ceiling.** Free-tier is a single 8GB node shared with other
applications. That limit arrives long before any price does, which is the real
argument for this ADR: the first storage problem will be a full cluster, not an
invoice — and the fix for a full cluster is retention, not billing.

## Consequences

- Assets and documents carry their owner, so footprint is measurable per seller
  the day anyone asks.
- Per-collection TTLs continue as established practice — `ops.cost_ledger` at
  400 days, `chat.messages` at 180 — and every new collection states its own.
- `purchases.documents` has **no TTL**, and that is a decision rather than an
  omission. Anything added later that must outlive a dispute should say so here.
- No storage rows in `ops.cost_ledger`, so its invariant holds: every row is a
  call somebody made, and it stays reconcilable against a vendor invoice.
- Nothing refuses a write because of accumulated bytes. The Couchbase node fills
  before anything else breaks, and that is a capacity alarm, not a cap.
- Revisit when stored documents pass roughly a gigabyte per seller, or when the
  cluster crosses half its ceiling — whichever comes first.
