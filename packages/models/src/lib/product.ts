import { z } from 'zod';

/**
 * Platform-independent Product domain (redesign — Product spine).
 *
 * Model: Product (a family, platform-agnostic truth) → ProductVariant (the
 * sellable unit) → ProductListing (the variant's presence on ONE platform +
 * marketplace, carrying platform ids + a synced catalog snapshot). Assets attach
 * to a Brand / Product / Variant / Listing via AssetLink (many-to-many).
 *
 * Identity/upsert rules:
 *  - `productId` / `variantId` / `listingId` are server-generated and stable —
 *    they are the identity. Amazon/Shopify/manual products all use the same ids.
 *  - A single-SKU product always has exactly ONE variant with `isDefault: true`
 *    so downstream code is uniformly Product → [Variant] → [Listing].
 *  - Product core fields (title, description, brand, category, sourcing) are
 *    USER-OWNED. Amazon sync writes catalog data into `ProductListing.snapshot`
 *    and must NOT overwrite edited Product fields (except on first creation, or
 *    when the user explicitly requests "pull from Amazon").
 *  - A ProductListing is one seller offer on a marketplace. `external.sku` (the
 *    SELLER SKU you list/edit under) and `external.fnsku` (the FBA barcode Amazon
 *    assigns) are DISTINCT identifiers — store both, never conflate them. One ASIN
 *    can back MANY listings (multiple SKUs, hence multiple FNSKUs), all mapping to
 *    the same Variant and sharing the ASIN's catalog snapshot.
 *  - A Product is deduped across marketplaces via its Listings (one Product, many
 *    Listings), not by re-creating Products per marketplace.
 *
 * Couchbase: FTS over the text fields (title/description/brandName/bullets) and
 * a reserved `embedding` for vector search are intended; those indexes are
 * provisioned via the Search service (separate from the N1QL GSIs).
 */

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

export const DimensionsSchema = z.object({
  length: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  unit: z.enum(['in', 'cm']).optional(),
});
export type Dimensions = z.infer<typeof DimensionsSchema>;

export const WeightSchema = z.object({
  value: z.number().optional(),
  unit: z.enum(['lb', 'kg', 'oz', 'g']).optional(),
});
export type Weight = z.infer<typeof WeightSchema>;

export const ProductIdentifiersSchema = z.object({
  gtin: z.string().optional(),
  upc: z.string().optional(),
  ean: z.string().optional(),
  asin: z.string().optional(),
  mpn: z.string().optional(),
});
export type ProductIdentifiers = z.infer<typeof ProductIdentifiersSchema>;

// ---------------------------------------------------------------------------
// Product — platform-agnostic truth (user-owned)
// ---------------------------------------------------------------------------

export const ProductStatusSchema = z.enum(['active', 'archived', 'draft']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductSourcingSchema = z.object({
  supplier: z
    .object({
      name: z.string().optional(),
      alibabaUrl: z.string().optional(),
      contact: z.string().optional(),
    })
    .optional(),
  cogs: z
    .object({
      unitCost: z.number().optional(),
      currency: z.string().optional(),
      moq: z.number().optional(),
      leadTimeDays: z.number().optional(),
    })
    .optional(),
});
export type ProductSourcing = z.infer<typeof ProductSourcingSchema>;

export const ProductSchema = z.object({
  productId: z.string(),
  userId: z.string(),
  title: z.string(),
  brandId: z.string().optional(), // = brandGuideId (Brand == Brand Guide for now)
  brandName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(), // internal taxonomy, not Amazon productType
  status: ProductStatusSchema.default('active'),
  sourcing: ProductSourcingSchema.optional(), // reserved; filled in a later phase
  tags: z.array(z.string()).optional(),
  /** Reserved for Couchbase vector search over the product's searchable text. */
  embedding: z.array(z.number()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deleted: z.boolean().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

// ---------------------------------------------------------------------------
// ProductVariant — the sellable unit
// ---------------------------------------------------------------------------

export const ProductVariantSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  userId: z.string(),
  title: z.string().optional(), // e.g. "Blue / Large"
  isDefault: z.boolean().optional(),
  options: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .default([]), // e.g. [{name:'Color',value:'Blue'}]
  identifiers: ProductIdentifiersSchema.optional(),
  dimensions: DimensionsSchema.optional(),
  weight: WeightSchema.optional(),
  imageAssetIds: z.array(z.string()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deleted: z.boolean().optional(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

// ---------------------------------------------------------------------------
// ProductListing — presence on ONE platform + marketplace
// ---------------------------------------------------------------------------

export const PlatformSchema = z.enum(['amazon', 'shopify']);
export type Platform = z.infer<typeof PlatformSchema>;

export const ListingSnapshotSchema = z.object({
  title: z.string().optional(),
  brand: z.string().optional(),
  productType: z.string().optional(), // Amazon productType
  bulletPoints: z.array(z.string()).optional(),
  mainImage: z
    .object({
      url: z.string(),
      height: z.number().optional(),
      width: z.number().optional(),
    })
    .optional(),
  images: z
    .array(
      z.object({
        variant: z.string().optional(),
        url: z.string(),
        height: z.number().optional(),
        width: z.number().optional(),
      })
    )
    .optional(),
  salesRank: z
    .array(
      z.object({
        title: z.string().optional(),
        rank: z.number().optional(),
        classificationId: z.string().optional(),
      })
    )
    .optional(),
  price: z
    .object({
      amount: z.number().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  variationTheme: z.array(z.string()).optional(), // e.g. ['Color','Size']
});
export type ListingSnapshot = z.infer<typeof ListingSnapshotSchema>;

export const ProductListingSchema = z.object({
  listingId: z.string(),
  productId: z.string(),
  variantId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  marketplaceId: z.string().optional(), // Amazon marketplace; Shopify shop domain later
  sellerProfileName: z.string().optional(), // which AmazonCredentialProfile produced this
  external: z
    .object({
      asin: z.string().optional(), // shared catalog id (many listings per ASIN)
      sku: z.string().optional(), // SELLER SKU — the offer identity you list/edit under
      fnsku: z.string().optional(), // FBA barcode Amazon assigns — DISTINCT from sku
      parentAsin: z.string().optional(),
      itemClassification: z
        .enum(['BASE', 'VARIATION_PARENT', 'OTHER'])
        .optional(),
    })
    .default({}),
  status: z
    .enum(['active', 'inactive', 'incomplete', 'unknown'])
    .default('unknown'),
  /** Synced catalog data — a bounded projection, NOT the raw response. */
  snapshot: ListingSnapshotSchema.optional(),
  aplus: z
    .object({
      draftIds: z.array(z.string()).optional(),
      publishedContentReferenceKey: z.string().optional(),
    })
    .optional(),
  ppc: z.object({ campaignIds: z.array(z.string()).optional() }).optional(),
  syncedAt: z.number().optional(),
  syncSource: z.enum(['inventory', 'asin-paste', 'manual']).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deleted: z.boolean().optional(),
});
export type ProductListing = z.infer<typeof ProductListingSchema>;

// ---------------------------------------------------------------------------
// AssetLink — asset ↔ owner (many-to-many)
// ---------------------------------------------------------------------------

export const AssetOwnerTypeSchema = z.enum([
  'brand',
  'product',
  'variant',
  'listing',
]);
export type AssetOwnerType = z.infer<typeof AssetOwnerTypeSchema>;

export const AssetLinkSchema = z.object({
  linkId: z.string(),
  assetId: z.string(),
  ownerType: AssetOwnerTypeSchema,
  ownerId: z.string(),
  userId: z.string(),
  role: z.string().optional(), // 'primary' | 'gallery' | 'logo' | ...
  createdAt: z.number(),
});
export type AssetLink = z.infer<typeof AssetLinkSchema>;
