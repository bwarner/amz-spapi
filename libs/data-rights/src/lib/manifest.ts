/**
 * How every collection is owned, for the purposes of answering a data-subject
 * request.
 *
 * ## Why this exists as a declaration rather than a query
 *
 * GDPR Art. 15 and 20 require handing someone everything we hold about them,
 * and Art. 17 requires destroying it. Both fail the same way and fail silently:
 * a collection nobody remembered. The export looks complete, the deletion
 * reports success, and the data is still there.
 *
 * So ownership is declared per collection, EXHAUSTIVELY, and a test cross-checks
 * this list against the DDL schema in `scripts/couchbase-schema.ts`. Adding a
 * collection there without classifying it here fails that test. The point is
 * not that this list is right today — it is that it cannot quietly go wrong.
 *
 * ## The three spellings
 *
 * ADR-0004 recorded that tenancy is a field with three spellings, and that is
 * still true: `userId` nearly everywhere, `user_id` in `credentials_profiles`,
 * and `sellerId` across `reports_*`. Rather than a migration to unify them —
 * which would touch every read in the app — the difference is captured here,
 * where it is needed exactly once.
 */

/** How a collection's documents are attributed to a person. */
export type Ownership =
  /** A field on the document holds the Auth0 subject. */
  | { kind: 'user-field'; field: 'userId' | 'user_id' }
  /**
   * A field holds the AMAZON seller id, which is not the Auth0 subject and is
   * not exclusive to one of our users. Resolved through `credentials_profiles`,
   * and only ever purged for a seller id no other user holds.
   */
  | { kind: 'seller-field'; field: 'sellerId' }
  /**
   * The document key encodes a hash of the user id, and no field carries it.
   * Cannot be found by query — the key has to be reconstructed.
   */
  | { kind: 'hashed-key'; describe: string }
  /**
   * Holds nothing attributable to a person. Must still be listed, with a reason
   * — an unclassified collection is indistinguishable from a forgotten one.
   */
  | { kind: 'not-personal'; because: string };

export type CollectionOwnership = {
  collection: string;
  ownership: Ownership;
};

const userField = (field: 'userId' | 'user_id' = 'userId'): Ownership => ({
  kind: 'user-field',
  field,
});

export const OWNERSHIP: CollectionOwnership[] = [
  // ── A+ content ────────────────────────────────────────────────────────────
  { collection: 'a_plus_drafts', ownership: userField() },
  { collection: 'a_plus_draft_versions', ownership: userField() },
  { collection: 'a_plus_brand_guides', ownership: userField() },
  { collection: 'a_plus_source_cache', ownership: userField() },

  // ── Catalog ───────────────────────────────────────────────────────────────
  { collection: 'catalog_products', ownership: userField() },
  { collection: 'catalog_variants', ownership: userField() },
  { collection: 'catalog_listings', ownership: userField() },
  { collection: 'catalog_listing_versions', ownership: userField() },

  // ── Chat ──────────────────────────────────────────────────────────────────
  { collection: 'chat_conversations', ownership: userField() },
  { collection: 'chat_messages', ownership: userField() },

  // ── Credentials ───────────────────────────────────────────────────────────
  // The odd spelling. Also the collection that resolves a user's seller ids,
  // so a purge must read it BEFORE deleting from it.
  { collection: 'credentials_profiles', ownership: userField('user_id') },
  {
    collection: 'credentials_locks',
    ownership: {
      kind: 'not-personal',
      because:
        'Single-flight token-refresh locks with a seconds-long TTL. They hold ' +
        'no subject and are gone before any request could be answered.',
    },
  },

  // ── Billing ───────────────────────────────────────────────────────────────
  {
    collection: 'billing_prices',
    ownership: {
      kind: 'not-personal',
      because:
        'The Stripe price catalogue — plan id, interval, price id and amount. ' +
        'A projection of our own published pricing, identical for every ' +
        'customer, holding no subject, no customer id and no subscription. ' +
        'What a particular person BOUGHT lives on their workspace, which is ' +
        'classified separately and is what a purge acts on.',
    },
  },

  // ── Identity ──────────────────────────────────────────────────────────────
  { collection: 'identity_members', ownership: userField() },
  {
    collection: 'identity_workspaces',
    ownership: {
      kind: 'not-personal',
      because:
        'A workspace is an organisation, not a person, and outlives any one ' +
        'member. Purging a user removes their membership; the workspace and ' +
        'its other members are unaffected. An owner leaving needs ownership ' +
        'transfer, which is a separate deliberate action, not a side effect.',
    },
  },
  {
    collection: 'identity_invitations',
    ownership: {
      kind: 'not-personal',
      because:
        'Keyed to a workspace and an invited EMAIL rather than a subject. ' +
        'Handled explicitly by the purge, which revokes any invitation ' +
        'addressed to the user, rather than by a subject-field sweep.',
    },
  },

  // ── Media ─────────────────────────────────────────────────────────────────
  // Metadata only. The BYTES are S3 objects, deleted separately — a purge that
  // drops these rows and leaves the objects has not deleted anything.
  { collection: 'media_assets', ownership: userField() },
  { collection: 'media_asset_hashes', ownership: userField() },
  { collection: 'media_asset_links', ownership: userField() },

  // ── Ops ───────────────────────────────────────────────────────────────────
  { collection: 'ops_cost_ledger', ownership: userField() },
  {
    collection: 'ops_spend_counters',
    ownership: {
      kind: 'hashed-key',
      describe: 'spend::<sha256(userId)[0:24]>::<YYYY-MM-DD>',
    },
  },

  // ── Purchases ─────────────────────────────────────────────────────────────
  { collection: 'purchases_documents', ownership: userField() },
  { collection: 'purchases_purchase-orders', ownership: userField() },
  { collection: 'purchases_vendor-records', ownership: userField() },
  { collection: 'purchases_buyer-records', ownership: userField() },
  { collection: 'purchases_fc-records', ownership: userField() },

  // ── Reports ───────────────────────────────────────────────────────────────
  // Amazon seller id, not Auth0 subject. `reports_rows` is the largest
  // collection in the database and contains order-level data.
  {
    collection: 'reports_rows',
    ownership: { kind: 'seller-field', field: 'sellerId' },
  },
  {
    collection: 'reports_imports',
    ownership: { kind: 'seller-field', field: 'sellerId' },
  },
  {
    collection: 'reports_box_labels',
    ownership: { kind: 'seller-field', field: 'sellerId' },
  },

  // ── SP-API cache ──────────────────────────────────────────────────────────
  // Amazon's own data about a marketplace, cached. `sp_cache_catalog` keys on
  // `item:<marketplaceId>:<ASIN>:<fields>` — public product data, shared across
  // every user, and attributable to nobody.
  ...[
    'sp_cache_catalog',
    'sp_cache_orders',
    'sp_cache_inventory',
    'sp_cache_listings',
    'sp_cache_finances',
    'sp_cache_inbound',
  ].map((collection) => ({
    collection,
    ownership: {
      kind: 'not-personal' as const,
      because:
        "A cache of Amazon's responses keyed by marketplace and ASIN, not by " +
        'user. Short-lived, shared, and reconstructible from Amazon at any ' +
        'time. NOTE: orders and finances would be personal data about a ' +
        "SELLER'S CUSTOMERS if retained — they are cache entries with a TTL, " +
        'and Amazon remains the controller. Revisit if that ever changes.',
    },
  })),

  // ── Sync ──────────────────────────────────────────────────────────────────
  // Keyed by seller, same reasoning as reports.
  ...[
    'sync_cursors',
    'sync_finance_events',
    'sync_settlement_groups',
    'sync_inbound_shipments',
    'sync_inventory_snapshots',
  ].map((collection) => ({
    collection,
    ownership: { kind: 'seller-field' as const, field: 'sellerId' as const },
  })),

  /**
   * The ads report sync's run records (#145).
   *
   * `user-field`, NOT `seller-field` like its neighbours above — and the
   * difference is not a preference. These documents are keyed on the ADVERTISER
   * PROFILE (`userId::profileId::kind::from..to`) and carry no `sellerId` at
   * all, because an ads profile and a seller account are different identifiers.
   * Classifying it as `seller-field` would name a field that does not exist, and
   * the export would find nothing while reporting success.
   */
  {
    collection: 'sync_ads_runs',
    ownership: { kind: 'user-field' as const, field: 'userId' as const },
  },
];

/** Lookup by collection name. */
export function ownershipOf(collection: string): Ownership | undefined {
  return OWNERSHIP.find((entry) => entry.collection === collection)?.ownership;
}

/** Collections a per-user export or purge has to visit, by ownership kind. */
export function collectionsOwnedBy(kind: Ownership['kind']): string[] {
  return OWNERSHIP.filter((entry) => entry.ownership.kind === kind).map(
    (entry) => entry.collection
  );
}
