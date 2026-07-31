# ADR-0004: Scopes are organisational; environments separate at the cluster boundary or not at all

- **Status:** Superseded in part by [ADR-0005](0005-environment-scopes.md)
- **Date:** 2026-07-31
- **Deciders:** Byron Warner
- **Depends on:** [ADR-0002](0002-aws-account-topology.md)

## Context

Verified against the live cluster on 2026-07-31 through the Couchbase MCP server:

- **One bucket**, `sell-avant` — the Capella free tier's allowance, and the
  cluster is shared with other applications.
- **9 scopes, 27 collections**: `sp_cache` (6), `a_plus` (4), `catalog` (4),
  `reports` (3), `media` (3), `chat` (2), `ops` (2), `credentials` (1), plus
  `itest` (2) which the #44 contract suite creates on demand.
- **17 primary indexes**, of which 7 have never been scanned
  (`media.asset_links`, `media.asset_hashes`, `catalog.variants`,
  `catalog.listing_versions`, and all three `sp_cache` collections).
- Three spellings of tenancy: `userId`, `sellerId` (in `reports`), and
  `user_id` (in `credentials.profiles`).

The scopes were introduced incrementally — `ops` in `3591a7d`, `reports` in
`f0cfabe` — grouped by domain. No record was kept of why.

Two claims were made for that grouping and neither survives inspection. **RBAC**:
Couchbase grants privileges at collection level as well as scope level, so the
grouping is not what makes a least-privilege credential possible. **Isolation**:
one credential reaches every scope today, so the boundary is drawn and unused.

The honest test is what the same design would look like in a relational database.
Eight schemas for 27 tables would be unusual in Postgres; one schema with
prefixed table names is the normal shape, and would be the right call there.

## Decision

**Scopes are an organisational namespace. They are not a security boundary, and
nothing may depend on them being one.**

They stay as they are — readable, harmless, and not worth a migration — with two
consequences that are the point of writing this down:

**1. Environments are never separated by scope.**

> **Superseded by [ADR-0005](0005-environment-scopes.md).** This reasoning
> assumed a shared credential. Couchbase grants at scope level, so a database
> user per environment makes a wrong environment variable fail closed rather
> than read the wrong data. The rest of this ADR — scopes carry no inherent
> boundary, no primary indexes, no reserved-word names, tenancy is a field —
> still stands.
> Separation happens at the
> cluster or bucket boundary, or it does not happen. A scope prefix
> (`dev_a_plus`) would give namespace separation without isolation: one
> credential, one cluster, and a wrong environment variable still reads the wrong
> data. That is the same isolation-by-convention that ADR-0002 rejected for AWS
> accounts, and it would cost a resolver threaded through every call site.

On the free tier there is one bucket, so **dev, staging and production share
data**. That is honest for a single-operator product where they are the same
data in practice. The trigger to change it is real production data worth
protecting, and the answer then is a second cluster — priced in ADR-0002's terms,
not worked around in the schema.

**2. Access control, when it arrives, grants on collections.** #55 moves
credentials behind their own Lambda; that Lambda's database user should reach
`credentials.profiles` and nothing else. That grant is written against the
collection, and does not require the scope layout to mean anything.

### Rules for new structure

- **bucket** = deployment · **scope** = domain grouping · **collection** =
  entity · **tenancy** = a document field, never a namespace.
- **No primary indexes.** Couchbase's own guidance is that they do not belong in
  production; they invite full keyspace scans. Every query gets a targeted
  secondary index, or is a key lookup. `reports` is the model — no primary, three
  secondaries built from real query shapes.
- **Collection names avoid N1QL reserved words.** `rows` and `options` are
  reserved; a collection called `rows` forces backticks and produces parse errors
  that are found one runtime at a time. Rename rather than document the
  workaround.
- **Tenancy keys**: `userId` (Auth0 subject) for anything belonging to an app
  user. `sellerId` (Amazon merchant id) for data that belongs to a seller account
  regardless of who fetched it — currently `reports`. Both are legitimate; the
  mapping between them is not optional, and today it is (see below).

## Consequences

**Positive**

- No resolver, no prefixes, no per-environment scope arithmetic.
- The 8-scope layout stops being defended as something it is not.
- Least-privilege access has a clear implementation path that does not depend on
  the grouping.

**Negative**

- Dev, staging and production share data until a second cluster is bought. A
  destructive mistake in development is a destructive mistake in production.
- The scope layout remains, and a reader may still infer a boundary from it. This
  ADR is the correction.

**Work this decision creates**

- Rename `reports.rows` ([#68](https://github.com/bwarner/amz-spapi/issues/68)),
  drop the 17 primary indexes ([#69](https://github.com/bwarner/amz-spapi/issues/69)),
  make `seller_id` required on SP-API credential profiles and backfill
  ([#70](https://github.com/bwarner/amz-spapi/issues/70)).
- `purchases.documents` for [#50](https://github.com/bwarner/amz-spapi/issues/50)
  follows these rules: no primary index, no reserved-word names.
- `credentials.profiles` stores `refresh_token` and `client_secret` in
  plaintext — visible in the collection schema. Tracked as #11, superseded in
  substance by #55.

## References

- Live cluster state, verified 2026-07-31 via the Couchbase MCP server
- `scripts/setup-couchbase.ts`; commits `3591a7d`, `f0cfabe`, `a504907`
