# ADR-0005: One scope per environment, with a database user per scope

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Byron Warner
- **Supersedes:** [ADR-0004](0004-database-structure.md) decision 1
- **Depends on:** [ADR-0002](0002-aws-account-topology.md)

## Context

[ADR-0004](0004-database-structure.md) concluded that environments should not be
separated by scope, on the grounds that a scope prefix gives namespace
separation without isolation — "one credential, one cluster, and a wrong
environment variable still reads the wrong data".

**That reasoning assumed a shared credential, and the assumption was never
examined.** Couchbase RBAC grants at scope level. With one database user per
environment, restricted to its own scope, a misconfigured environment gets
`access denied` rather than the wrong data. That is a fail-closed boundary — the
same property ADR-0002 required of AWS accounts, and it costs nothing on the
free tier.

ADR-0004 was right that scopes carry no _inherent_ boundary. It was wrong to
conclude that they cannot be made into one.

The remaining objection was cost, and there is no production data to protect
today: no paying customers, and a single dataset that is dev and prod at once.
A restructuring that would be disruptive later is close to free now.

## Decision

**The scope is the environment. All collections live flat inside it, named
`<domain>_<collection>`. Each environment has its own database user, granted
only its own scope.**

```
sell-avant
├── dev       ← user: sellavant-dev      (grant: scope dev)
├── staging   ← user: sellavant-staging  (grant: scope staging)
└── prod      ← user: sellavant-prod     (grant: scope prod)
```

Each environment scope holds the same 25 collections. The name is the old scope
and collection joined by an underscore, a purely mechanical transform:

| today               | after               |
| ------------------- | ------------------- |
| `a_plus.drafts`     | `a_plus_drafts`     |
| `catalog.listings`  | `catalog_listings`  |
| `sp_cache.listings` | `sp_cache_listings` |
| `reports.rows`      | `reports_rows`      |
| `ops.cost_ledger`   | `ops_cost_ledger`   |

Because scope-plus-collection was already unique, the joined name is unique by
construction — including the pairs that would otherwise collide, `listings`
appearing under both `sp_cache` and `catalog`.

**Call sites do not change.** `couchbase-utils` keeps its
`(scopeName, collectionName, key)` signature and maps internally: the scope
becomes the environment, and the collection becomes `${scopeName}_${collectionName}`.
The 14 `const SCOPE = 'a_plus'` constants stay exactly as they are. What changes
is one module, the DDL, and the N1QL statements that name a collection
unqualified.

**It also retires [#68](https://github.com/bwarner/amz-spapi/issues/68).** The
reserved-word collision existed because a collection was called `rows`;
`reports_rows` is not a reserved word, so the rename happens as a side effect
and the backticking workaround disappears with it.

## Options considered

### A. Environment scope, flat collections ✅ chosen

One scope per environment, one grant per user, one resolver. Chosen for the
simplest access-control story: a single scope-level grant per environment, which
is hard to get wrong.

Cost: 25 collections are renamed and the data moved. That cost is paid once and
is at its lowest today.

### B. Environment-prefixed domain scopes (`dev_a_plus`, `prod_a_plus`)

24 scopes, no collection renames, and the domain grouping preserved. Rejected
despite being less invasive: each environment user needs eight separate grants
instead of one, and eight grants that must stay in step are eight chances for
one to be forgotten — which fails open, silently, in exactly the direction that
matters.

### C. Leave environments sharing (ADR-0004)

Free, and honest while there is one operator and one dataset. Rejected because
the cost it accepted — "a destructive mistake in development is a destructive
mistake in production" — is avoidable for a migration that gets more expensive
every week, and the mechanism to avoid it was available all along.

### D. A second cluster per environment

The strongest isolation, and what ADR-0002 assumes for AWS. Rejected on price:
a production-capable Capella cluster is roughly $330–$1,070/month, against $0 for
scope-level RBAC on the free tier. Revisit when there is revenue, or when noisy
neighbours on a shared single node become the constraint.

## Consequences

**Positive**

- Environment isolation that fails closed, on the free tier, for no money.
- `reports.rows` renamed as a side effect; #68 closed.
- Call sites unchanged — the blast radius is `couchbase-utils`, the DDL, and the
  collection constants in N1QL statements.

**Negative / costs**

- A one-time migration of 25 collections and their data, plus recreating every
  secondary index in each environment scope.
- Three sets of indexes to maintain instead of one.
- The domain grouping becomes a naming convention rather than structure. Nothing
  enforces that a new collection is named `<domain>_<entity>`.
- Dev starts empty unless seeded. Today's dataset becomes `prod`, since it is the
  one actually in use.

**Verify before starting**

Capella's Database Access must allow a credential scoped to a single scope on
the free tier. Couchbase supports scope-level RBAC and Capella exposes
bucket/scope/collection selection, but the whole decision rests on it — confirm
in the console first. Without per-environment users this is namespacing, and
ADR-0004's objection stands.

## References

- Live cluster state, verified 2026-07-31 via the Couchbase MCP server
- [ADR-0004](0004-database-structure.md), which this supersedes in part
- Migration: [#71](https://github.com/bwarner/amz-spapi/issues/71)
