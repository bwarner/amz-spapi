import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import type { paths as CatalogPaths } from '@amz-spapi/amazon-sp-generated/lib/catalogItems_2022-04-01';
import type { paths as OrdersPaths } from '@amz-spapi/amazon-sp-generated/lib/ordersV0';

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
}
