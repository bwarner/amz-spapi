#!/usr/bin/env node
/**
 * Migrate to one scope per environment (ADR-0005, #71).
 *
 * Today's layout is a scope per domain — `a_plus.drafts`, `catalog.listings`.
 * The target is a scope per ENVIRONMENT holding flat collections named
 * `<domain>_<collection>`, so a database user granted one scope cannot reach
 * another environment's data.
 *
 *   a_plus.drafts       →  dev.a_plus_drafts
 *   catalog.listings    →  dev.catalog_listings
 *   sp_cache.listings   →  dev.sp_cache_listings   ← would collide without the prefix
 *
 * ADDITIVE AND IDEMPOTENT. It creates and copies; it never drops. The old
 * scopes are left exactly as they are, so the running application keeps working
 * until CB_SCOPE is switched, and rolling back is doing nothing.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-environment-scopes.ts --env dev            # plan only
 *   npx tsx scripts/migrate-to-environment-scopes.ts --env dev --apply
 *   npx tsx scripts/migrate-to-environment-scopes.ts --env prod --empty   # structure, no data
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET
 *   set -a && . apps/web/.env.local && set +a
 *
 * Uses the Data API, not the native SDK, which does not run on every machine
 * here — the same reason `couchbase-utils` talks HTTP.
 */

type Source = { domain: string; collection: string };

/** The layout as it exists today. Order is irrelevant; every pair is unique. */
const SOURCES: Source[] = [
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

/**
 * Secondary indexes, rebuilt against the new names.
 *
 * Primary indexes are deliberately NOT recreated — see #69 and ADR-0004.
 * Couchbase's own guidance is that they do not belong in production, and seven
 * of the seventeen on this cluster have never been scanned.
 */
const INDEXES: Array<{ collection: string; name: string; keys: string[] }> = [
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

const config = {
  url: (process.env['CB_DATA_API_URL'] || '').replace(/\/+$/, ''),
  user: process.env['CB_USERNAME'] || '',
  pass: process.env['CB_PASSWORD'] || '',
  bucket: process.env['CB_BUCKET'] || '',
};

const args = process.argv.slice(2);
const env = args[args.indexOf('--env') + 1];
const apply = args.includes('--apply');
const structureOnly = args.includes('--empty');

if (!config.url || !config.user || !config.pass || !config.bucket) {
  console.error(
    'Set CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET.\n' +
      '  set -a && . apps/web/.env.local && set +a'
  );
  process.exit(1);
}
if (!env || env.startsWith('--')) {
  console.error('Usage: --env <dev|staging|prod> [--apply] [--empty]');
  process.exit(1);
}

const q = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const B = q(config.bucket);

async function n1ql<T = unknown>(
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

async function countIn(scope: string, collection: string): Promise<number> {
  try {
    const rows = await n1ql<number>(
      `SELECT RAW COUNT(*) FROM ${B}.${q(scope)}.${q(collection)}`,
      true
    );
    return rows[0] ?? 0;
  } catch {
    // No index to scan with, or the keyspace does not exist yet.
    return -1;
  }
}

async function main() {
  console.log(
    `\n${
      apply ? 'APPLYING' : 'PLAN (no changes — pass --apply)'
    } → scope ${env}` + `${structureOnly ? ', structure only' : ''}\n`
  );

  // ---- structure ---------------------------------------------------------
  const ddl = [
    `CREATE SCOPE ${B}.${q(env)} IF NOT EXISTS`,
    ...SOURCES.map(
      (s) =>
        `CREATE COLLECTION ${B}.${q(env)}.${q(
          `${s.domain}_${s.collection}`
        )} IF NOT EXISTS`
    ),
  ];
  for (const statement of ddl) {
    if (apply) await n1ql(statement);
  }
  console.log(
    `  scope + ${SOURCES.length} collections${apply ? ' created' : ''}`
  );

  if (apply) {
    // A collection is not immediately queryable after DDL returns.
    await new Promise((r) => setTimeout(r, 4000));
  }

  // ---- data --------------------------------------------------------------
  let copied = 0;
  const mismatches: string[] = [];

  if (!structureOnly) {
    for (const source of SOURCES) {
      const target = `${source.domain}_${source.collection}`;
      const before = await countIn(source.domain, source.collection);
      if (before === 0) continue;

      if (!apply) {
        console.log(
          `  ${source.domain}.${source.collection} → ${target}  (${
            before < 0 ? 'needs temp index' : before
          } docs)`
        );
        continue;
      }

      // Some source collections have no index to scan with. A primary index is
      // created for the copy and dropped afterwards — temporary by construction,
      // so the cluster ends as it started (#69).
      let temporaryIndex = false;
      if (before < 0) {
        await n1ql(
          `CREATE PRIMARY INDEX ON ${B}.${q(source.domain)}.${q(
            source.collection
          )}`
        );
        temporaryIndex = true;
        await new Promise((r) => setTimeout(r, 2000));
      }

      const total = await countIn(source.domain, source.collection);
      if (total > 0) {
        // UPSERT, not INSERT: keys are preserved, so a second run overwrites
        // rather than failing on every existing key. A migration you cannot
        // re-run is one you have to get right first time.
        await n1ql(
          `UPSERT INTO ${B}.${q(env)}.${q(target)} (KEY k, VALUE v) ` +
            `SELECT META(d).id AS k, d AS v ` +
            `FROM ${B}.${q(source.domain)}.${q(source.collection)} AS d`
        );
      }

      if (temporaryIndex) {
        await n1ql(
          `DROP PRIMARY INDEX ON ${B}.${q(source.domain)}.${q(
            source.collection
          )}`
        );
      }

      const after = await countIn(env, target);
      const ok = after === total;
      if (!ok) mismatches.push(`${target}: source ${total}, target ${after}`);
      copied += total;
      console.log(`  ${ok ? '✓' : '✗'} ${target.padEnd(26)} ${total} docs`);
    }
  }

  // ---- indexes -----------------------------------------------------------
  for (const index of INDEXES) {
    const statement =
      `CREATE INDEX ${q(index.name)} ON ${B}.${q(env)}.${q(index.collection)}` +
      `(${index.keys.join(',')})`;
    if (apply) {
      try {
        await n1ql(statement);
      } catch (error) {
        // Already present from a previous run.
        if (!String(error).includes('already exist')) throw error;
      }
    }
  }
  console.log(
    `  ${INDEXES.length} secondary indexes${
      apply ? ' created' : ''
    } (no primaries — #69)`
  );

  if (mismatches.length) {
    console.error(
      `\n✗ COUNT MISMATCH — do not switch CB_SCOPE:\n  ${mismatches.join(
        '\n  '
      )}`
    );
    process.exit(1);
  }

  console.log(
    apply
      ? `\n✓ ${env} ready — ${copied} documents copied. Old scopes untouched.\n` +
          `  Next: create a database user granted only scope ${env}, then set CB_SCOPE=${env}.\n`
      : `\nPlan only. Re-run with --apply.\n`
  );
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
