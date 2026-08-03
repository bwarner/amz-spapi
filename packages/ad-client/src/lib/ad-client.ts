// import * as ManagerAccount_prod_3p from '@farvisionllc/amazon-ads-generated/ManagerAccount_prod_3p.js';

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';

export interface AmazonAdsClientConfig {
  clientId: string; // LwA Client ID
  clientSecret?: string; // For token refresh
  accessToken?: string; // OAuth access token
  refreshToken?: string; // For automatic token refresh
  profileId?: string; // Advertiser Profile ID (used as Scope header when needed)
  scope?: string; // OAuth permission scope string (not sent as profile scope header)
  marketplaceId: string; // e.g., 'ATVPDKIKX0DER'
  region?: 'NA' | 'EU' | 'FE'; // Optional region override
  onTokenRefresh?: (accessToken: string, expiresIn: number) => Promise<void>; // Callback to persist new token
}

interface LwaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: 'bearer';
  expires_in: number;
}

export type AdsBrand = {
  id?: string;
  name?: string;
};

export type AdsBrandsResponse = AdsBrand[];

export class AmazonAdsApiClient {
  private httpClient: AxiosInstance;
  private config: AmazonAdsClientConfig;
  private BASE_URL = 'https://advertising-api.amazon.com';
  private LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
  private isRefreshing = false;
  private refreshPromise: Promise<string> | null = null;

  constructor(config: AmazonAdsClientConfig) {
    this.config = config;

    // Set region-specific URLs
    if (this.config.region === 'EU') {
      this.BASE_URL = 'https://advertising-api-eu.amazon.com';
      this.LWA_TOKEN_URL = 'https://api.amazon.co.uk/auth/o2/token';
    } else if (this.config.region === 'FE') {
      this.BASE_URL = 'https://advertising-api-fe.amazon.com';
      this.LWA_TOKEN_URL = 'https://api.amazon.co.jp/auth/o2/token';
    }

    this.httpClient = axios.create({
      baseURL: this.BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Amazon-Advertising-API-ClientId': this.config.clientId,
      },
    });

    // Add request interceptor to inject current access token
    this.httpClient.interceptors.request.use((config) => {
      if (this.config.accessToken) {
        config.headers.Authorization = `Bearer ${this.config.accessToken}`;
      }
      // Add profile ID as Scope header if provided
      if (this.config.profileId) {
        config.headers['Amazon-Advertising-API-Scope'] = this.config.profileId;
      }
      return config;
    });

    // Add response interceptor for automatic token refresh on 401
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

        // If 401 and we have refresh token, try to refresh
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.config.refreshToken &&
          this.config.clientSecret
        ) {
          originalRequest._retry = true;

          try {
            // Refresh the token
            const newAccessToken = await this.refreshAccessToken();

            // Update the failed request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }

            // Retry the original request
            return this.httpClient(originalRequest);
          } catch {
            // Token refresh failed. Rejecting with the ORIGINAL error, so the
            // caller sees the 401 that triggered the refresh rather than the
            // refresh failure itself.
            return Promise.reject(error);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Refresh the access token using the refresh token
   * Handles concurrent refresh requests to avoid race conditions
   */
  private async refreshAccessToken(): Promise<string> {
    // If already refreshing, wait for that promise
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start refresh process
    this.isRefreshing = true;
    this.refreshPromise = this._doRefresh();

    try {
      const newToken = await this.refreshPromise;
      return newToken;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Internal method to perform the actual token refresh
   */
  private async _doRefresh(): Promise<string> {
    if (!this.config.refreshToken || !this.config.clientSecret) {
      throw new Error(
        'Missing refresh token or client secret for token refresh'
      );
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await axios.post<LwaTokenResponse>(
        this.LWA_TOKEN_URL,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, expires_in, refresh_token } = response.data;

      // Update config with new token
      this.config.accessToken = access_token;

      // Update refresh token if a new one was provided
      if (refresh_token) {
        this.config.refreshToken = refresh_token;
      }

      // Notify callback if provided (for persisting to storage)
      if (this.config.onTokenRefresh) {
        await this.config.onTokenRefresh(access_token, expires_in);
      }

      return access_token;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `Token refresh failed: ${error.response.status} - ${JSON.stringify(
            error.response.data
          )}`
        );
      }
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Manually trigger a token refresh
   * Useful for proactively refreshing tokens before expiry
   */
  public async forceRefreshToken(): Promise<void> {
    await this.refreshAccessToken();
  }

  public async getProfiles() {
    // Note: Profiles endpoint might have a different base URL or headers.
    // Check Amazon Advertising API documentation specifically for GET /profiles.
    // Profiles call does not require Scope (profile id) header; omit it here.
    return this.httpClient.get(`/v2/profiles`);
  }

  public async getNegativeBrands(): Promise<AdsBrandsResponse> {
    const response = await this.httpClient.get<AdsBrandsResponse>(
      '/sp/negativeTargets/brands/recommendations',
      {
        headers: {
          Accept: 'application/vnd.spproducttargetingresponse.v3+json',
        },
      }
    );
    return response.data;
  }

  public async searchBrands(keyword: string): Promise<AdsBrandsResponse> {
    const response = await this.httpClient.post<AdsBrandsResponse>(
      '/sp/negativeTargets/brands/search',
      { keyword },
      {
        headers: {
          Accept: 'application/vnd.spproducttargetingresponse.v3+json',
          'Content-Type': 'application/vnd.spproducttargeting.v3+json',
        },
      }
    );
    return response.data;
  }

  // ---------------------------------------------------------------------------
  // Sponsored Products, read-only (#86)
  //
  // Every v3 list endpoint is a POST — the filters go in a body, not a query
  // string — and each one demands its own vendored media type in BOTH Accept and
  // Content-Type. Send plain `application/json` and Amazon answers 415 with no
  // hint as to which of the two headers it disliked, so the media type travels
  // with the endpoint in ENDPOINTS below rather than being passed by callers.
  //
  // These read structure, not performance. Spend, sales and ACOS come from the
  // Ads Reporting API, which is a different service and is not vendored here —
  // see #86 stage 2. A caller asking "which campaigns waste money" cannot be
  // answered by anything on this class yet, and it is better for that to be
  // obvious than for a campaign list to be mistaken for an answer.
  // ---------------------------------------------------------------------------

  private static readonly ENDPOINTS = {
    campaigns: { path: '/sp/campaigns/list', media: 'spCampaign.v3' },
    adGroups: { path: '/sp/adGroups/list', media: 'spAdGroup.v3' },
    keywords: { path: '/sp/keywords/list', media: 'spKeyword.v3' },
    productAds: { path: '/sp/productAds/list', media: 'spProductAd.v3' },
    negativeKeywords: {
      path: '/sp/negativeKeywords/list',
      media: 'spNegativeKeyword.v3',
    },
    targets: {
      path: '/sp/targets/list',
      media: 'spTargetingClause.v3',
    },
  } as const;

  /**
   * One POST list call.
   *
   * `nextToken` continues a previous page. Amazon returns it inside the response
   * body under a key that varies by resource (`campaigns`, `adGroups`, …), which
   * is why the collection key is passed in rather than guessed.
   */
  private async listResource<T>(
    endpoint: { path: string; media: string },
    collectionKey: string,
    body: Record<string, unknown>
  ): Promise<{ items: T[]; nextToken?: string; totalResults?: number }> {
    const response = await this.httpClient.post(endpoint.path, body, {
      headers: {
        Accept: `application/vnd.${endpoint.media}+json`,
        'Content-Type': `application/vnd.${endpoint.media}+json`,
      },
    });
    return {
      items: response.data?.[collectionKey] ?? [],
      nextToken: response.data?.nextToken,
      totalResults: response.data?.totalResults,
    };
  }

  /**
   * Campaigns for the current advertiser profile.
   *
   * `stateFilter` defaults to excluding ARCHIVED. An archived campaign is not a
   * campaign anyone is managing, and including them by default makes every list
   * longer and every total wrong for the question usually being asked.
   */
  public async listCampaigns(params?: {
    campaignIdFilter?: string[];
    stateFilter?: Array<'ENABLED' | 'PAUSED' | 'ARCHIVED'>;
    maxResults?: number;
    nextToken?: string;
  }) {
    return this.listResource<Record<string, unknown>>(
      AmazonAdsApiClient.ENDPOINTS.campaigns,
      'campaigns',
      {
        stateFilter: {
          include: params?.stateFilter ?? ['ENABLED', 'PAUSED'],
        },
        ...(params?.campaignIdFilter
          ? { campaignIdFilter: { include: params.campaignIdFilter } }
          : {}),
        ...(params?.maxResults ? { maxResults: params.maxResults } : {}),
        ...(params?.nextToken ? { nextToken: params.nextToken } : {}),
      }
    );
  }

  public async listAdGroups(params?: {
    campaignIdFilter?: string[];
    adGroupIdFilter?: string[];
    stateFilter?: Array<'ENABLED' | 'PAUSED' | 'ARCHIVED'>;
    maxResults?: number;
    nextToken?: string;
  }) {
    return this.listResource<Record<string, unknown>>(
      AmazonAdsApiClient.ENDPOINTS.adGroups,
      'adGroups',
      {
        stateFilter: { include: params?.stateFilter ?? ['ENABLED', 'PAUSED'] },
        ...(params?.campaignIdFilter
          ? { campaignIdFilter: { include: params.campaignIdFilter } }
          : {}),
        ...(params?.adGroupIdFilter
          ? { adGroupIdFilter: { include: params.adGroupIdFilter } }
          : {}),
        ...(params?.maxResults ? { maxResults: params.maxResults } : {}),
        ...(params?.nextToken ? { nextToken: params.nextToken } : {}),
      }
    );
  }

  /** Keyword targets, with their bids. Match type lives on each keyword. */
  public async listKeywords(params?: {
    campaignIdFilter?: string[];
    adGroupIdFilter?: string[];
    stateFilter?: Array<'ENABLED' | 'PAUSED' | 'ARCHIVED'>;
    maxResults?: number;
    nextToken?: string;
  }) {
    return this.listResource<Record<string, unknown>>(
      AmazonAdsApiClient.ENDPOINTS.keywords,
      'keywords',
      {
        stateFilter: { include: params?.stateFilter ?? ['ENABLED', 'PAUSED'] },
        ...(params?.campaignIdFilter
          ? { campaignIdFilter: { include: params.campaignIdFilter } }
          : {}),
        ...(params?.adGroupIdFilter
          ? { adGroupIdFilter: { include: params.adGroupIdFilter } }
          : {}),
        ...(params?.maxResults ? { maxResults: params.maxResults } : {}),
        ...(params?.nextToken ? { nextToken: params.nextToken } : {}),
      }
    );
  }

  /**
   * Negative keywords at ad-group level.
   *
   * Campaign-level negatives are a DIFFERENT endpoint
   * (`/sp/campaignNegativeKeywords/list`); a seller asking "why is this search
   * term still spending" may be blocked at either level, so reading one and
   * reporting it as the whole answer is misleading.
   */
  public async listNegativeKeywords(params?: {
    campaignIdFilter?: string[];
    adGroupIdFilter?: string[];
    maxResults?: number;
    nextToken?: string;
  }) {
    return this.listResource<Record<string, unknown>>(
      AmazonAdsApiClient.ENDPOINTS.negativeKeywords,
      'negativeKeywords',
      {
        stateFilter: { include: ['ENABLED', 'PAUSED'] },
        ...(params?.campaignIdFilter
          ? { campaignIdFilter: { include: params.campaignIdFilter } }
          : {}),
        ...(params?.adGroupIdFilter
          ? { adGroupIdFilter: { include: params.adGroupIdFilter } }
          : {}),
        ...(params?.maxResults ? { maxResults: params.maxResults } : {}),
        ...(params?.nextToken ? { nextToken: params.nextToken } : {}),
      }
    );
  }

  /** The advertised ASINs/SKUs themselves. */
  public async listProductAds(params?: {
    campaignIdFilter?: string[];
    adGroupIdFilter?: string[];
    stateFilter?: Array<'ENABLED' | 'PAUSED' | 'ARCHIVED'>;
    maxResults?: number;
    nextToken?: string;
  }) {
    return this.listResource<Record<string, unknown>>(
      AmazonAdsApiClient.ENDPOINTS.productAds,
      'productAds',
      {
        stateFilter: { include: params?.stateFilter ?? ['ENABLED', 'PAUSED'] },
        ...(params?.campaignIdFilter
          ? { campaignIdFilter: { include: params.campaignIdFilter } }
          : {}),
        ...(params?.adGroupIdFilter
          ? { adGroupIdFilter: { include: params.adGroupIdFilter } }
          : {}),
        ...(params?.maxResults ? { maxResults: params.maxResults } : {}),
        ...(params?.nextToken ? { nextToken: params.nextToken } : {}),
      }
    );
  }

  /**
   * How much of each campaign's budget today has been consumed.
   *
   * The one genuinely useful spend signal reachable without the Reporting API,
   * and it is TODAY only — it answers "am I capped right now", not "what did
   * this cost me".
   *
   * Amazon documents this as requiring `advertiser_campaign_edit`, an EDIT
   * permission on a read-only call. A token granted read scope alone gets a 403
   * here while every list endpoint above succeeds, so a failure on this one
   * specifically is a scope problem and not a broken connection — which is not
   * what a 403 next to six working calls looks like at first glance.
   *
   * Responses are partial by design: `success` and `error` arrive together, one
   * entry per campaign id, so a bad id degrades that row rather than the call.
   */
  public async getCampaignBudgetUsage(campaignIds: string[]) {
    const response = await this.httpClient.post(
      '/sp/campaigns/budget/usage',
      { campaignIds },
      {
        headers: {
          Accept: 'application/vnd.spcampaignbudgetusage.v1+json',
          'Content-Type': 'application/vnd.spcampaignbudgetusage.v1+json',
        },
      }
    );
    return {
      usage: response.data?.success ?? [],
      errors: response.data?.error ?? [],
    };
  }
}
