import crypto from 'node:crypto';
import {
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  ProductListingSchema,
  type ProductListing,
} from '@farvisionllc/models';

const SCOPE = 'catalog';
const COLLECTION = 'listings';

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

export function createListingId(): string {
  return `listing_${crypto.randomUUID()}`;
}

function listingDocKey(userId: string, listingId: string): string {
  return `listing::${safeUserPart(userId)}::${listingId}`;
}

/** Listings of a product (optionally scoped to a variant or platform). */
export async function listListings(params: {
  userId: string;
  productId: string;
  variantId?: string;
  platform?: string;
}): Promise<ProductListing[]> {
  const clauses = [
    'l.userId = $userId',
    'l.productId = $productId',
    'l.`deleted` IS MISSING',
  ];
  const parameters: Record<string, unknown> = {
    userId: params.userId,
    productId: params.productId,
  };
  if (params.variantId) {
    clauses.push('l.variantId = $variantId');
    parameters['variantId'] = params.variantId;
  }
  if (params.platform) {
    clauses.push('l.platform = $platform');
    parameters['platform'] = params.platform;
  }
  const result = await executeQuery<ProductListing>(
    SCOPE,
    `SELECT RAW l FROM \`${COLLECTION}\` l WHERE ${clauses.join(' AND ')}`,
    { parameters }
  );
  return result.rows;
}

export async function getListing(params: {
  userId: string;
  listingId: string;
}): Promise<ProductListing | null> {
  const doc = await getDocument<ProductListing>(
    SCOPE,
    COLLECTION,
    listingDocKey(params.userId, params.listingId)
  );
  if (!doc || doc.deleted || doc.userId !== params.userId) return null;
  return doc;
}

/**
 * Find an existing Amazon listing by seller SKU — the IDENTITY used for
 * idempotent sync. A listing is one seller SKU (offer) on a marketplace; each
 * FBA SKU has its own FNSKU. NOTE: one ASIN can back MANY listings (one per
 * SKU/FNSKU), so dedup by SKU, never by ASIN.
 */
export async function findListingBySku(params: {
  userId: string;
  marketplaceId: string;
  sku: string;
}): Promise<ProductListing | null> {
  const result = await executeQuery<ProductListing>(
    SCOPE,
    `SELECT RAW l FROM \`${COLLECTION}\` l
     WHERE l.userId = $userId AND l.platform = 'amazon'
       AND l.marketplaceId = $marketplaceId AND l.external.sku = $sku
       AND l.\`deleted\` IS MISSING
     LIMIT 1`,
    { parameters: params }
  );
  return result.rows[0] ?? null;
}

/** All listings that share one ASIN (multiple SKUs/FNSKUs map to a single ASIN). */
export async function listListingsByAsin(params: {
  userId: string;
  marketplaceId: string;
  asin: string;
}): Promise<ProductListing[]> {
  const result = await executeQuery<ProductListing>(
    SCOPE,
    `SELECT RAW l FROM \`${COLLECTION}\` l
     WHERE l.userId = $userId AND l.platform = 'amazon'
       AND l.marketplaceId = $marketplaceId AND l.external.asin = $asin
       AND l.\`deleted\` IS MISSING`,
    { parameters: params }
  );
  return result.rows;
}

/** First Amazon catalog image per variant, keyed by variantId — for list thumbnails. */
export async function listVariantThumbnails(
  userId: string
): Promise<Record<string, string>> {
  const result = await executeQuery<{ variantId: string; url: string }>(
    SCOPE,
    `SELECT l.variantId, l.snapshot.mainImage.url AS url
     FROM \`${COLLECTION}\` l
     WHERE l.userId = $userId AND l.platform = 'amazon'
       AND l.snapshot.mainImage.url IS NOT MISSING
       AND l.\`deleted\` IS MISSING`,
    { parameters: { userId } }
  );
  const byVariant: Record<string, string> = {};
  for (const row of result.rows) {
    if (row.variantId && row.url && !byVariant[row.variantId]) {
      byVariant[row.variantId] = row.url;
    }
  }
  return byVariant;
}

export async function upsertListing(
  listing: Omit<ProductListing, 'createdAt' | 'updatedAt'> &
    Partial<Pick<ProductListing, 'createdAt' | 'updatedAt'>>
): Promise<ProductListing> {
  const now = Date.now();
  const document = ProductListingSchema.parse({
    ...listing,
    createdAt: listing.createdAt ?? now,
    updatedAt: now,
  });
  await upsertDocument(
    SCOPE,
    COLLECTION,
    listingDocKey(document.userId, document.listingId),
    document
  );
  return document;
}

export async function deleteListing(params: {
  userId: string;
  listingId: string;
}): Promise<boolean> {
  const existing = await getListing(params);
  if (!existing) return false;
  await upsertDocument(
    SCOPE,
    COLLECTION,
    listingDocKey(params.userId, params.listingId),
    { ...existing, deleted: true, updatedAt: Date.now() }
  );
  return true;
}
