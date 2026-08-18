/**
 * The declared shape of an environment scope, and the client the scripts share.
 *
 * This is the single source of truth for collections and indexes. `couchbase-ddl.ts`
 * converges a scope onto it; `migrate-to-environment-scopes.ts` reads the same list
 * to know what to copy. Adding a collection or an index means editing THIS file and
 * running the DDL tool — nothing else.
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET
 *   npx tsx --env-file=apps/web/.env.local <script>
 *
 * Node reads the file itself (`--env-file`, native since 20.6). Do NOT use
 * `set -a && . apps/web/.env.local`: the shell re-expands the value, so a
 * password containing $, ` or ! arrives truncated or altered, and the only
 * symptom is an authentication failure indistinguishable from a wrong
 * password. One of ours is 18 characters and the shell delivered 8.
 *
 * Uses the Data API rather than the native SDK. That constraint is really about the
 * Vercel runtime and not about scripts (see #56) — the native SDK would be fine here
 * and is already a dependency. Left as HTTP for now so there is one client to reason
 * about; #76 may retire the distinction entirely.
 */

export type Source = {
  /** The old scope, now a prefix on the collection name (ADR-0005). */
  domain: string;
  /** The entity, as it was named inside that scope. */
  collection: string;
};

/** `a_plus` + `drafts` → `a_plus_drafts`. Unique because scope+collection was. */
export function flatName(source: Source): string {
  return `${source.domain}_${source.collection}`;
}

/**
 * Every collection an environment scope holds.
 *
 * Ordered by domain purely for reading; creation order is irrelevant.
 */
export const SOURCES: Source[] = [
  ...['catalog', 'orders', 'inventory', 'listings', 'finances', 'inbound'].map(
    (c) => ({ domain: 'sp_cache', collection: c })
  ),
  { domain: 'credentials', collection: 'profiles' },
  // Short-lived single-flight locks for token refresh (#55). Its own
  // collection rather than a key prefix in `profiles`: every document here
  // expires on its own, so a collection that is briefly non-empty and normally
  // empty can be reasoned about — and no profile query can ever see one.
  { domain: 'credentials', collection: 'locks' },
  ...['assets', 'asset_hashes', 'asset_links'].map((c) => ({
    domain: 'media',
    collection: c,
  })),
  ...['drafts', 'brand_guides', 'source_cache', 'draft_versions'].map((c) => ({
    domain: 'a_plus',
    collection: c,
  })),
  ...['products', 'variants', 'listings', 'listing_versions'].map((c) => ({
    domain: 'catalog',
    collection: c,
  })),
  ...['conversations', 'messages'].map((c) => ({
    domain: 'chat',
    collection: c,
  })),
  ...['rows', 'imports', 'box_labels'].map((c) => ({
    domain: 'reports',
    collection: c,
  })),
  ...['cost_ledger', 'spend_counters'].map((c) => ({
    domain: 'ops',
    collection: c,
  })),
  // Extracted purchase documents (#50). Its own domain rather than a `reports`
  // collection: these are the seller's own evidence — a supplier's invoice, a
  // carrier's waybill — not anything Amazon produced.
  { domain: 'purchases', collection: 'documents' },
  // Procurement. Hyphenated collection names, matching what the stores in
  // `sp-cache` already name — every query backticks them, so this is a
  // consistency wart rather than a hazard, and renaming a collection the code
  // already writes to would be a migration for cosmetics.
  { domain: 'purchases', collection: 'purchase-orders' },
  // See vendor-store.ts: `purchases_vendors` is stuck at the Data API.
  { domain: 'purchases', collection: 'vendor-records' },
  { domain: 'purchases', collection: 'buyer-records' },
  { domain: 'purchases', collection: 'fc-records' },
  // Who may use the product, and whose data they see. Its own domain because
  // it answers a question asked BEFORE any other collection is read: a request
  // with no membership never reaches catalog, chat or credentials at all.
  ...['workspaces', 'members', 'invitations'].map((c) => ({
    domain: 'identity',
    collection: c,
  })),
  // The Stripe price catalogue. A projection of Stripe, not a second source of
  // truth: it answers "which price id is plan X at interval Y" without a
  // network call, so the pricing page and checkout read the same row and a
  // Stripe outage cannot take the pricing page down.
  { domain: 'billing', collection: 'prices' },
  // Scheduled sync (#34). `cursors` is the high-water mark per user x seller x
  // domain and is the only record of what has been fetched — a gap behind it is
  // indistinguishable from a quiet period, which is why it is stored rather
  // than derived from the data.
  { domain: 'sync', collection: 'cursors' },
  { domain: 'sync', collection: 'finance_events' },
  { domain: 'sync', collection: 'settlement_groups' },
  { domain: 'sync', collection: 'inbound_shipments' },
  // Levels over time exist ONLY because this records them: getInventorySummaries
  // is a point-in-time reading and Amazon keeps no history, so a missed day is
  // unrecoverable by any backfill.
  { domain: 'sync', collection: 'inventory_snapshots' },
  // Ads report sync (#145). Two jobs: telling a failed fetch apart from a
  // quiet period (the data alone cannot), and recording which windows the
  // sync owns so a manual upload of the same window is refused rather than
  // silently doubling every row.
  { domain: 'sync', collection: 'ads_runs' },
  // Keyword harvest funnels (#147). Amazon has no concept of one campaign
  // feeding another, so the relationship is ours to store.
  //
  // Graduations are their own collection rather than a list inside the funnel:
  // they accrue for as long as the funnel runs, and each one is written twice
  // days apart — once when the keyword is created, once when the backward
  // negative comes due — so an embedded list would grow without bound and let
  // the second writer drop the first writer's `keywordId`.
  { domain: 'ads', collection: 'funnels' },
  { domain: 'ads', collection: 'graduations' },
];

export type IndexSpec = {
  collection: string;
  name: string;
  /**
   * Index keys EXACTLY as Couchbase reports them in `system:indexes.index_key`
   * — backticked identifiers, parenthesised paths. Written in that form so the
   * declared state and the observed state compare without normalising, which is
   * what lets the DDL tool detect a changed index rather than only a missing one.
   */
  keys: string[];
  /** WHERE clause for a partial index, in Couchbase's own rendering. */
  condition?: string;
};

/**
 * Secondary indexes.
 *
 * Primary indexes are deliberately absent — see #69 and ADR-0004. Couchbase's own
 * guidance is that they do not belong in production, and seven of the seventeen on
 * this cluster have never been scanned. The DDL tool reports any it finds as drift.
 */
export const INDEXES: IndexSpec[] = [
  {
    collection: 'ops_cost_ledger',
    name: 'idx_cost_ledger_user_day',
    keys: ['`userId`', '`day`'],
  },
  // The Stripe webhook's fallback lookup. A subscription created in the Stripe
  // dashboard carries none of our metadata, so `workspaceId` has to be
  // recovered from the customer id — and without this the query falls back to a
  // sequential scan of every workspace on each delivery. It does not FAIL
  // (Couchbase 7.6 scans without a primary index), which is precisely why it
  // would go unnoticed until the collection is large and Stripe is retrying.
  {
    collection: 'identity_workspaces',
    name: 'idx_workspaces_stripe_customer',
    keys: ['`stripeCustomerId`'],
  },
  // Every authenticated request asks "which workspaces is this user in?" before
  // it does anything else, so this one is on the hot path for the whole app.
  {
    collection: 'identity_members',
    name: 'idx_members_user',
    keys: ['`userId`', '`workspaceId`'],
  },
  // The members list for one workspace, for the settings page.
  {
    collection: 'identity_members',
    name: 'idx_members_workspace',
    keys: ['`workspaceId`', '`role`'],
  },
  // Sign-in looks an invitation up by EMAIL, not by id: the gate has to answer
  // "was this person invited?" for someone who arrived without a link.
  {
    collection: 'identity_invitations',
    name: 'idx_invitations_email_status',
    keys: ['`email`', '`status`'],
  },
  // The pending list for one workspace, and the uniqueness check before issuing.
  {
    collection: 'identity_invitations',
    name: 'idx_invitations_workspace_status',
    keys: ['`workspaceId`', '`status`', '`createdAt`'],
  },
  {
    collection: 'reports_rows',
    name: 'idx_report_rows_seller_kind',
    keys: ['`sellerId`', '`reportKind`', '(`fields`.`date`)'],
  },
  {
    collection: 'reports_rows',
    name: 'idx_report_rows_fnsku',
    keys: ['`sellerId`', '(`fields`.`fnsku`)', '`reportKind`'],
  },
  {
    collection: 'reports_rows',
    name: 'idx_report_rows_reference',
    keys: ['`sellerId`', '(`fields`.`referenceId`)'],
  },
  {
    // Which rows one import actually brought in — asked before deleting a file,
    // and by the delete itself. Without it both statements scan every row the
    // seller has (tens of thousands) to find the few thousand they mean.
    collection: 'reports_rows',
    name: 'idx_report_rows_import',
    keys: ['`sellerId`', '`importId`'],
  },
  {
    collection: 'reports_imports',
    name: 'idx_report_imports_seller_kind',
    keys: ['`sellerId`', '`kind`', '`observedFrom`'],
  },
  // Both graduation queries start from the owner: the funnel's own history, and
  // the due-negatives sweep that is the self-competition detector. The sweep
  // runs on a schedule against a collection that only ever grows, so without
  // this it gets slower every week it finds nothing — the worst shape for a
  // check whose whole job is to be boring.
  {
    collection: 'ads_graduations',
    name: 'idx_graduations_user_state',
    keys: ['`userId`', '(`graduation`.`state`)', '(`graduation`.`funnelId`)'],
  },
  {
    collection: 'reports_box_labels',
    name: 'idx_box_labels_seller_shipment',
    keys: ['`sellerId`', '`shipmentId`', '`boxNumber`'],
  },
  {
    collection: 'chat_messages',
    name: 'idx_chat_messages_chat_seq',
    keys: ['`userId`', '`chatId`', '`seq`'],
  },
  {
    collection: 'chat_conversations',
    name: 'idx_chat_conversations_user_updated',
    keys: ['`userId`', '`updatedAt`'],
  },
  {
    collection: 'credentials_profiles',
    name: 'idx_profiles_user_apitype',
    keys: ['`user_id`', '`api_type`'],
  },
  {
    // "What have I uploaded?" — the file manager's only read. There was no
    // index here at all because nothing had ever listed this collection: every
    // other caller arrives holding an asset id. `createdForFeature` sits in the
    // middle so the documents screen scans only documents and not every
    // generated A+ image, which outnumber them heavily.
    collection: 'media_assets',
    name: 'idx_assets_user_feature_created',
    keys: ['`userId`', '`createdForFeature`', '`createdAt`'],
  },
  {
    collection: 'media_asset_links',
    name: 'idx_asset_links_owner',
    keys: ['`userId`', '`ownerType`', '`ownerId`'],
  },
  {
    collection: 'media_asset_links',
    name: 'idx_asset_links_asset',
    keys: ['`userId`', '`assetId`'],
  },
  {
    collection: 'a_plus_drafts',
    name: 'idx_a_plus_drafts_user_updated',
    keys: ['`userId`', '`updatedAt`'],
  },
  {
    collection: 'a_plus_brand_guides',
    name: 'idx_a_plus_brand_guides_user_updated',
    keys: ['`userId`', '`updatedAt`'],
  },
  {
    collection: 'a_plus_draft_versions',
    name: 'idx_a_plus_draft_versions_draft',
    keys: ['`userId`', '`draftId`', '`createdAt`'],
  },
  {
    collection: 'catalog_products',
    name: 'idx_products_user_updated',
    keys: ['`userId`', '`updatedAt`'],
  },
  {
    collection: 'catalog_variants',
    name: 'idx_variants_user_product',
    keys: ['`userId`', '`productId`'],
  },
  {
    collection: 'catalog_listings',
    name: 'idx_listings_user_product',
    keys: ['`userId`', '`productId`'],
  },
  {
    collection: 'catalog_listings',
    name: 'idx_listings_user_sku',
    keys: ['`userId`', '`platform`', '`marketplaceId`', '(`external`.`sku`)'],
  },
  {
    collection: 'catalog_listings',
    name: 'idx_listings_user_asin',
    keys: ['`userId`', '`platform`', '`marketplaceId`', '(`external`.`asin`)'],
  },
  {
    collection: 'catalog_listing_versions',
    name: 'idx_listing_versions_user_sku',
    keys: ['`userId`', '`sku`', '`capturedAt`'],
  },
  {
    // The default read: one seller's documents, newest first, optionally within
    // a date range. `documentDate` rather than `storedAt`, because a purchase is
    // grouped by when it happened, not when the PDF was uploaded — the waybill
    // for a January order often arrives in March.
    collection: 'purchases_documents',
    name: 'idx_purchase_documents_user_date',
    keys: ['`userId`', '(`extracted`.`documentDate`)'],
  },
  {
    // "Everything from this supplier", which is how a human looks for the other
    // half of a purchase when no shared identifier joined it automatically.
    collection: 'purchases_documents',
    name: 'idx_purchase_documents_user_vendor',
    keys: ['`userId`', '(`extracted`.`vendorName`)'],
  },
  {
    // Every PO listing starts from the user and orders by issue date; the
    // vendor filter is optional and narrows from there.
    collection: 'purchases_purchase-orders',
    name: 'idx_purchase_orders_user_date',
    keys: ['`userId`', '(`order`.`issueDate`)'],
  },
  {
    collection: 'purchases_vendor-records',
    name: 'idx_vendors_user_name',
    keys: ['`userId`', '(`vendor`.`name`)'],
  },
  {
    collection: 'purchases_fc-records',
    name: 'idx_amazon_fcs_user_code',
    keys: ['`userId`', '(`fc`.`fcCode`)'],
  },
  {
    // The dispatcher's read: which sellers are due, and which are failing
    // repeatedly enough to shed.
    collection: 'sync_cursors',
    name: 'idx_sync_cursors_domain_run',
    keys: ['`domain`', '`lastRunAt`'],
  },
  {
    // Inventory levels over time for one seller — the series this whole job
    // exists to make possible.
    collection: 'sync_inventory_snapshots',
    name: 'idx_inventory_snapshots_seller_day',
    keys: ['`sellerId`', '`day`'],
  },
  {
    collection: 'sync_finance_events',
    name: 'idx_finance_events_seller_window',
    keys: ['`sellerId`', '`windowFrom`'],
  },
  {
    // Staleness and window-ownership reads, both scoped to one advertiser
    // profile. No primary index on this cluster (ADR-0004), so the leading
    // key is required rather than an optimisation.
    collection: 'sync_ads_runs',
    name: 'idx_ads_runs_user_updated',
    keys: ['`userId`', '`updatedAt`'],
  },
];

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const config = {
  url: (process.env['CB_DATA_API_URL'] || '').replace(/\/+$/, ''),
  user: process.env['CB_USERNAME'] || '',
  pass: process.env['CB_PASSWORD'] || '',
  bucket: process.env['CB_BUCKET'] || '',
};

/** Backtick-quote an identifier. */
export const q = (name: string) => `\`${name.replace(/`/g, '``')}\``;

/** Single-quote a string literal. */
export const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const B = () => q(config.bucket);

export function requireConfig(): void {
  if (config.url && config.user && config.pass && config.bucket) return;
  console.error(
    'Set CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET.\n' +
      '  npx tsx --env-file=apps/web/.env.local <script>'
  );
  process.exit(1);
}

export function requireEnv(value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    console.error('Missing --env <dev|staging|prod>');
    process.exit(1);
  }
  return value;
}

export async function n1ql<T = unknown>(
  statement: string,
  /**
   * Counts MUST be consistent. N1QL defaults to `not_bounded`, which reads
   * whatever the index has caught up to — so a count taken straight after a
   * mutation under-reports, and a verification built on it is worthless in both
   * directions: it cries wolf, and it can also pass while data is missing.
   */
  consistent = false
): Promise<T[]> {
  const response = await fetch(`${config.url}/_p/query/query/service`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.user}:${config.pass}`
      ).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      statement,
      ...(consistent ? { scan_consistency: 'request_plus' } : {}),
    }),
  });
  const body = (await response.json()) as {
    status?: string;
    results?: T[];
    errors?: Array<{ msg?: string }>;
  };
  // Trust the errors array, not the status string. The Data API answers a
  // failed DDL with HTTP 200 and `status: "fatal"` — so a check for
  // `status === 'errors'` passes it through and returns an empty result set,
  // which reads exactly like "nothing to do". A collection hitting the
  // 100-per-bucket cap was silently dropped this way, and only surfaced three
  // steps later as "keyspace not found" when the index was built against the
  // collection that had never been created.
  if (!response.ok || (body.errors && body.errors.length > 0)) {
    throw new Error(
      body.errors?.map((e) => e.msg).join('; ') || `HTTP ${response.status}`
    );
  }
  return body.results ?? [];
}

export async function countIn(
  scope: string,
  collection: string
): Promise<number> {
  try {
    const rows = await n1ql<number>(
      `SELECT RAW COUNT(*) FROM ${B()}.${q(scope)}.${q(collection)}`,
      true
    );
    return rows[0] ?? 0;
  } catch {
    // No index to scan with, or the keyspace does not exist yet.
    return -1;
  }
}
