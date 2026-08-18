# ADR-0011: The product is canonical; sync seeds it and never overwrites it

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Byron Warner
- **Depends on:** [ADR-0005](0005-environment-scopes.md)

## Context

The catalog is a three-level spine: `catalog_products` → `catalog_variants` →
`catalog_listings`. A product is the thing being sold, a variant is which
flavour of it, and a listing is one marketplace's offer of one variant under one
seller SKU.

That model was built by syncing Amazon, and it shows. Today a product's `title`
and `brandName` come from the Amazon **parent family** catalog item
(`product-sync.ts`, the `upsertProduct` call), which produces this:

| seller SKU       | `catalog_products.title`              |
| ---------------- | ------------------------------------- |
| `NMS-FB-350-GRY` | 10oz Nordic Ceramic … Mug **(Beige)** |
| `NMS-FB-350-BEI` | 10oz Nordic Ceramic … Mug **(Beige)** |
| `NMS-FB-350-ORN` | 10oz Nordic Ceramic … Mug **(Beige)** |

Three colours, one title, and the title names a colour that is wrong for two of
them. Nothing is corrupt — the distinguishing value is on the variant, where
`buildVariantOptions` puts it. The title is simply a marketplace artifact that
leaked one level up.

It leaked because there was no answer to a question nobody had needed to ask:
**when Amazon and our own record disagree, which one is true?** With one seller,
one marketplace and a read-only product screen, both answers behave identically.
They stop behaving identically the moment the product is meant to be the thing
you author once and publish to Amazon, Shopify and elsewhere — which is the
point of having a product separate from a listing at all.

The forcing function is a rollup. Resolving "the grey nordic mug" to a SKU wants
one denormalized document to match against, and the product is the natural home
for it. But a document cannot be both the authored definition and a projection
of somebody else's data. That has to be decided before it is built, not after.

## Decision

**The product is the canonical, platform-neutral definition. Sync may CREATE a
product; only a person may UPDATE one. Marketplace values live on the listing as
observed state.**

Four rules follow, and the first is the one everything else rests on.

### 1. Sync creates, never updates

A product born from an Amazon sync is canonical from birth. Amazon was the
midwife, not the owner.

This is already how `syncAmazonProducts` behaves — `upsertProduct` is called
only in the branch where no listing in the family exists yet; a matched family
reuses `oldest.productId` and never touches its fields. But that is currently an
_emergent property of the merge logic_, not a stated rule, and it is one
refactor away from being lost silently. It is now an invariant with a test
(`product-sync.spec.ts`), because the entire multi-platform story rests on it
and its failure mode is quiet: a resync overwrites authored titles and nobody
notices until a seller asks why their edit disappeared.

### 2. Marketplace values live on the listing

Once seeded, Amazon's title is no longer a competing version of the truth. It is
_observed marketplace state_, and it belongs on the listing next to `status` and
`salesRank`.

Divergence is therefore a **diff to show**, never a write to apply. "Your Amazon
title differs from your definition" is information the seller acts on; a sync
that silently reconciles it is a sync that destroys work.

### 3. Cross-platform identity is declared, not guessed

When a second platform syncs a product we already hold, nothing reliably says
so. Within Amazon the parent ASIN gives a family key. Across Amazon and Shopify
there is no shared key unless the seller has real GTINs — and private-label
sellers frequently do not.

So the sync **asks** which identifier to match on, per connection:

| strategy               | matches when                                         |
| ---------------------- | ---------------------------------------------------- |
| `sku`                  | the seller uses one SKU scheme across platforms      |
| `ean` / `upc` / `gtin` | the product carries a real global identifier         |
| `none`                 | default — never match; create and let a person merge |

`none` is the default because **a false merge is worse than a duplicate**. Two
products the seller merges by hand costs a minute. Two different products fused
under one definition corrupts both, and unpicking it means knowing which
attribute came from which — information the merge destroyed.

Merge is therefore a first-class user action rather than an error path. The
machinery already exists: `syncAmazonProducts` re-points listings and variants
onto a canonical product and soft-deletes the loser. Cross-platform merge is
that same operation with a person choosing the survivor instead of
`oldest.createdAt`.

### 4. Seeded values are distinguishable from authored ones

`brandName: 'Generic'` and `status: 'active'` are Amazon's guesses, presented
today as though the seller had entered them. Every seeded field is a **default
awaiting correction**, and the two must be tellable apart — otherwise "why does
it say Generic?" has no answer, and no one can say whether a resync would help
or destroy work.

Tracking which fields a person has authored is cheap now and unreconstructable
later: once a seeded value and an authored value look identical, the history
that distinguished them is gone.

## Options considered

### A. Product canonical, sync seeds only ✅ chosen

Above. Chosen because it is the only option under which "create this listing on
another platform" means anything: there has to be a definition that is not a
copy of one platform's opinion.

### B. Amazon wins; the product is a projection

Simplest, and honest about where the data comes from today. Rejected because it
makes the product layer pointless — every seller edit is lost on the next sync, so
the only safe authoring surface is Seller Central, and there is no product to
publish to a second platform.

### C. Two documents: an authored product and an observed one

Full fidelity, no ambiguity. Rejected as premature: observed state already has a
home on the listing, and a second document doubles every write path before there
is a second platform to justify it. Revisit if per-marketplace overrides of the
definition itself become necessary.

### D. Last-write-wins reconciliation

Rejected outright. It clobbers silently and leaves no way to tell an authored
value from a stale sync — the two failure modes this ADR exists to prevent.

## Consequences

**Positive**

- The `(Beige)` defect becomes a modelling fix rather than a data patch. A
  canonical title is "10oz Nordic Ceramic Coffee and Tea Mug"; the colour lives
  on the variant, where it already is.
- A product rollup (`searchText` plus the SKU list) has a coherent owner, so
  name → SKU resolution can be one document lookup instead of a three-collection
  join.
- Resync is safe by construction, which is what makes scheduled catalog sync
  something we can turn on without supervision.

**Negative / costs**

- The product drifts from Amazon and someone has to reconcile it. The diff has
  to be built and surfaced, or drift is merely invisible instead of destructive.
- Cross-platform duplicates are the expected outcome, not an error. Merge must
  be a real feature with a real UI.
- Seeded fields misrepresent the seller until corrected, and field-level origin
  tracking is a schema cost paid before anything visibly needs it.
- A rollup spanning three collections needs a single writer. Recomputing it in
  the store functions means a variant or listing write has to reach up and
  refresh its product — the one genuinely awkward edge in this design.
