import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
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
type CatalogItemResponse = CatalogPaths['/catalog/2022-04-01/items/{asin}']['get']['responses']['200']['content']['application/json'];
type CatalogSearchResponse = CatalogPaths['/catalog/2022-04-01/items']['get']['responses']['200']['content']['application/json'];

type OrdersListResponse = OrdersPaths['/orders/v0/orders']['get']['responses']['200']['content']['application/json'];
type OrderResponse = OrdersPaths['/orders/v0/orders/{orderId}']['get']['responses']['200']['content']['application/json'];
type OrderItemsResponse = OrdersPaths['/orders/v0/orders/{orderId}/orderItems']['get']['responses']['200']['content']['application/json'];

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
      if (!this.config.accessToken && this.config.refreshToken && this.config.clientSecret) {
        await this.refreshAccessToken();
      }

      if (this.config.accessToken) {
        config.headers.Authorization = `Bearer ${this.config.accessToken}`;
        // Add x-amz-access-token header (required for SP-API)
        config.headers['x-amz-access-token'] = this.config.accessToken;
      }
      return config;
    });

    // Response interceptor: auto token refresh on 401
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

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
          } catch (refreshError) {
            return Promise.reject(error);
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
  async getCatalogItem(asin: string, params?: {
    marketplaceIds?: string[];
    includedData?: string[];
    locale?: string;
  }): Promise<CatalogItemResponse> {
    const marketplaceIds = params?.marketplaceIds || [this.config.marketplaceId];

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
    identifiersType?: 'ASIN' | 'EAN' | 'GTIN' | 'ISBN' | 'JAN' | 'MINSAN' | 'SKU' | 'UPC';
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
    const response = await this.httpClient.get<OrderResponse>(`/orders/v0/orders/${orderId}`);
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

    const response = await this.httpClient.get<OrdersListResponse>('/orders/v0/orders', {
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
    });

    return response.data;
  }

  /**
   * Get order items
   * GET /orders/v0/orders/{orderId}/orderItems
   */
  async getOrderItems(orderId: string, nextToken?: string): Promise<OrderItemsResponse> {
    const response = await this.httpClient.get<OrderItemsResponse>(
      `/orders/v0/orders/${orderId}/orderItems`,
      {
        params: { NextToken: nextToken },
      }
    );

    return response.data;
  }
}
