# ADR-0009: Scheduled sync and Amazon notifications run on AWS, not Vercel Cron

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Byron Warner
- **Depends on:** [ADR-0001](0001-cdk-deploys-sam-is-local-invoke.md), [ADR-0007](0007-page-shaped-endpoints-and-gateway-jwt-validation.md)

## Context

[#34](https://github.com/bwarner/amz-spapi/issues/34) planned the sync backend in
two phases: job units driven by **Vercel Cron** first, then lifted to EventBridge
and SQS in [#36](https://github.com/bwarner/amz-spapi/issues/36) once per-seller
fan-out outgrew a single invocation. #36's stated trigger was "dozens of sellers
× domains, report parsing pressure, or Vercel invocation ceilings."

That sequencing assumed the only reason to move was **scale**, and that until
scale arrived the cheaper host won.

**It missed a capability, not a threshold.** Amazon's SP-API Notifications API
delivers to **SQS or EventBridge** — the subscriber names an AWS resource as the
destination and Amazon pushes to it. There is no HTTPS-callback destination, so
there is no arrangement under which a Vercel route receives an Amazon
notification directly. Anything event-driven — and the roadmap wants order,
listing and inventory events rather than nightly polling — has to terminate in
our AWS account regardless of how many sellers exist.

Once a queue and a consumer exist in AWS for notifications, a second scheduler on
Vercel is not a cheaper starting point. It is a second place for sync to live.

## Decision

**Scheduling and notification intake both run on AWS**, from the start:

```
EventBridge Scheduler ─▶ dispatcher Lambda ─▶ SQS (one message per seller × domain)
                                                   │
SP-API Notifications ──▶ SQS ──────────────────────┴─▶ worker Lambdas
```

**`packages/sp-sync` is unchanged and is the durable asset.** Job units stay
framework-free — `async (userId, cursor) => newCursor`, built on `sp-client`,
`sp-cache` and `couchbase-utils`, all already runtime-agnostic. The Lambda
handler is a thin adapter, exactly as #34 intended the Vercel route to be.

**The Vercel Cron adapter is not built.** No `/api/sync/*` routes, no `crons` in
`vercel.json`.

## Options considered

| Option                                                                                     | Why not                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vercel Cron first, migrate at scale (#34 as written)                                       | Builds routes with a known expiry date, and still leaves notifications needing AWS. Two schedulers during the overlap, and the cutover has to be done while nightly jobs are load-bearing. |
| Vercel Cron for polling, AWS only for notifications                                        | Splits one concern across two runtimes permanently. The same job unit would be invoked two ways, with two retry semantics and two places to look when a seller's finances stop updating.   |
| Poll only; never subscribe to notifications                                                | Works, and wastes the rate-limit budget it spends. Worse, it bounds freshness to the cron interval for data — order status, listing suppression — where the delay is the whole problem.    |
| Vercel Container Images / services ([#76](https://github.com/bwarner/amz-spapi/issues/76)) | A real third shape, and it does not change this: Amazon still will not push to it. It remains worth pricing for the _Couchbase_ question, which is what #76 is actually about.             |

## Consequences

- **#34 loses its routes and crons and keeps its package.** The four job units,
  the cursor store and the target collections are unchanged — they were designed
  against no framework, which is what makes this a re-host rather than a rewrite.
- **#36 starts now** rather than on a scale trigger, and absorbs the scheduling.
  Its container-image half still waits for [#35](https://github.com/bwarner/amz-spapi/issues/35)
  to give it something heavy to carry.
- **A notifications subscription is new work** nobody has scoped: no
  `notifications` schema is vendored, and `createDestination` / `createSubscription`
  do not exist on `sp-client`.
- **The dev loop gets longer.** A cron route could be hit with `curl` against
  `next dev`; a scheduled Lambda cannot. Job units stay directly callable — from
  a test, from a script, from `sam local invoke` — and that is the mitigation.
  It is worth saying plainly that this is the cost being accepted.
- **Per-seller rate pacing becomes the queue's job**, which is the right place
  for it: SQS gives per-message retry and a DLQ, where a cron invocation gives a
  single 200 or 500 for a whole fan-out.
- Revisit if Amazon ever ships an HTTPS notification destination, or if the AWS
  scheduling path proves heavier than the polling workload justifies.
