# ADR-0012: SQS FIFO paces accounts; Step Functions waits

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Byron Warner
- **Issue:** [#145](https://github.com/bwarner/amz-spapi/issues/145)
- **Supersedes nothing.** Extends [ADR-0009](0009-scheduling-and-notifications-live-on-aws.md).

## Context

The workspace now has two scheduled background jobs against Amazon, and they are
wired differently:

- **SP-API sync** (#36) — EventBridge Scheduler → dispatcher Lambda → **SQS FIFO**
  → worker.
- **Ads report sync** (#145) — EventBridge Scheduler → **Step Functions** →
  plan → Map( request → Wait → collect ).

Two patterns for what a passing reader will call the same thing. Without a
stated rule the next scheduled job is decided by whichever file its author
opened first, and the two shapes become three.

The question that forced this was whether to migrate the SP sync onto Step
Functions for consistency. It looked like a modernisation. It is a downgrade,
and the reason is specific enough to be worth writing down.

## The two shapes

**SP-API sync is many rate-limited calls, per account.** SP-API limits are per
seller. `sync-wiring.ts` uses the seller id as the FIFO **message group**, which
serialises one seller's calls while different sellers proceed in parallel. That
is the entire pacing mechanism, and it is a property of the queue rather than of
the worker.

Step Functions cannot express it. `Map.MaxConcurrency` is a **global** cap: to
keep one seller inside their budget you must throttle every seller. That is
precisely the alternative `sync-wiring.ts` rejects in its own comment —
"a standard queue would need a global concurrency cap instead, which throttles
every seller to protect one."

**Ads report sync is a handful of calls dominated by waiting.** Amazon generates
a report over minutes. A queue charges for that wait twice: every poll is a
re-queue _plus_ a Lambda invocation, and a worker that sleeps instead spends its
whole billed runtime asleep and still dies at the timeout. A `Wait` state costs
nothing and runs no code — Step Functions bills state transitions, not elapsed
time.

Per-account pacing barely applies: four profiles making a handful of calls each.
And overlapping runs are already prevented in the job logic rather than by the
transport, because `requestAdsReport` declines a window already requested or
ingested.

## The retry difference

`maxReceiveCount: 3` is one number for every failure. It cannot tell a 429 from
a revoked token, so either transient failures give up too early or permanent
ones are retried for minutes to prove what was knowable immediately.

A state machine classifies per Task: transient errors get interval-and-backoff,
and anything else falls through to a recorded failure. That matters most where
Amazon bills for the work — a retry storm against report generation is not free.

## Decision

**Use SQS FIFO when the job is many rate-limited calls needing PER-ACCOUNT
pacing with cross-account parallelism.** The message group is the pacing
mechanism; that is the reason to choose it.

**Use Step Functions when the job is dominated by WAITING on an external
asynchronous job, and when retry needs to distinguish error classes.** The Wait
state is the reason to choose it.

**Neither is the default.** A new scheduled job answers the question "is this
paced, or is this waiting?" and the answer picks the transport.

**Do not migrate the SP-API sync.** Consistency is not worth losing per-seller
pacing, and the migration would trade a correct mechanism for a familiar one.

## Consequences

Two patterns to learn instead of one, which is the cost. It is paid down by this
document and by the comment at the top of each construct, both of which name the
other shape and why it was not used.

**A third shape is a smell.** If a future job fits neither — say, many
rate-limited calls that each wait minutes — that is worth designing rather than
forcing into whichever of these is closer.

The SP sync keeps a dispatcher Lambda and the ads sync does not, and that follows
from the same reasoning rather than being an inconsistency: "which work is due"
is a separate service when its output goes onto a queue, and a `plan` Task when
its output feeds a Map in the same execution.

## What this does not decide

Whether _ingestion_ is idempotent, which is a property of the job logic and not
the transport. Both paths rely on content-hashed report rows and on
`check-report-coverage` remaining the gate — a caller must keep asking whether
stored rows cover a window rather than assuming a scheduled run succeeded.
