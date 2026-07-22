import {
  ProductSchema,
  ProductVariantSchema,
  ProductListingSchema,
} from './product';

describe('product domain schemas', () => {
  const now = 1_700_000_000_000;

  it('parses a minimal Product and defaults status to active', () => {
    const product = ProductSchema.parse({
      productId: 'product_1',
      userId: 'user_1',
      title: 'Kraft Ripple Cup',
      createdAt: now,
      updatedAt: now,
    });
    expect(product.status).toBe('active');
    expect(product.title).toBe('Kraft Ripple Cup');
  });

  it('defaults a variant options array', () => {
    const variant = ProductVariantSchema.parse({
      variantId: 'variant_1',
      productId: 'product_1',
      userId: 'user_1',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(variant.options).toEqual([]);
  });

  it('parses an Amazon listing with external ids and defaults', () => {
    const listing = ProductListingSchema.parse({
      listingId: 'listing_1',
      productId: 'product_1',
      variantId: 'variant_1',
      userId: 'user_1',
      platform: 'amazon',
      marketplaceId: 'ATVPDKIKX0DER',
      external: { asin: 'B0GJSDWRT3', sku: 'SKU-1' },
      createdAt: now,
      updatedAt: now,
    });
    expect(listing.platform).toBe('amazon');
    expect(listing.status).toBe('unknown');
    expect(listing.external.asin).toBe('B0GJSDWRT3');
  });
});
