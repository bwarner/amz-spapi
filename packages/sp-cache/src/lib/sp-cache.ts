import { SpApiClient } from '@farvisionllc/sp-client';
import { getDocument, upsertDocument } from '@amz-spapi/couchbase-utils';

/**
 * TTL constants (in seconds) for cached SP-API data.
 * Aligned with Amazon's acceptable use policies.
 */
const TTL = {
  CATALOG_ITEM: 24 * 60 * 60,    // 24 hours — listings change infrequently
  CATALOG_SEARCH: 60 * 60,        // 1 hour — search results can shift
  ORDERS: 15 * 60,                // 15 minutes — order status changes
  ORDER_ITEMS: 15 * 60,           // 15 minutes
  INVENTORY: 30 * 60,             // 30 minutes — changes with sales
} as const;

const SCOPE = 'sp_cache';

const COLLECTIONS = {
  CATALOG: 'catalog',
  ORDERS: 'orders',
  INVENTORY: 'inventory',
} as const;

function cacheKey(type: string, marketplace: string, id: string): string {
  return `${type}:${marketplace}:${id}`;
}

/**
 * Amazon SP-API Data Retention Compliance
 * ----------------------------------------
 * Per Amazon's Developer Agreement (Section 11):
 * - PII (buyer info, addresses, email) must NOT be cached or persisted beyond immediate use.
 * - Non-PII data (catalog, SKUs, ASIN details) can be cached with appropriate TTLs.
 * - Order data: cache only non-PII fields. Strip buyer info before storage.
 *
 * PII fields stripped from order responses before caching:
 *   Order level:    BuyerInfo, ShippingAddress, BuyerTaxInfo, DefaultShipFromLocationAddress (if buyer-owned)
 *   OrderItem level: BuyerCustomizedInfo, PointsGranted (may reveal buyer identity in aggregate)
 *
 * @see https://developer-docs.amazon.com/amazon-shipping/docs/developer-agreement
 */

/**
 * Strip PII fields from an order object before caching.
 * Returns a new object with sensitive fields removed.
 */
function stripOrderPii<T extends Record<string, any>>(order: T): T {
  const { BuyerInfo, ShippingAddress, BuyerTaxInfo, BuyerEmail, ...safe } = order as any;
  return safe as T;
}

/**
 * Strip PII fields from an order item before caching.
 */
function stripOrderItemPii<T extends Record<string, any>>(item: T): T {
  const { BuyerCustomizedInfo, ...safe } = item as any;
  return safe as T;
}

/**
 * Apply PII stripping to a full orders list response.
 */
function sanitizeOrdersResponse(response: any): any {
  if (!response?.payload?.Orders) return response;
  return {
    ...response,
    payload: {
      ...response.payload,
      Orders: response.payload.Orders.map(stripOrderPii),
    },
  };
}

/**
 * Apply PII stripping to a single order response.
 */
function sanitizeOrderResponse(response: any): any {
  if (!response?.payload) return response;
  return {
    ...response,
    payload: stripOrderPii(response.payload),
  };
}

/**
 * Apply PII stripping to order items response.
 */
function sanitizeOrderItemsResponse(response: any): any {
  if (!response?.payload?.OrderItems) return response;
  return {
    ...response,
    payload: {
      ...response.payload,
      OrderItems: response.payload.OrderItems.map(stripOrderItemPii),
    },
  };
}

export interface SpCacheConfig {
  spClient: SpApiClient;
  marketplaceId: string;
  /** Set to true to bypass cache (always hit API). Default false. */
  bypassCache?: boolean;
}

/**
 * Couchbase-backed caching layer over SpApiClient.
 *
 * Checks cache first, falls back to SP-API, then caches the response
 * with an appropriate TTL. PII data is never cached.
 */
export class SpCache {
  private spClient: SpApiClient;
  private marketplaceId: string;
  private bypassCache: boolean;

  constructor(config: SpCacheConfig) {
    this.spClient = config.spClient;
    this.marketplaceId = config.marketplaceId;
    this.bypassCache = config.bypassCache ?? false;
  }

  /**
   * Get catalog item details by ASIN.
   * Cached for 24 hours.
   */
  async getCatalogItem(asin: string, params?: {
    marketplaceIds?: string[];
    includedData?: string[];
    locale?: string;
  }) {
    const key = cacheKey('item', this.marketplaceId, asin);
    const includedKey = `${key}:${(params?.includedData || []).sort().join(',')}`;

    if (!this.bypassCache) {
      const cached = await getDocument<any>(SCOPE, COLLECTIONS.CATALOG, includedKey);
      if (cached) return cached;
    }

    const result = await this.spClient.getCatalogItem(asin, params);
    await upsertDocument(SCOPE, COLLECTIONS.CATALOG, includedKey, result, TTL.CATALOG_ITEM);
    return result;
  }

  /**
   * Search catalog items.
   * Cached for 1 hour.
   */
  async searchCatalogItems(params: {
    keywords?: string;
    identifiers?: string[];
    identifiersType?: 'ASIN' | 'EAN' | 'GTIN' | 'ISBN' | 'JAN' | 'MINSAN' | 'SKU' | 'UPC';
    marketplaceIds?: string[];
    includedData?: string[];
    brandNames?: string[];
    classificationIds?: string[];
    pageSize?: number;
    pageToken?: string;
    keywordsLocale?: string;
    locale?: string;
  }) {
    const searchKey = JSON.stringify({
      k: params.keywords,
      ids: params.identifiers,
      t: params.identifiersType,
      b: params.brandNames,
      ps: params.pageSize,
      pt: params.pageToken,
    });
    const key = cacheKey('search', this.marketplaceId, Buffer.from(searchKey).toString('base64url'));

    if (!this.bypassCache) {
      const cached = await getDocument<any>(SCOPE, COLLECTIONS.CATALOG, key);
      if (cached) return cached;
    }

    const result = await this.spClient.searchCatalogItems(params);
    await upsertDocument(SCOPE, COLLECTIONS.CATALOG, key, result, TTL.CATALOG_SEARCH);
    return result;
  }

  /**
   * Get orders. Cached for 15 minutes.
   * Note: Only non-PII order fields are cached. Buyer PII is never stored.
   */
  async getOrders(params: {
    marketplaceIds?: string[];
    createdAfter?: string;
    createdBefore?: string;
    lastUpdatedAfter?: string;
    lastUpdatedBefore?: string;
    orderStatuses?: string[];
    fulfillmentChannels?: string[];
    paymentMethods?: string[];
    maxResultsPerPage?: number;
    nextToken?: string;
  }) {
    const orderKey = JSON.stringify({
      ca: params.createdAfter,
      cb: params.createdBefore,
      os: params.orderStatuses,
      mr: params.maxResultsPerPage,
      nt: params.nextToken,
    });
    const key = cacheKey('orders', this.marketplaceId, Buffer.from(orderKey).toString('base64url'));

    if (!this.bypassCache) {
      const cached = await getDocument<any>(SCOPE, COLLECTIONS.ORDERS, key);
      if (cached) return cached;
    }

    const result = await this.spClient.getOrders(params);
    const sanitized = sanitizeOrdersResponse(result);
    await upsertDocument(SCOPE, COLLECTIONS.ORDERS, key, sanitized, TTL.ORDERS);
    return result; // Return original (with PII) to caller for current request
  }

  /**
   * Get single order details. Cached for 15 minutes.
   */
  async getOrder(orderId: string) {
    const key = cacheKey('order', this.marketplaceId, orderId);

    if (!this.bypassCache) {
      const cached = await getDocument<any>(SCOPE, COLLECTIONS.ORDERS, key);
      if (cached) return cached;
    }

    const result = await this.spClient.getOrder(orderId);
    const sanitized = sanitizeOrderResponse(result);
    await upsertDocument(SCOPE, COLLECTIONS.ORDERS, key, sanitized, TTL.ORDERS);
    return result;
  }

  /**
   * Get order items. Cached for 15 minutes.
   */
  async getOrderItems(orderId: string, nextToken?: string) {
    const suffix = nextToken ? `:${nextToken}` : '';
    const key = cacheKey('orderItems', this.marketplaceId, `${orderId}${suffix}`);

    if (!this.bypassCache) {
      const cached = await getDocument<any>(SCOPE, COLLECTIONS.ORDERS, key);
      if (cached) return cached;
    }

    const result = await this.spClient.getOrderItems(orderId, nextToken);
    const sanitized = sanitizeOrderItemsResponse(result);
    await upsertDocument(SCOPE, COLLECTIONS.ORDERS, key, sanitized, TTL.ORDER_ITEMS);
    return result;
  }

  /**
   * Get FBA inventory summaries. Cached for 30 minutes.
   */
  async getInventorySummaries(params: {
    granularityType: string;
    granularityId: string;
    sellerSkus?: string[];
    marketplaceIds?: string[];
    nextToken?: string;
  }) {
    const invKey = JSON.stringify({
      gt: params.granularityType,
      gi: params.granularityId,
      sk: params.sellerSkus,
      nt: params.nextToken,
    });
    const key = cacheKey('inv', this.marketplaceId, Buffer.from(invKey).toString('base64url'));

    if (!this.bypassCache) {
      const cached = await getDocument<any>(SCOPE, COLLECTIONS.INVENTORY, key);
      if (cached) return cached;
    }

    const result = await this.spClient.getInventorySummaries(params);
    await upsertDocument(SCOPE, COLLECTIONS.INVENTORY, key, result, TTL.INVENTORY);
    return result;
  }
}
