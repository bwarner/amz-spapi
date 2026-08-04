import { gunzipSync } from 'node:zlib';
import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import type { paths as CatalogPaths } from '@amz-spapi/amazon-sp-generated/lib/catalogItems_2022-04-01';
import type { paths as OrdersPaths } from '@amz-spapi/amazon-sp-generated/lib/ordersV0';
import type { paths as ListingsPaths } from '@amz-spapi/amazon-sp-generated/lib/listingsItems_2021-08-01';
import type { paths as FinancesPaths } from '@amz-spapi/amazon-sp-generated/lib/financesV0';
import type { paths as InboundPaths } from '@amz-spapi/amazon-sp-generated/lib/fulfillmentInboundV0';

export interface SpApiClientConfig {
  clientId: string; // LWA Client ID
  clientSecret?: string; // For token refresh
  accessToken?: string; // LWA access token
  refreshToken?: string; // For automatic token refresh
  sellerId?: string; // Seller/Merchant ID
  marketplaceId: string; // e.g., 'ATVPDKIKX0DER' for US
  region?: 'NA' | 'EU' | 'FE'; // Defaults to NA
  onTokenRefresh?: (accessToken: string, expiresIn: number) => Promise<void>;
}

interface LwaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: 'bearer';
  expires_in: number;
}

// Type helpers for API responses
type CatalogItemResponse =
  CatalogPaths['/catalog/2022-04-01/items/{asin}']['get']['responses']['200']['content']['application/json'];
type CatalogSearchResponse =
  CatalogPaths['/catalog/2022-04-01/items']['get']['responses']['200']['content']['application/json'];

type OrdersListResponse =
  OrdersPaths['/orders/v0/orders']['get']['responses']['200']['content']['application/json'];
type OrderResponse =
  OrdersPaths['/orders/v0/orders/{orderId}']['get']['responses']['200']['content']['application/json'];
type OrderItemsResponse =
  OrdersPaths['/orders/v0/orders/{orderId}/orderItems']['get']['responses']['200']['content']['application/json'];

type ListingsItemResponse =
  ListingsPaths['/listings/2021-08-01/items/{sellerId}/{sku}']['get']['responses']['200']['content']['application/json'];
type ListingsSearchResponse =
  ListingsPaths['/listings/2021-08-01/items/{sellerId}']['get']['responses']['200']['content']['application/json'];
type ListingsPatchResponse =
  ListingsPaths['/listings/2021-08-01/items/{sellerId}/{sku}']['patch']['responses']['200']['content']['application/json'];

export type ListingsPatchOperation = {
  op: 'add' | 'replace' | 'merge' | 'delete';
  path: string;
  value?: Array<Record<string, unknown>>;
};

type FinancialEventGroupsResponse =
  FinancesPaths['/finances/v0/financialEventGroups']['get']['responses']['200']['content']['application/json'];
type FinancialEventsResponse =
  FinancesPaths['/finances/v0/financialEvents']['get']['responses']['200']['content']['application/json'];
type OrderFinancialEventsResponse =
  FinancesPaths['/finances/v0/orders/{orderId}/financialEvents']['get']['responses']['200']['content']['application/json'];

type InboundShipmentsResponse =
  InboundPaths['/fba/inbound/v0/shipments']['get']['responses']['200']['content']['application/json'];
type InboundShipmentItemsResponse =
  InboundPaths['/fba/inbound/v0/shipments/{shipmentId}/items']['get']['responses']['200']['content']['application/json'];

export type InboundShipmentStatus =
  | 'WORKING'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'RECEIVING'
  | 'CANCELLED'
  | 'DELETED'
  | 'CLOSED'
  | 'ERROR'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CHECKED_IN';

export type ListingsIncludedData =
  | 'summaries'
  | 'attributes'
  | 'issues'
  | 'offers'
  | 'fulfillmentAvailability'
  | 'procurement'
  | 'relationships'
  | 'productTypes';

export interface APlusContentDocumentRequest {
  contentDocument: Record<string, unknown>;
}

export interface APlusAsinRelationsRequest {
  asinSet: string[];
}

export interface APlusValidateRequest extends APlusContentDocumentRequest {
  asinSet: string[];
}

export interface UploadDestinationRequest {
  contentMD5?: string;
  contentType?: string;
}

/**
 * Rewrite an SP-API failure's `message` to carry the status, Amazon's error code
 * and the path. Mutates rather than wraps so callers reading `error.response`
 * keep working.
 */
function describeSpApiError(error: AxiosError): void {
  const status = error.response?.status;
  if (!status) return;

  const body = error.response?.data as
    | { errors?: Array<{ code?: string; message?: string; details?: string }> }
    | undefined;
  const first = body?.errors?.[0];
  const path = error.config?.url ?? 'unknown path';

  const parts = [`SP-API ${status}`];
  if (first?.code) parts.push(first.code);
  const detail = first?.message ?? first?.details;
  const hint =
    status === 403 && !detail
      ? 'Access denied for this operation. If other SP-API calls are working, ' +
        'the application is missing the role for THIS API rather than being ' +
        'unauthenticated — check the roles on the SP-API app, then re-authorize.'
      : undefined;

  error.message = [parts.join(' '), detail ?? hint, `(${path})`]
    .filter(Boolean)
    .join(' — ');
}

/**
 * Report polling budgets, named rather than scattered.
 *
 * These exist because a timeout is only meaningful relative to the caller's own
 * budget, and that relationship was invisible when both were bare numbers in
 * different files. The chat route allows 300s for an ENTIRE turn — model
 * reasoning, every tool call, and streaming — so a report tool cannot have all
 * of it, or even most.
 *
 * `requestSafe` is what a route should ever wait. `worker` is for a background
 * job with no one on the other end, and is deliberately not the default: a
 * default longer than any caller's budget can only be reached by a request that
 * is already doomed.
 */
export const REPORT_TIMEOUT_MS = {
  /** Fits inside the smallest route that polls a report, with room to spare. */
  requestSafe: 90_000,
  /** Background only — see ADR-0009. Blocking is the point there. */
  worker: 10 * 60_000,
} as const;

export class SpApiClient {
  private httpClient: AxiosInstance;
  private config: SpApiClientConfig;
  private BASE_URL: string;
  private LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
  private isRefreshing = false;
  private refreshPromise: Promise<string> | null = null;

  constructor(config: SpApiClientConfig) {
    this.config = { region: 'NA', ...config };

    // Set region-specific URLs
    this.BASE_URL = this.getRegionEndpoint(this.config.region!);
    this.LWA_TOKEN_URL = this.getLwaEndpoint(this.config.region!);

    this.httpClient = axios.create({
      baseURL: this.BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor: inject access token (and refresh if missing)
    this.httpClient.interceptors.request.use(async (config) => {
      // If no access token, try to get one via refresh
      if (
        !this.config.accessToken &&
        this.config.refreshToken &&
        this.config.clientSecret
      ) {
        await this.refreshAccessToken();
      }

      if (this.config.accessToken) {
        config.headers.Authorization = `Bearer ${this.config.accessToken}`;
        // Add x-amz-access-token header (required for SP-API)
        config.headers['x-amz-access-token'] = this.config.accessToken;
      }
      return config;
    });

    // Response interceptor: auto token refresh on 401, retry with backoff on 429
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
          _retryCount?: number;
        };

        // 401/403: refresh token and retry once
        if (
          (error.response?.status === 401 || error.response?.status === 403) &&
          !originalRequest._retry &&
          this.config.refreshToken &&
          this.config.clientSecret
        ) {
          originalRequest._retry = true;
          try {
            const newAccessToken = await this.refreshAccessToken();
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
              originalRequest.headers['x-amz-access-token'] = newAccessToken;
            }
            return this.httpClient(originalRequest);
          } catch {
            return Promise.reject(error);
          }
        }

        // 429: retry with exponential backoff (max 3 attempts)
        if (error.response?.status === 429) {
          const retryCount = originalRequest._retryCount ?? 0;
          const maxRetries = 3;

          if (retryCount < maxRetries) {
            originalRequest._retryCount = retryCount + 1;

            // Respect Retry-After header if present, else use exponential backoff
            const retryAfterHeader = error.response.headers?.['retry-after'];
            const retryAfterMs = retryAfterHeader
              ? parseFloat(retryAfterHeader) * 1000
              : Math.min(1000 * Math.pow(2, retryCount), 30_000); // 1s, 2s, 4s, max 30s

            console.warn(
              `[SpApiClient] Rate limited (429). Retry ${
                retryCount + 1
              }/${maxRetries} in ${retryAfterMs}ms. Path: ${
                originalRequest.url
              }`
            );

            await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
            return this.httpClient(originalRequest);
          }
        }

        // Enrich the message with Amazon's own error code before rejecting.
        // Axios alone says "Request failed with status code 403", which reads as
        // "not authenticated" and sends callers off re-linking accounts — when a
        // 403 on ONE operation while others succeed means the application lacks
        // that API's role. The response body says which; pass it on.
        describeSpApiError(error);
        return Promise.reject(error);
      }
    );
  }

  private getRegionEndpoint(region: string): string {
    const endpoints: Record<string, string> = {
      NA: 'https://sellingpartnerapi-na.amazon.com',
      EU: 'https://sellingpartnerapi-eu.amazon.com',
      FE: 'https://sellingpartnerapi-fe.amazon.com',
    };
    return endpoints[region] || endpoints.NA;
  }

  private getLwaEndpoint(region: string): string {
    const endpoints: Record<string, string> = {
      NA: 'https://api.amazon.com/auth/o2/token',
      EU: 'https://api.amazon.co.uk/auth/o2/token',
      FE: 'https://api.amazon.co.jp/auth/o2/token',
    };
    return endpoints[region] || endpoints.NA;
  }

  /**
   * Refresh the LWA access token using refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    // Prevent concurrent refresh requests
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const response = await axios.post<LwaTokenResponse>(
          this.LWA_TOKEN_URL,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.config.refreshToken!,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret!,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );

        const { access_token, expires_in } = response.data;

        // Update config
        this.config.accessToken = access_token;

        // Notify callback
        if (this.config.onTokenRefresh) {
          await this.config.onTokenRefresh(access_token, expires_in);
        }

        return access_token;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // ========================================
  // Catalog Items API (2022-04-01)
  // ========================================

  /**
   * Get catalog item details by ASIN
   * GET /catalog/2022-04-01/items/{asin}
   */
  async getCatalogItem(
    asin: string,
    params?: {
      marketplaceIds?: string[];
      includedData?: string[];
      locale?: string;
    }
  ): Promise<CatalogItemResponse> {
    const marketplaceIds = params?.marketplaceIds || [
      this.config.marketplaceId,
    ];

    const response = await this.httpClient.get<CatalogItemResponse>(
      `/catalog/2022-04-01/items/${asin}`,
      {
        params: {
          marketplaceIds: marketplaceIds.join(','),
          includedData: params?.includedData?.join(','),
          locale: params?.locale,
        },
      }
    );

    return response.data;
  }

  /**
   * Search catalog items
   * GET /catalog/2022-04-01/items
   */
  async searchCatalogItems(params: {
    keywords?: string;
    identifiers?: string[];
    identifiersType?:
      | 'ASIN'
      | 'EAN'
      | 'GTIN'
      | 'ISBN'
      | 'JAN'
      | 'MINSAN'
      | 'SKU'
      | 'UPC';
    marketplaceIds?: string[];
    includedData?: string[];
    brandNames?: string[];
    classificationIds?: string[];
    pageSize?: number;
    pageToken?: string;
    keywordsLocale?: string;
    locale?: string;
  }): Promise<CatalogSearchResponse> {
    const marketplaceIds = params.marketplaceIds || [this.config.marketplaceId];

    const response = await this.httpClient.get<CatalogSearchResponse>(
      '/catalog/2022-04-01/items',
      {
        params: {
          keywords: params.keywords,
          identifiers: params.identifiers?.join(','),
          identifiersType: params.identifiersType,
          marketplaceIds: marketplaceIds.join(','),
          includedData: params.includedData?.join(','),
          brandNames: params.brandNames?.join(','),
          classificationIds: params.classificationIds?.join(','),
          pageSize: params.pageSize,
          pageToken: params.pageToken,
          keywordsLocale: params.keywordsLocale,
          locale: params.locale,
        },
      }
    );

    return response.data;
  }

  // ========================================
  // Listings Items API (2021-08-01)
  // ========================================

  private requireSellerId(sellerId?: string): string {
    const resolved = sellerId ?? this.config.sellerId;
    if (!resolved) {
      throw new Error(
        'Listings Items API requires a sellerId (merchant token). ' +
          'Pass it explicitly or set SpApiClientConfig.sellerId.'
      );
    }
    return resolved;
  }

  /**
   * Get the seller's own listing for a SKU (submitted attributes + Amazon
   * issues — distinct from the public catalog view).
   * GET /listings/2021-08-01/items/{sellerId}/{sku}
   */
  async getListingsItem(params: {
    sku: string;
    sellerId?: string;
    marketplaceIds?: string[];
    includedData?: ListingsIncludedData[];
    issueLocale?: string;
  }): Promise<ListingsItemResponse> {
    const sellerId = this.requireSellerId(params.sellerId);
    const marketplaceIds = params.marketplaceIds || [this.config.marketplaceId];

    const response = await this.httpClient.get<ListingsItemResponse>(
      `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(
        params.sku
      )}`,
      {
        params: {
          marketplaceIds: marketplaceIds.join(','),
          includedData: params.includedData?.join(','),
          issueLocale: params.issueLocale,
        },
      }
    );

    return response.data;
  }

  /**
   * Search the seller's own listings by identifier (SKU/ASIN/…) or date
   * filters. Paginated.
   * GET /listings/2021-08-01/items/{sellerId}
   */
  async searchListingsItems(params: {
    sellerId?: string;
    marketplaceIds?: string[];
    identifiers?: string[];
    identifiersType?:
      | 'ASIN'
      | 'EAN'
      | 'FNSKU'
      | 'GTIN'
      | 'ISBN'
      | 'JAN'
      | 'MINSAN'
      | 'SKU'
      | 'UPC';
    variationParentSku?: string;
    packageHierarchySku?: string;
    createdAfter?: string;
    createdBefore?: string;
    lastUpdatedAfter?: string;
    lastUpdatedBefore?: string;
    withIssueSeverity?: ('WARNING' | 'ERROR')[];
    withStatus?: ('BUYABLE' | 'DISCOVERABLE')[];
    withoutStatus?: ('BUYABLE' | 'DISCOVERABLE')[];
    includedData?: ListingsIncludedData[];
    issueLocale?: string;
    sortBy?: 'sku' | 'createdDate' | 'lastUpdatedDate';
    sortOrder?: 'ASC' | 'DESC';
    pageSize?: number;
    pageToken?: string;
  }): Promise<ListingsSearchResponse> {
    const sellerId = this.requireSellerId(params.sellerId);
    const marketplaceIds = params.marketplaceIds || [this.config.marketplaceId];

    const response = await this.httpClient.get<ListingsSearchResponse>(
      `/listings/2021-08-01/items/${sellerId}`,
      {
        params: {
          marketplaceIds: marketplaceIds.join(','),
          identifiers: params.identifiers?.join(','),
          identifiersType: params.identifiersType,
          variationParentSku: params.variationParentSku,
          packageHierarchySku: params.packageHierarchySku,
          createdAfter: params.createdAfter,
          createdBefore: params.createdBefore,
          lastUpdatedAfter: params.lastUpdatedAfter,
          lastUpdatedBefore: params.lastUpdatedBefore,
          withIssueSeverity: params.withIssueSeverity?.join(','),
          withStatus: params.withStatus?.join(','),
          withoutStatus: params.withoutStatus?.join(','),
          includedData: params.includedData?.join(','),
          issueLocale: params.issueLocale,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          pageSize: params.pageSize,
          pageToken: params.pageToken,
        },
      }
    );

    return response.data;
  }

  /**
   * Patch the seller's own listing (JSON Patch on attributes). Pass
   * mode 'VALIDATION_PREVIEW' for Amazon's dry run — the full patch is
   * validated with ZERO effect on the live listing.
   * PATCH /listings/2021-08-01/items/{sellerId}/{sku}
   */
  async patchListingsItem(params: {
    sku: string;
    productType: string;
    patches: ListingsPatchOperation[];
    sellerId?: string;
    marketplaceIds?: string[];
    mode?: 'VALIDATION_PREVIEW';
    issueLocale?: string;
  }): Promise<ListingsPatchResponse> {
    const sellerId = this.requireSellerId(params.sellerId);
    const marketplaceIds = params.marketplaceIds || [this.config.marketplaceId];

    const response = await this.httpClient.patch<ListingsPatchResponse>(
      `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(
        params.sku
      )}`,
      {
        productType: params.productType,
        patches: params.patches,
      },
      {
        params: {
          marketplaceIds: marketplaceIds.join(','),
          mode: params.mode,
          issueLocale: params.issueLocale,
        },
      }
    );

    return response.data;
  }

  // ========================================
  // Finances API (v0)
  // ========================================

  /**
   * List settlement groups (payout periods with totals and status).
   * GET /finances/v0/financialEventGroups
   */
  async listFinancialEventGroups(params?: {
    startedAfter?: string;
    startedBefore?: string;
    maxResultsPerPage?: number;
    nextToken?: string;
  }): Promise<FinancialEventGroupsResponse> {
    const response = await this.httpClient.get<FinancialEventGroupsResponse>(
      '/finances/v0/financialEventGroups',
      {
        params: {
          FinancialEventGroupStartedAfter: params?.startedAfter,
          FinancialEventGroupStartedBefore: params?.startedBefore,
          MaxResultsPerPage: params?.maxResultsPerPage,
          NextToken: params?.nextToken,
        },
      }
    );
    return response.data;
  }

  /**
   * List financial events (fees, refunds, charges) by posted-date window.
   * GET /finances/v0/financialEvents
   */
  async listFinancialEvents(params?: {
    postedAfter?: string;
    postedBefore?: string;
    maxResultsPerPage?: number;
    nextToken?: string;
  }): Promise<FinancialEventsResponse> {
    const response = await this.httpClient.get<FinancialEventsResponse>(
      '/finances/v0/financialEvents',
      {
        params: {
          PostedAfter: params?.postedAfter,
          PostedBefore: params?.postedBefore,
          MaxResultsPerPage: params?.maxResultsPerPage,
          NextToken: params?.nextToken,
        },
      }
    );
    return response.data;
  }

  /**
   * Financial events for one order (fees/charges/promotions on that order).
   * GET /finances/v0/orders/{orderId}/financialEvents
   */
  async listOrderFinancialEvents(
    orderId: string
  ): Promise<OrderFinancialEventsResponse> {
    const response = await this.httpClient.get<OrderFinancialEventsResponse>(
      `/finances/v0/orders/${encodeURIComponent(orderId)}/financialEvents`
    );
    return response.data;
  }

  // ========================================
  // Fulfillment Inbound API (v0)
  // ========================================

  /**
   * List inbound (FBA) shipments by status/ids or date range.
   * GET /fba/inbound/v0/shipments
   */
  async getInboundShipments(params: {
    shipmentStatusList?: InboundShipmentStatus[];
    shipmentIdList?: string[];
    lastUpdatedAfter?: string;
    lastUpdatedBefore?: string;
    nextToken?: string;
    marketplaceId?: string;
  }): Promise<InboundShipmentsResponse> {
    const queryType = params.nextToken
      ? 'NEXT_TOKEN'
      : params.shipmentStatusList?.length || params.shipmentIdList?.length
      ? 'SHIPMENT'
      : 'DATE_RANGE';
    const response = await this.httpClient.get<InboundShipmentsResponse>(
      '/fba/inbound/v0/shipments',
      {
        params: {
          QueryType: queryType,
          ShipmentStatusList: params.shipmentStatusList?.join(','),
          ShipmentIdList: params.shipmentIdList?.join(','),
          LastUpdatedAfter: params.lastUpdatedAfter,
          LastUpdatedBefore: params.lastUpdatedBefore,
          NextToken: params.nextToken,
          MarketplaceId: params.marketplaceId ?? this.config.marketplaceId,
        },
      }
    );
    return response.data;
  }

  /**
   * Items in one inbound shipment (SKU, expected vs received quantities).
   * GET /fba/inbound/v0/shipments/{shipmentId}/items
   */
  async getInboundShipmentItems(params: {
    shipmentId: string;
    marketplaceId?: string;
  }): Promise<InboundShipmentItemsResponse> {
    const response = await this.httpClient.get<InboundShipmentItemsResponse>(
      `/fba/inbound/v0/shipments/${encodeURIComponent(
        params.shipmentId
      )}/items`,
      {
        params: {
          MarketplaceId: params.marketplaceId ?? this.config.marketplaceId,
        },
      }
    );
    return response.data;
  }

  // ========================================
  // Orders API (v0)
  // ========================================

  /**
   * Get order details
   * GET /orders/v0/orders/{orderId}
   */
  async getOrder(orderId: string): Promise<OrderResponse> {
    const response = await this.httpClient.get<OrderResponse>(
      `/orders/v0/orders/${orderId}`
    );
    return response.data;
  }

  /**
   * Get orders
   * GET /orders/v0/orders
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
    buyerEmail?: string;
    sellerOrderId?: string;
    maxResultsPerPage?: number;
    easyShipShipmentStatuses?: string[];
    nextToken?: string;
  }): Promise<OrdersListResponse> {
    const marketplaceIds = params.marketplaceIds || [this.config.marketplaceId];

    const response = await this.httpClient.get<OrdersListResponse>(
      '/orders/v0/orders',
      {
        params: {
          MarketplaceIds: marketplaceIds.join(','),
          CreatedAfter: params.createdAfter,
          CreatedBefore: params.createdBefore,
          LastUpdatedAfter: params.lastUpdatedAfter,
          LastUpdatedBefore: params.lastUpdatedBefore,
          OrderStatuses: params.orderStatuses?.join(','),
          FulfillmentChannels: params.fulfillmentChannels?.join(','),
          PaymentMethods: params.paymentMethods?.join(','),
          BuyerEmail: params.buyerEmail,
          SellerOrderId: params.sellerOrderId,
          MaxResultsPerPage: params.maxResultsPerPage,
          EasyShipShipmentStatuses: params.easyShipShipmentStatuses?.join(','),
          NextToken: params.nextToken,
        },
      }
    );

    return response.data;
  }

  /**
   * Get order items
   * GET /orders/v0/orders/{orderId}/orderItems
   */
  async getOrderItems(
    orderId: string,
    nextToken?: string
  ): Promise<OrderItemsResponse> {
    const response = await this.httpClient.get<OrderItemsResponse>(
      `/orders/v0/orders/${orderId}/orderItems`,
      {
        params: { NextToken: nextToken },
      }
    );

    return response.data;
  }

  /**
   * Get FBA inventory summaries (includes FNSKU data)
   * GET /fba/inventory/v1/summaries
   */
  async getInventorySummaries(params: {
    granularityType: string;
    granularityId: string;
    sellerSkus?: string[];
    marketplaceIds?: string[];
    nextToken?: string;
  }): Promise<any> {
    const queryParams: Record<string, string> = {
      details: 'true',
      granularityType: params.granularityType,
      granularityId: params.granularityId,
    };
    if (params.sellerSkus) {
      queryParams.sellerSkus = params.sellerSkus.join(',');
    }
    if (params.marketplaceIds) {
      queryParams.marketplaceIds = params.marketplaceIds.join(',');
    }
    if (params.nextToken) {
      queryParams.nextToken = params.nextToken;
    }
    const response = await this.httpClient.get('/fba/inventory/v1/summaries', {
      params: queryParams,
    });
    return response.data.payload || response.data;
  }

  // ========================================
  // A+ Content API (2020-11-01)
  // ========================================

  async searchAPlusContentDocuments(params?: {
    marketplaceId?: string;
    pageToken?: string;
  }): Promise<unknown> {
    const response = await this.httpClient.get(
      '/aplus/2020-11-01/contentDocuments',
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
          pageToken: params?.pageToken,
        },
      }
    );
    return response.data;
  }

  async getAPlusContentDocument(
    contentReferenceKey: string,
    params?: {
      marketplaceId?: string;
      includedDataSet?: Array<'CONTENTS' | 'METADATA'>;
    }
  ): Promise<unknown> {
    const response = await this.httpClient.get(
      `/aplus/2020-11-01/contentDocuments/${encodeURIComponent(
        contentReferenceKey
      )}`,
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
          includedDataSet: params?.includedDataSet?.join(','),
        },
      }
    );
    return response.data;
  }

  async createAPlusContentDocument(
    request: APlusContentDocumentRequest,
    params?: { marketplaceId?: string }
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      '/aplus/2020-11-01/contentDocuments',
      request,
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
        },
      }
    );
    return response.data;
  }

  async updateAPlusContentDocument(
    contentReferenceKey: string,
    request: APlusContentDocumentRequest,
    params?: { marketplaceId?: string }
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      `/aplus/2020-11-01/contentDocuments/${encodeURIComponent(
        contentReferenceKey
      )}`,
      request,
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
        },
      }
    );
    return response.data;
  }

  async validateAPlusContentDocumentAsinRelations(
    request: APlusValidateRequest,
    params?: { marketplaceId?: string }
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      '/aplus/2020-11-01/contentAsinValidations',
      { contentDocument: request.contentDocument },
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
          asinSet: request.asinSet,
        },
      }
    );
    return response.data;
  }

  async postAPlusContentDocumentAsinRelations(
    contentReferenceKey: string,
    request: APlusAsinRelationsRequest,
    params?: { marketplaceId?: string }
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      `/aplus/2020-11-01/contentDocuments/${encodeURIComponent(
        contentReferenceKey
      )}/asins`,
      request,
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
        },
      }
    );
    return response.data;
  }

  async submitAPlusContentDocumentForApproval(
    contentReferenceKey: string,
    params?: { marketplaceId?: string }
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      `/aplus/2020-11-01/contentDocuments/${encodeURIComponent(
        contentReferenceKey
      )}/approvalSubmissions`,
      undefined,
      {
        params: {
          marketplaceId: params?.marketplaceId || this.config.marketplaceId,
        },
      }
    );
    return response.data;
  }

  async createUploadDestinationForResource(
    resource: string,
    request?: UploadDestinationRequest
  ): Promise<unknown> {
    const response = await this.httpClient.post(
      `/uploads/2020-11-01/uploadDestinations/${encodeURIComponent(resource)}`,
      request || {}
    );
    return response.data;
  }

  // ---------------------------------------------------------------------------
  // Reports API (2021-06-30)
  //
  // Reports are asynchronous: create → poll until DONE → fetch the document's
  // presigned URL → download (usually GZIP'd TSV). Amazon generates them on
  // their side, so the same window requested twice can return the same rows —
  // deduplication is the caller's job, not something the API guarantees.
  // ---------------------------------------------------------------------------

  /**
   * Request a report. Returns the reportId to poll.
   *
   * `reportOptions` is required by the ledger reports (aggregateByLocation,
   * aggregatedByTimePeriod, eventType, FNSKU/MSKU/ASIN) and ignored by the rest.
   */
  async createReport(params: {
    reportType: string;
    dataStartTime?: string;
    dataEndTime?: string;
    marketplaceIds?: string[];
    reportOptions?: Record<string, string>;
  }): Promise<{ reportId: string }> {
    const response = await this.httpClient.post<{ reportId: string }>(
      '/reports/2021-06-30/reports',
      {
        reportType: params.reportType,
        marketplaceIds: params.marketplaceIds ?? [this.config.marketplaceId],
        ...(params.dataStartTime
          ? { dataStartTime: params.dataStartTime }
          : {}),
        ...(params.dataEndTime ? { dataEndTime: params.dataEndTime } : {}),
        ...(params.reportOptions
          ? { reportOptions: params.reportOptions }
          : {}),
      }
    );
    return response.data;
  }

  /**
   * List reports Amazon already generated, newest first.
   *
   * Needed because some report types cannot be requested at all. Settlement
   * reports are produced by Amazon on its own settlement cycle and
   * `createReport` rejects them — the only way to obtain one is to find the ones
   * that already exist and download those. Amazon keeps roughly 90 days of them,
   * so anything not captured inside that window is gone, which is the entire
   * reason for archiving them.
   *
   * `processingStatuses` defaults to DONE: a report still IN_QUEUE has no
   * document to fetch, and returning it would push that check onto every caller.
   */
  async listReports(params: {
    reportTypes: string[];
    marketplaceIds?: string[];
    /** Filters on when Amazon PRODUCED the report, not the data it covers. */
    createdSince?: string;
    createdUntil?: string;
    processingStatuses?: Array<
      'IN_QUEUE' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'FATAL'
    >;
    pageSize?: number;
    nextToken?: string;
  }): Promise<{
    reports: Array<{
      reportId: string;
      reportType: string;
      processingStatus: string;
      reportDocumentId?: string;
      dataStartTime?: string;
      dataEndTime?: string;
      createdTime?: string;
    }>;
    nextToken?: string;
  }> {
    // nextToken must travel ALONE — Amazon rejects it alongside the filters that
    // produced it, which is a 400 that reads like the token is malformed.
    const query = params.nextToken
      ? { nextToken: params.nextToken }
      : {
          reportTypes: params.reportTypes.join(','),
          marketplaceIds: (
            params.marketplaceIds ?? [this.config.marketplaceId]
          ).join(','),
          processingStatuses: (params.processingStatuses ?? ['DONE']).join(','),
          ...(params.createdSince ? { createdSince: params.createdSince } : {}),
          ...(params.createdUntil ? { createdUntil: params.createdUntil } : {}),
          ...(params.pageSize ? { pageSize: String(params.pageSize) } : {}),
        };

    const response = await this.httpClient.get('/reports/2021-06-30/reports', {
      params: query,
    });
    return {
      reports: response.data?.reports ?? [],
      nextToken: response.data?.nextToken,
    };
  }

  /** Poll a report's processing status. */
  async getReport(reportId: string): Promise<{
    reportId: string;
    reportType: string;
    processingStatus:
      | 'IN_QUEUE'
      | 'IN_PROGRESS'
      | 'DONE'
      | 'CANCELLED'
      | 'FATAL';
    reportDocumentId?: string;
    dataStartTime?: string;
    dataEndTime?: string;
    createdTime?: string;
  }> {
    const response = await this.httpClient.get(
      `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`
    );
    return response.data;
  }

  /** Presigned URL + compression for a finished report. */
  async getReportDocument(reportDocumentId: string): Promise<{
    reportDocumentId: string;
    url: string;
    compressionAlgorithm?: 'GZIP';
  }> {
    const response = await this.httpClient.get(
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`
    );
    return response.data;
  }

  /**
   * Download a report document to text. The presigned URL is NOT an SP-API
   * endpoint — it must be fetched without the SP-API auth headers, which is why
   * this bypasses the configured client.
   */
  async downloadReportDocument(document: {
    url: string;
    compressionAlgorithm?: 'GZIP';
  }): Promise<string> {
    const response = await axios.get<ArrayBuffer>(document.url, {
      responseType: 'arraybuffer',
      // Reports can be large; a slow S3 read should not hang forever.
      timeout: 120_000,
    });
    const body = Buffer.from(response.data);
    const bytes =
      document.compressionAlgorithm === 'GZIP' ? gunzipSync(body) : body;
    // Amazon emits some FBA reports as Latin-1; UTF-8 decoding those mangles
    // accented SKUs and product titles.
    const text = bytes.toString('utf8');
    return text.includes('\uFFFD') ? bytes.toString('latin1') : text;
  }

  /**
   * Create → poll → download in one call. Polls with backoff up to `timeoutMs`;
   * generation commonly takes 30s to several minutes.
   *
   * The default is REQUEST-SAFE on purpose. It used to be ten minutes, which is
   * twice the 300s a Vercel route gets for an entire turn — so the only caller
   * that reached it, the `sync-report` chat tool, could never have completed
   * inside its own budget. It could only be killed by the platform, and being
   * killed loses the report id, so the next attempt asked Amazon to build the
   * same report again.
   *
   * A library default longer than any caller's budget is a trap: it looks
   * generous and can only ever be reached by a request that is already doomed.
   * Background workers, which genuinely can wait, pass their own.
   */
  async runReport(params: {
    reportType: string;
    dataStartTime?: string;
    dataEndTime?: string;
    marketplaceIds?: string[];
    reportOptions?: Record<string, string>;
    timeoutMs?: number;
    onStatus?: (status: string) => void;
  }): Promise<{ reportId: string; text: string; dataEndTime?: string }> {
    const { reportId } = await this.createReport(params);
    const deadline =
      Date.now() + (params.timeoutMs ?? REPORT_TIMEOUT_MS.requestSafe);
    let waitMs = 2_000;

    for (;;) {
      const report = await this.getReport(reportId);
      params.onStatus?.(report.processingStatus);

      if (report.processingStatus === 'DONE' && report.reportDocumentId) {
        const document = await this.getReportDocument(report.reportDocumentId);
        return {
          reportId,
          text: await this.downloadReportDocument(document),
          dataEndTime: report.dataEndTime,
        };
      }
      if (
        report.processingStatus === 'CANCELLED' ||
        report.processingStatus === 'FATAL'
      ) {
        // CANCELLED usually means "no data for that window", which is a normal
        // outcome worth distinguishing from a real failure.
        throw new Error(
          `Report ${params.reportType} finished as ${report.processingStatus}` +
            (report.processingStatus === 'CANCELLED'
              ? ' — usually means there was no data in that date range.'
              : '.')
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Report ${params.reportType} still ${report.processingStatus} after ` +
            `${Math.round(
              (params.timeoutMs ?? REPORT_TIMEOUT_MS.requestSafe) / 1000
            )}s (reportId ${reportId}). The report is still being built — ` +
            'reuse this id rather than requesting it again.'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs = Math.min(waitMs * 1.5, 30_000);
    }
  }
}
