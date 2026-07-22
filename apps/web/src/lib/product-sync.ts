import { SpApiClient } from '@farvisionllc/sp-client';
import type { ListingSnapshot, ProductListing } from '@farvisionllc/models';
import { resolveAmazonConnection } from './amazon-connections';
import { getCredentialStore } from './credential-store';
import { createProductId, deleteProduct, upsertProduct } from './products';
import { createVariantId, upsertVariant } from './product-variants';
import {
  createListingId,
  findListingBySku,
  listListings,
  upsertListing,
} from './product-listings';

// Bounds so one sync stays well under SP-API rate limits and Vercel timeouts.
const MAX_INVENTORY_PAGES = 10; // FBA inventory pages walked per sync
const MAX_ASINS = 150; // distinct ASINs enriched via Catalog per sync
const CATALOG_BATCH_SIZE = 20; // ASINs per searchCatalogItems call (API max)
const CATALOG_CONCURRENCY = 2; // parallel catalog batches (~2 req/sec limit)

/** FBA inventory summary — only the fields we consume (loosely typed upstream). */
type InventorySummary = {
  asin?: string;
  fnSku?: string;
  sellerSku?: string;
  productName?: string;
  totalQuantity?: number;
};

/** Loose projection of the Catalog Items 2022-04-01 item shape. */
type CatalogItem = {
  asin?: string;
  // Product-type attributes: each is an array of localized values. We only read
  // `bullet_point`; the rest of the (large) attribute map is ignored.
  attributes?: {
    bullet_point?: Array<{ value?: string }>;
  } & Record<string, unknown>;
  summaries?: Array<{
    brand?: string;
    itemName?: string;
    productType?: string;
    status?: string[];
  }>;
  images?: Array<{
    images?: Array<{
      variant?: string;
      link?: string;
      height?: number;
      width?: number;
    }>;
  }>;
  salesRanks?: Array<{
    classificationRanks?: Array<{
      classificationId?: string;
      title?: string;
      rank?: number;
    }>;
    displayGroupRanks?: Array<{ title?: string; rank?: number }>;
  }>;
  // Variation relationships: a child carries `parentAsins` + `variationTheme`;
  // a parent carries `childAsins`. Used to collapse variants under one product.
  relationships?: Array<{
    relationships?: Array<{
      type?: string;
      parentAsins?: string[];
      childAsins?: string[];
      variationTheme?: { attributes?: string[]; theme?: string };
    }>;
  }>;
};

export type ProductSyncSummary = {
  connected: boolean;
  profileName?: string;
  marketplaceId?: string;
  scanned: number; // seller SKUs found in inventory
  productsCreated: number; // new Products materialized
  productsMatched: number; // existing Products reused (idempotent re-sync)
  productsMerged: number; // duplicate Products folded into a variation family
  listingsUpserted: number; // Amazon listings written
  truncated: boolean; // hit a page/ASIN cap — not the full catalog
  errors: string[];
  message?: string;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

export function buildSnapshot(item: CatalogItem | undefined): {
  snapshot: ListingSnapshot;
  status: ProductListing['status'];
} {
  const summary = item?.summaries?.[0];
  const imageList = item?.images?.[0]?.images ?? [];
  const mainRaw =
    imageList.find((image) => image.variant === 'MAIN') ?? imageList[0];
  const ranks =
    item?.salesRanks?.[0]?.displayGroupRanks ??
    item?.salesRanks?.[0]?.classificationRanks ??
    [];
  const bulletPoints = (item?.attributes?.bullet_point ?? [])
    .map((bullet) => bullet.value?.trim())
    .filter((value): value is string => Boolean(value));

  const snapshot: ListingSnapshot = {
    title: summary?.itemName,
    brand: summary?.brand,
    productType: summary?.productType,
    bulletPoints: bulletPoints.length ? bulletPoints : undefined,
    mainImage: mainRaw?.link
      ? {
          url: mainRaw.link,
          height: mainRaw.height,
          width: mainRaw.width,
        }
      : undefined,
    images: imageList
      .filter((image) => image.link)
      .map((image) => ({
        variant: image.variant,
        url: image.link as string,
        height: image.height,
        width: image.width,
      })),
    salesRank: ranks
      .filter((rank) => typeof rank.rank === 'number')
      .map((rank) => ({ title: rank.title, rank: rank.rank })),
  };

  const statusFlags = summary?.status ?? [];
  const status: ProductListing['status'] = statusFlags.length
    ? statusFlags.includes('BUYABLE')
      ? 'active'
      : 'inactive'
    : 'unknown';

  return { snapshot, status };
}

/** Parent ASIN + variation theme for a catalog item, if it's a variation child. */
function variationParentOf(item: CatalogItem | undefined): {
  parentAsin?: string;
  variationTheme?: { attributes?: string[]; theme?: string };
} {
  for (const group of item?.relationships ?? []) {
    for (const rel of group.relationships ?? []) {
      if (rel.parentAsins?.length) {
        return {
          parentAsin: rel.parentAsins[0],
          variationTheme: rel.variationTheme,
        };
      }
    }
  }
  return {};
}

/** Read a single variation-attribute value (e.g. color → "Sand Dune"). */
function attributeValue(
  item: CatalogItem | undefined,
  attr: string
): string | undefined {
  const raw = (item?.attributes as Record<string, unknown> | undefined)?.[attr];
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const value = (raw[0] as { value?: unknown })?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function prettifyAttr(attr: string): string {
  const spaced = attr.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Variant options from a child's variation attributes (e.g. [{Color, Sand Dune}]). */
function buildVariantOptions(
  item: CatalogItem | undefined,
  variationTheme?: { attributes?: string[] }
): Array<{ name: string; value: string }> {
  const options: Array<{ name: string; value: string }> = [];
  for (const attr of variationTheme?.attributes ?? []) {
    const value = attributeValue(item, attr);
    if (value) options.push({ name: prettifyAttr(attr), value });
  }
  return options;
}

export type UserSpApiClient = {
  client: SpApiClient;
  marketplaceId: string;
  profileName: string;
};

/**
 * Build an SP-API client for the user's default connection, wired to persist
 * refreshed access tokens. Returns a not-connected marker instead of throwing
 * so callers can surface a "connect Amazon" prompt.
 */
export async function createUserSpApiClient(
  userId: string
): Promise<UserSpApiClient | { connected: false; message: string }> {
  const defaultMarketplaceId =
    process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  const resolved = await resolveAmazonConnection({ apiType: 'SP_API', userId });
  if (!resolved.connected) {
    return { connected: false, message: resolved.reason };
  }

  const { profile, profileName } = resolved.connection;
  const marketplaceId = profile.marketplace_id || defaultMarketplaceId;
  const credStore = getCredentialStore();

  const client = new SpApiClient({
    clientId: profile.client_id,
    clientSecret: profile.client_secret,
    refreshToken: profile.refresh_token,
    accessToken: profile.access_token,
    sellerId: profile.seller_id,
    marketplaceId,
    region: (profile.region as 'NA' | 'EU' | 'FE') || 'NA',
    onTokenRefresh: async (accessToken, expiresIn) => {
      await credStore.updateAccessToken(
        profileName,
        'SP_API',
        accessToken,
        expiresIn,
        userId
      );
    },
  });

  return { client, marketplaceId, profileName };
}

/**
 * Fetch catalog items for many ASINs, keyed by ASIN. Batches up to 20 ASINs per
 * `searchCatalogItems` call (the Catalog API allows only ~2 req/sec, so one
 * request per ASIN trips 429s — batching cuts request count ~20x). ASINs missing
 * from a response are simply absent from the map; batch failures push to
 * `errors` rather than aborting.
 */
export async function fetchCatalogByAsin(
  client: SpApiClient,
  marketplaceId: string,
  asins: string[],
  errors: string[]
): Promise<Map<string, CatalogItem>> {
  const catalogByAsin = new Map<string, CatalogItem>();
  const batches: string[][] = [];
  for (let i = 0; i < asins.length; i += CATALOG_BATCH_SIZE) {
    batches.push(asins.slice(i, i + CATALOG_BATCH_SIZE));
  }
  await mapWithConcurrency(batches, CATALOG_CONCURRENCY, async (batch) => {
    try {
      const result = (await client.searchCatalogItems({
        identifiers: batch,
        identifiersType: 'ASIN',
        marketplaceIds: [marketplaceId],
        includedData: [
          'summaries',
          'images',
          'salesRanks',
          'attributes',
          'relationships',
        ],
        // Default pageSize is 10, which silently truncates a 20-ASIN batch and
        // leaves the dropped items with empty snapshots. Cover the whole batch.
        pageSize: CATALOG_BATCH_SIZE,
      })) as { items?: CatalogItem[] };
      for (const item of result.items ?? []) {
        if (item.asin) catalogByAsin.set(item.asin, item);
      }
    } catch (error) {
      errors.push(
        `catalog batch (${batch.length} ASINs): ${
          error instanceof Error ? error.message : 'lookup failed'
        }`
      );
    }
  });
  return catalogByAsin;
}

/**
 * Pull every FBA seller SKU from the connected SP-API account and materialize
 * the Product → Variant → Listing spine in Couchbase.
 *
 * Idempotent: re-running matches existing Amazon listings by SELLER SKU
 * (`findListingBySku`) and refreshes only the catalog `snapshot`, never the
 * user-owned Product fields. Multiple SKUs sharing one ASIN collapse onto a
 * single Product + default Variant (many listings per ASIN).
 */
export async function syncAmazonProducts(
  userId: string
): Promise<ProductSyncSummary> {
  const connection = await createUserSpApiClient(userId);
  if ('connected' in connection) {
    return {
      connected: false,
      scanned: 0,
      productsCreated: 0,
      productsMatched: 0,
      productsMerged: 0,
      listingsUpserted: 0,
      truncated: false,
      errors: [],
      message: connection.message,
    };
  }

  const { client, marketplaceId, profileName } = connection;
  const errors: string[] = [];

  // 1) Walk FBA inventory to discover every seller SKU (and its ASIN/FNSKU).
  const inventory: InventorySummary[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;
  let truncated = false;
  try {
    do {
      const page = (await client.getInventorySummaries({
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: [marketplaceId],
        nextToken,
      })) as { inventorySummaries?: InventorySummary[]; nextToken?: string };
      inventory.push(...(page.inventorySummaries ?? []));
      nextToken = page.nextToken;
      pageCount += 1;
    } while (nextToken && pageCount < MAX_INVENTORY_PAGES);
    if (nextToken) truncated = true;
  } catch (error) {
    return {
      connected: true,
      profileName,
      marketplaceId,
      scanned: 0,
      productsCreated: 0,
      productsMatched: 0,
      productsMerged: 0,
      listingsUpserted: 0,
      truncated: false,
      errors: [
        error instanceof Error
          ? error.message
          : 'Could not read FBA inventory.',
      ],
      message: 'Amazon inventory could not be read.',
    };
  }

  // Keep only SKUs we can identify, and group them by ASIN.
  const usableItems = inventory.filter((item) => item.sellerSku && item.asin);
  const byAsin = new Map<string, InventorySummary[]>();
  for (const item of usableItems) {
    const asin = item.asin as string;
    const group = byAsin.get(asin);
    if (group) group.push(item);
    else byAsin.set(asin, [item]);
  }

  let asins = [...byAsin.keys()];
  if (asins.length > MAX_ASINS) {
    asins = asins.slice(0, MAX_ASINS);
    truncated = true;
  }

  // 2) Enrich ASINs with a bounded catalog snapshot (batched, rate-safe).
  const catalogByAsin = await fetchCatalogByAsin(
    client,
    marketplaceId,
    asins,
    errors
  );

  // 3) Group ASINs into variation FAMILIES. A variation child collapses under
  //    its parent ASIN (one Product, one Variant per child); a standalone ASIN
  //    is its own family. Parents aren't in inventory, so fetch them for titles.
  const familyKeyByAsin = new Map<string, string>();
  const variationThemeByAsin = new Map<
    string,
    { attributes?: string[]; theme?: string }
  >();
  const parentAsins = new Set<string>();
  for (const asin of asins) {
    const { parentAsin, variationTheme } = variationParentOf(
      catalogByAsin.get(asin)
    );
    familyKeyByAsin.set(asin, parentAsin ?? asin);
    if (variationTheme) variationThemeByAsin.set(asin, variationTheme);
    if (parentAsin) parentAsins.add(parentAsin);
  }

  const parentCatalog = parentAsins.size
    ? await fetchCatalogByAsin(client, marketplaceId, [...parentAsins], errors)
    : new Map<string, CatalogItem>();

  const familyChildAsins = new Map<string, string[]>();
  for (const asin of asins) {
    const key = familyKeyByAsin.get(asin) as string;
    const list = familyChildAsins.get(key);
    if (list) list.push(asin);
    else familyChildAsins.set(key, [asin]);
  }

  // 4) Materialize each family → one Product with a Variant per child ASIN.
  //    Idempotent by seller SKU; re-runs reuse the existing spine and MERGE any
  //    duplicate products left by the older one-product-per-ASIN model.
  let productsCreated = 0;
  let productsMatched = 0;
  let productsMerged = 0;
  let listingsUpserted = 0;

  for (const [familyKey, childAsins] of familyChildAsins) {
    try {
      // Existing listings for every SKU in the family (idempotency + merge).
      const existingByAsin = new Map<string, ProductListing[]>();
      const allExisting: ProductListing[] = [];
      for (const asin of childAsins) {
        for (const item of byAsin.get(asin) ?? []) {
          const existing = await findListingBySku({
            userId,
            marketplaceId,
            sku: item.sellerSku as string,
          });
          if (existing) {
            const bucket = existingByAsin.get(asin);
            if (bucket) bucket.push(existing);
            else existingByAsin.set(asin, [existing]);
            allExisting.push(existing);
          }
        }
      }

      const multiVariant = childAsins.length > 1;

      // Canonical product = the oldest existing listing's product (stable across
      // re-syncs); every other product in the family merges into it. A new
      // family creates a fresh product titled from the parent (family) catalog.
      let productId: string;
      if (allExisting.length) {
        const oldest = allExisting.reduce((a, b) =>
          a.createdAt <= b.createdAt ? a : b
        );
        productId = oldest.productId;
        productsMatched += 1;
      } else {
        productId = createProductId();
        const parentItem = parentCatalog.get(familyKey);
        const firstChild = catalogByAsin.get(childAsins[0]);
        await upsertProduct({
          productId,
          userId,
          title:
            parentItem?.summaries?.[0]?.itemName ||
            firstChild?.summaries?.[0]?.itemName ||
            byAsin.get(childAsins[0])?.[0]?.productName ||
            `Amazon item ${familyKey}`,
          brandName:
            parentItem?.summaries?.[0]?.brand ||
            firstChild?.summaries?.[0]?.brand,
          status: 'active',
        });
        productsCreated += 1;
      }

      // One Variant per child ASIN (options from its variation attributes).
      for (const asin of childAsins) {
        const childItem = catalogByAsin.get(asin);
        const { snapshot, status } = buildSnapshot(childItem);
        const options = buildVariantOptions(
          childItem,
          variationThemeByAsin.get(asin)
        );
        const variantTitle =
          options.map((option) => option.value).join(' / ') || undefined;
        const existingForAsin = existingByAsin.get(asin) ?? [];
        // Reuse (and re-point) the ASIN's existing variant so its identity —
        // and any asset links — survive the merge; otherwise create one.
        const variantId = existingForAsin[0]?.variantId ?? createVariantId();
        await upsertVariant({
          variantId,
          productId,
          userId,
          isDefault: !multiVariant,
          options,
          identifiers: { asin },
          title: variantTitle,
        });

        // One listing per seller SKU (each FBA SKU has its own FNSKU).
        for (const item of byAsin.get(asin) ?? []) {
          const sku = item.sellerSku as string;
          const existing = existingForAsin.find(
            (listing) => listing.external?.sku === sku
          );
          await upsertListing({
            listingId: existing?.listingId ?? createListingId(),
            productId,
            variantId,
            userId,
            platform: 'amazon',
            marketplaceId,
            sellerProfileName: profileName,
            external: { asin, sku, fnsku: item.fnSku },
            status,
            snapshot,
            syncedAt: Date.now(),
            syncSource: 'inventory',
            createdAt: existing?.createdAt,
          });
          listingsUpserted += 1;
        }
      }

      // Merge cleanup: soft-delete duplicate products now emptied by re-pointing
      // their listings + variants onto the canonical product.
      const stale = new Set(allExisting.map((listing) => listing.productId));
      stale.delete(productId);
      for (const staleProductId of stale) {
        await deleteProduct({ userId, productId: staleProductId });
        productsMerged += 1;
      }
    } catch (error) {
      errors.push(
        `${familyKey}: ${
          error instanceof Error ? error.message : 'sync failed'
        }`
      );
    }
  }

  return {
    connected: true,
    profileName,
    marketplaceId,
    scanned: usableItems.length,
    productsCreated,
    productsMatched,
    productsMerged,
    listingsUpserted,
    truncated,
    errors,
  };
}

export type ProductResyncSummary = {
  connected: boolean;
  updated: number; // listings whose snapshot was refreshed
  asins: number; // distinct ASINs looked up
  errors: string[];
  message?: string;
};

/**
 * Refresh catalog snapshots for a SINGLE product's Amazon listings — no
 * inventory walk. Preserves listing identity + createdAt and never touches
 * user-owned Product fields. Backs the product detail "Refresh from Amazon"
 * action. An ASIN with no fresh catalog data keeps its existing snapshot.
 */
export async function resyncProductSnapshots(
  userId: string,
  productId: string
): Promise<ProductResyncSummary> {
  const listings = (await listListings({ userId, productId })).filter(
    (listing) => listing.platform === 'amazon' && listing.external?.asin
  );
  if (!listings.length) {
    return { connected: true, updated: 0, asins: 0, errors: [] };
  }

  const connection = await createUserSpApiClient(userId);
  if ('connected' in connection) {
    return {
      connected: false,
      updated: 0,
      asins: 0,
      errors: [],
      message: connection.message,
    };
  }

  const { client, marketplaceId, profileName } = connection;
  const errors: string[] = [];
  const asins = [
    ...new Set(listings.map((listing) => listing.external.asin as string)),
  ];
  const catalogByAsin = await fetchCatalogByAsin(
    client,
    marketplaceId,
    asins,
    errors
  );

  let updated = 0;
  for (const listing of listings) {
    const catalog = catalogByAsin.get(listing.external.asin as string);
    if (!catalog) continue; // no fresh data — keep the existing snapshot
    const { snapshot, status } = buildSnapshot(catalog);
    try {
      await upsertListing({
        ...listing,
        sellerProfileName: listing.sellerProfileName ?? profileName,
        marketplaceId: listing.marketplaceId ?? marketplaceId,
        status,
        snapshot,
        syncedAt: Date.now(),
        syncSource: listing.syncSource ?? 'inventory',
      });
      updated += 1;
    } catch (error) {
      errors.push(
        `${listing.external.sku ?? listing.external.asin}: ${
          error instanceof Error ? error.message : 'update failed'
        }`
      );
    }
  }

  return { connected: true, updated, asins: asins.length, errors };
}
