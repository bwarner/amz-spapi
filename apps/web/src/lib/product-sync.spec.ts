import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sync seeds a product and never overwrites one ([ADR-0011](../../../../docs/adr/0011-the-product-is-canonical.md)).
 *
 * The product is the canonical, platform-neutral definition; Amazon is where it
 * was first observed, not what it means. So a resync may CREATE a product for a
 * family it has never seen, and must leave every field of an existing one
 * alone.
 *
 * Pinned rather than assumed because it holds today only as a side effect of
 * the merge logic — `upsertProduct` happens to sit in the branch where no
 * listing matched — and because the failure is silent. A refactor that hoists
 * that call, or "helpfully" refreshes the title, destroys authored content on a
 * schedule and surfaces as a seller asking where their edit went.
 */

const resolveAmazonConnection = vi.fn();
const spApiClientFor = vi.fn();

const upsertProduct = vi.fn();
const deleteProduct = vi.fn();
const upsertVariant = vi.fn();
const upsertListing = vi.fn();
const findListingBySku = vi.fn();
const listListings = vi.fn();

vi.mock('./amazon-connections', () => ({ resolveAmazonConnection }));
vi.mock('./amazon-clients', () => ({ spApiClientFor }));
vi.mock('./products', () => ({
  upsertProduct,
  deleteProduct,
  createProductId: () => 'prod_new',
}));
vi.mock('./product-variants', () => ({
  upsertVariant,
  createVariantId: () => 'var_new',
}));
vi.mock('./product-listings', () => ({
  upsertListing,
  findListingBySku,
  listListings,
  createListingId: () => 'lst_new',
}));

const { syncAmazonProducts } = await import('./product-sync');

const ASIN = 'B0NORDIC01';
const SKU = 'NMS-FB-350-GRY';

/**
 * The title Amazon reports, which is the parent family's and names one specific
 * colour. That it is wrong for this SKU is the point: it is exactly the value
 * that must not reach an existing product.
 */
const AMAZON_TITLE = '10oz Nordic Ceramic Coffee and Tea Mug (Beige)';

beforeEach(() => {
  vi.clearAllMocks();

  resolveAmazonConnection.mockResolvedValue({
    connected: true,
    connection: {
      profile: { marketplace_id: 'ATVPDKIKX0DER' },
      profileName: 'Test Seller',
    },
  });

  spApiClientFor.mockResolvedValue({
    getInventorySummaries: vi.fn().mockResolvedValue({
      inventorySummaries: [{ asin: ASIN, sellerSku: SKU, fnSku: 'X001ABC' }],
    }),
    searchCatalogItems: vi.fn().mockResolvedValue({
      items: [
        {
          asin: ASIN,
          summaries: [{ itemName: AMAZON_TITLE, brand: 'Generic' }],
        },
      ],
    }),
  });
});

/** A listing already on file for this SKU — i.e. the family is not new. */
function existingListing() {
  return {
    listingId: 'lst_existing',
    productId: 'prod_existing',
    variantId: 'var_existing',
    userId: 'auth0|seller',
    platform: 'amazon',
    marketplaceId: 'ATVPDKIKX0DER',
    external: { asin: ASIN, sku: SKU, fnsku: 'X001ABC' },
    status: 'active',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

describe('syncAmazonProducts', () => {
  it('creates a product for a family it has not seen before', async () => {
    findListingBySku.mockResolvedValue(null);

    const summary = await syncAmazonProducts('auth0|seller');

    expect(summary.productsCreated).toBe(1);
    expect(upsertProduct).toHaveBeenCalledTimes(1);
    // Seeded from Amazon, which is allowed exactly once — at birth.
    expect(upsertProduct).toHaveBeenCalledWith(
      expect.objectContaining({ title: AMAZON_TITLE })
    );
  });

  it('never writes to a product that already exists', async () => {
    findListingBySku.mockResolvedValue(existingListing());

    const summary = await syncAmazonProducts('auth0|seller');

    expect(summary.productsMatched).toBe(1);
    expect(summary.productsCreated).toBe(0);
    // The whole ADR in one assertion.
    expect(upsertProduct).not.toHaveBeenCalled();
  });

  it('still refreshes the listing when it leaves the product alone', async () => {
    findListingBySku.mockResolvedValue(existingListing());

    await syncAmazonProducts('auth0|seller');

    // Observed marketplace state belongs on the listing and is expected to move
    // on every sync. "Do not touch the product" must not become "do nothing" —
    // that is how a passing test hides a sync that stopped working.
    expect(upsertListing).toHaveBeenCalledTimes(1);
    expect(upsertListing).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod_existing',
        external: expect.objectContaining({ sku: SKU }),
      })
    );
  });

  it('reuses the existing product id rather than minting one', async () => {
    findListingBySku.mockResolvedValue(existingListing());

    await syncAmazonProducts('auth0|seller');

    // A new id here would orphan the authored definition just as effectively as
    // overwriting it, and would not show up as a write to the old document.
    expect(upsertVariant).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'prod_existing' })
    );
  });
});
