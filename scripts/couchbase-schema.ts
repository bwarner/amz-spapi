/**
 * The declared shape of an environment scope, and the client the scripts share.
 *
 * This is the single source of truth for collections and indexes. `couchbase-ddl.ts`
 * converges a scope onto it; `migrate-to-environment-scopes.ts` reads the same list
 * to know what to copy. Adding a collection or an index means editing THIS file and
 * running the DDL tool — nothing else.
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET
 *   set -a && . apps/web/.env.local && set +a
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
    collection: 'reports_imports',
    name: 'idx_report_imports_seller_kind',
    keys: ['`sellerId`', '`kind`', '`observedFrom`'],
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
      '  set -a && . apps/web/.env.local && set +a'
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
  if (!response.ok || body.status === 'errors') {
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
