// import * as ManagerAccount_prod_3p from '@farvisionllc/amazon-ads-generated/ManagerAccount_prod_3p.js';

import { gunzipSync } from 'node:zlib';
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
  /**
   * Get a fresh access token from somewhere that holds the refresh token (#55).
   *
   * When set it REPLACES the LWA call below, so this client keeps its automatic
   * retry-on-401 **without holding the refresh token or the client secret**.
   * See the identical option on `SpApiClientConfig` for the reasoning.
   *
   * `onTokenRefresh` is not called on this path — whoever minted the token has
   * already stored it.
   */
  mintAccessToken?: () => Promise<string>;
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

/**
 * Which purchases count toward a click.
 *
 * There is no neutral choice here. Amazon returns `sales1d` through `sales30d`
 * side by side for the same spend, and ACOS on 30-day attribution can look
 * several times healthier than the same campaign on 1-day. A performance figure
 * quoted without its window is not imprecise, it is a different claim — so this
 * is a required part of every result rather than a hidden default.
 */
export type AdsAttributionWindow = '1d' | '7d' | '14d' | '30d';

export type AdsPerformanceLevel = 'campaign' | 'keyword' | 'searchTerm';

/**
 * The states a write may set.
 *
 * Deliberately narrower than the ARCHIVED the list endpoints can return:
 * Amazon's v3 update schema accepts only ENABLED and PAUSED (archiving is a
 * separate delete endpoint, and archiving is permanent). Keeping ARCHIVED out
 * of the write type means every mutation this client can perform is
 * reversible — pause it back, re-enable it, change the number again.
 */
export type AdsEntityState = 'ENABLED' | 'PAUSED';

export type AdsNegativeMatchType =
  | 'NEGATIVE_EXACT'
  | 'NEGATIVE_PHRASE'
  | 'NEGATIVE_BROAD';

/** How closely a shopper's search must match a keyword for it to compete. */
export type AdsKeywordMatchType = 'EXACT' | 'PHRASE' | 'BROAD';

/**
 * How a campaign finds shoppers.
 *
 * `AUTO` lets Amazon choose the terms — the usual starting point, and the
 * source a harvest funnel reads from. `MANUAL` means the campaign serves only
 * on targets supplied explicitly, so a MANUAL campaign with no keywords can
 * never show an impression.
 */
export type AdsTargetingType = 'AUTO' | 'MANUAL';

/**
 * A whole Sponsored Products campaign, as one request (#146).
 *
 * One object rather than four calls the caller sequences, because the id of
 * each level is only known once the level above succeeded — and because a
 * caller free to stop halfway is a caller who can leave live-money structure
 * in a broken state.
 */
export type AdCampaignTreeRequest = {
  name: string;
  targetingType: AdsTargetingType;
  dailyBudget: number;
  biddingStrategy?:
    | 'LEGACY_FOR_SALES'
    | 'AUTO_FOR_SALES'
    | 'MANUAL'
    | 'RULE_BASED';
  adGroup: { name: string; defaultBid: number };
  /**
   * What to advertise. At least one is required and the requirement is not
   * cosmetic: a campaign with no product ads is accepted by Amazon, costs
   * nothing, and can never show an impression.
   */
  products: Array<{ sku?: string; asin?: string }>;
  /**
   * Targets, for MANUAL campaigns. An AUTO campaign supplies its own, so
   * keywords here would be rejected by Amazon rather than ignored.
   */
  keywords?: Array<{
    keywordText: string;
    matchType: AdsKeywordMatchType;
    bid?: number;
  }>;
};

/** One level's outcome, per item, named the way a human would name it. */
export type AdTreeLevelResult = {
  requested: number;
  created: number;
  failures: Array<{ item: string; error: string }>;
};

/**
 * What was actually built — not what was asked for.
 *
 * The dangerous outcome of a four-POST create is not an error. It is a campaign
 * that exists, looks created, is missing the one level that makes it able to
 * serve, and reports success. So this type has no boolean for "did it work":
 * it has the tree that exists, and `servable`, which is computed from that tree
 * rather than from the absence of errors.
 */
export type AdCampaignTreeResult = {
  campaign: {
    name: string;
    created: boolean;
    campaignId?: string;
    error?: string;
  };
  adGroup: {
    name: string;
    created: boolean;
    adGroupId?: string;
    error?: string;
  };
  productAds: AdTreeLevelResult;
  keywords: AdTreeLevelResult;
  /**
   * Whether what exists could show an impression once enabled.
   *
   * Requires the campaign, the ad group, at least one product ad, and — for a
   * MANUAL campaign — at least one keyword. Anything less is structure that
   * spends nothing and returns nothing.
   */
  servable: boolean;
  /**
   * What a person has to do about what exists. Never empty when `servable` is
   * false, because there is no rollback: this client cannot archive, so a
   * half-built tree has to be finished or cleaned up by hand in the console.
   */
  remediation: string[];
};

/**
 * The two halves of a v3 bulk mutation, which arrive TOGETHER in a 207.
 *
 * Amazon applies each item independently: item 3 failing does not stop item 4
 * from being written. A caller that checks only for a thrown error will read
 * a half-applied batch as fully applied, so both arrays are always present
 * even when empty.
 */
export type AdsMutationResult = {
  success: Array<Record<string, unknown>>;
  error: Array<Record<string, unknown>>;
};

export type AdsPerformanceRow = {
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  purchases: number;
  /** cost / sales. Undefined when sales are zero — NOT zero, and not Infinity. */
  acos?: number;
  /** clicks / impressions. */
  ctr?: number;
  [key: string]: unknown;
};

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
          this.canRefresh()
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
  /**
   * Whether a token can be obtained at all.
   *
   * Either this client holds the material to mint one, or it was given a way to
   * ask. Without one of the two a 401 is final, and retrying would just send the
   * same rejected credential again.
   */
  private canRefresh(): boolean {
    return Boolean(
      this.config.mintAccessToken ||
        (this.config.refreshToken && this.config.clientSecret)
    );
  }

  private async refreshAccessToken(): Promise<string> {
    // Asking beats minting when the caller offered: it means neither the
    // refresh token nor the client secret is in this process.
    if (this.config.mintAccessToken) {
      const minted = await this.config.mintAccessToken();
      this.config.accessToken = minted;
      return minted;
    }

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
   * How many pages a single list call will follow before giving up.
   *
   * A bound rather than "until exhausted", because the loop is driven by a token
   * the server chooses: a server that keeps returning one would otherwise spin
   * forever inside one tool call. At Amazon's 500-item ceiling this is 10,000
   * records, comfortably past any real advertiser and short of a runaway.
   */
  private static readonly MAX_PAGES = 20;

  /**
   * List a resource, following `nextToken` to the end.
   *
   * Pagination is followed rather than surfaced because the alternative is worse
   * than it looks. Amazon returns `totalResults` for the whole result set while
   * `items` holds one page, so a caller that ignores the token gets a partial
   * list beside an accurate total — and a per-item breakdown that silently
   * disagrees with its own headline number. Nothing errors. An account with 172
   * campaigns fits in one page and never shows the problem; one with 600 does.
   *
   * `truncated` is set when the page bound is hit, so a caller can say the list
   * is incomplete instead of implying it is whole.
   */
  private async listResource<T>(
    endpoint: { path: string; media: string },
    collectionKey: string,
    body: Record<string, unknown>
  ): Promise<{
    items: T[];
    totalResults?: number;
    truncated?: boolean;
    pages: number;
  }> {
    const headers = {
      Accept: `application/vnd.${endpoint.media}+json`,
      'Content-Type': `application/vnd.${endpoint.media}+json`,
    };

    const items: T[] = [];
    let totalResults: number | undefined;
    let nextToken: string | undefined = body['nextToken'] as string | undefined;
    let pages = 0;

    do {
      const response = await this.httpClient.post(
        endpoint.path,
        // The filters are resent with each page. Unlike SP-API, where a
        // continuation token must travel alone, the Ads v3 list endpoints expect
        // the original request body plus the token — dropping the filters here
        // would widen the result set partway through the walk.
        nextToken ? { ...body, nextToken } : body,
        { headers }
      );

      const page = (response.data?.[collectionKey] ?? []) as T[];
      items.push(...page);
      totalResults = response.data?.totalResults ?? totalResults;
      nextToken = response.data?.nextToken;
      pages += 1;

      // A server that returns a token but no rows would otherwise loop without
      // making progress.
      if (page.length === 0) break;
    } while (nextToken && pages < AmazonAdsApiClient.MAX_PAGES);

    return {
      items,
      totalResults,
      ...(nextToken && pages >= AmazonAdsApiClient.MAX_PAGES
        ? { truncated: true }
        : {}),
      pages,
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

  // ---------------------------------------------------------------------------
  // Reporting v3 — the performance half (#86 stage 2)
  //
  // Amazon publishes no OpenAPI document for this API, so unlike Sponsored
  // Products these types are hand-written. The contract comes from Amazon's own
  // Postman collection (amzn/ads-advanced-tools-docs), which is why the media
  // type below looks odd but is correct: `createasyncreportrequest` is sent on
  // the STATUS request too, not only on the create.
  //
  // Reports are asynchronous: create, poll, then download a gzipped JSON
  // document from a presigned URL. Minutes, not milliseconds.
  // ---------------------------------------------------------------------------

  private static readonly REPORT_MEDIA =
    'application/vnd.createasyncreportrequest.v3+json';

  /** Request a performance report. Returns the id to poll. */
  public async createAdsReport(params: {
    name: string;
    startDate: string;
    endDate: string;
    reportTypeId: string;
    groupBy: string[];
    columns: string[];
    timeUnit?: 'DAILY' | 'SUMMARY';
    adProduct?: string;
  }): Promise<{ reportId: string; status?: string }> {
    const response = await this.httpClient.post(
      '/reporting/reports',
      {
        name: params.name,
        startDate: params.startDate,
        endDate: params.endDate,
        configuration: {
          adProduct: params.adProduct ?? 'SPONSORED_PRODUCTS',
          groupBy: params.groupBy,
          columns: params.columns,
          reportTypeId: params.reportTypeId,
          timeUnit: params.timeUnit ?? 'SUMMARY',
          format: 'GZIP_JSON',
        },
      },
      {
        headers: {
          'Content-Type': AmazonAdsApiClient.REPORT_MEDIA,
          Accept: AmazonAdsApiClient.REPORT_MEDIA,
        },
      }
    );
    return { reportId: response.data?.reportId, status: response.data?.status };
  }

  /** Poll a report. `url` appears only once the status is COMPLETED. */
  public async getAdsReport(reportId: string): Promise<{
    reportId: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    url?: string;
    failureReason?: string;
  }> {
    const response = await this.httpClient.get(
      `/reporting/reports/${encodeURIComponent(reportId)}`,
      { headers: { 'Content-Type': AmazonAdsApiClient.REPORT_MEDIA } }
    );
    return response.data;
  }

  /**
   * Download a finished report.
   *
   * The presigned URL is S3, not an Ads endpoint — sending Ads auth headers to
   * it is rejected, so this bypasses the configured client deliberately.
   * `GZIP_JSON` means gzipped JSON, not the TSV the SP-API reports use.
   */
  public async downloadAdsReport<T = Record<string, unknown>>(
    url: string
  ): Promise<T[]> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 120_000,
    });
    const body = Buffer.from(response.data);
    // Sniff the gzip magic number rather than trusting the requested format:
    // the transport may already have decompressed it.
    const isGzip = body[0] === 0x1f && body[1] === 0x8b;
    const text = (isGzip ? gunzipSync(body) : body).toString('utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  }

  /**
   * Create, poll and download in one call.
   *
   * NOT for a request path, and deliberately not used by one. Ads reports take
   * one to several minutes; the chat route has 300 seconds for an entire turn,
   * so blocking here spends the whole budget on a single tool and still often
   * loses — and losing throws away the report id, the only handle on work
   * Amazon has already begun billing for. Chat uses
   * `requestPerformanceReport` / `fetchPerformanceReport` instead.
   *
   * This exists for a background worker with its own timeout — the sync path in
   * #36, per ADR-0009 — where blocking is the whole point and there is nobody
   * waiting on the other end.
   */
  public async runAdsReport<T = Record<string, unknown>>(params: {
    name: string;
    startDate: string;
    endDate: string;
    reportTypeId: string;
    groupBy: string[];
    columns: string[];
    timeUnit?: 'DAILY' | 'SUMMARY';
    timeoutMs?: number;
    onStatus?: (status: string) => void;
  }): Promise<T[]> {
    const { reportId } = await this.createAdsReport(params);
    const deadline = Date.now() + (params.timeoutMs ?? 5 * 60_000);
    let waitMs = 3_000;

    for (;;) {
      const report = await this.getAdsReport(reportId);
      params.onStatus?.(report.status);

      if (report.status === 'COMPLETED' && report.url) {
        return this.downloadAdsReport<T>(report.url);
      }
      if (report.status === 'FAILED') {
        throw new Error(
          `Ads report ${params.reportTypeId} FAILED` +
            (report.failureReason ? `: ${report.failureReason}` : '.')
        );
      }
      if (Date.now() > deadline) {
        // The id is surfaced so a caller can poll it later rather than paying
        // for the same report twice.
        throw new Error(
          `Ads report ${params.reportTypeId} still ${report.status} after ` +
            `${Math.round((params.timeoutMs ?? 300_000) / 1000)}s ` +
            `(reportId ${reportId}).`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs = Math.min(waitMs * 1.5, 20_000);
    }
  }

  /**
   * Amazon's own default in Campaign Manager, so the least surprising here.
   * Always reported alongside the figures it produced.
   */
  private static readonly DEFAULT_ATTRIBUTION: AdsAttributionWindow = '14d';

  /**
   * Normalise a raw report row into comparable numbers.
   *
   * ACOS is deliberately `undefined` rather than 0 when there are no sales.
   * Zero would read as "perfectly efficient" for the exact rows that are pure
   * waste — spend with nothing to show — which inverts the ranking a seller
   * asked for. Division by zero as Infinity is no better; it serialises to
   * `null` through JSON and reappears as a missing value with no explanation.
   */
  private static toPerformanceRow(
    raw: Record<string, unknown>,
    attribution: AdsAttributionWindow
  ): AdsPerformanceRow {
    const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
    const cost = num(raw['cost']);
    const sales = num(raw[`sales${attribution}`]);
    const purchases = num(raw[`purchases${attribution}`]);
    const impressions = num(raw['impressions']);
    const clicks = num(raw['clicks']);

    return {
      ...raw,
      impressions,
      clicks,
      cost,
      sales,
      purchases,
      ...(sales > 0 ? { acos: cost / sales } : {}),
      ...(impressions > 0 ? { ctr: clicks / impressions } : {}),
    };
  }

  /**
   * Which report and columns each level needs.
   *
   * One place so the request and the fetch cannot disagree about what was
   * asked for.
   */
  private static performanceConfig(
    level: AdsPerformanceLevel,
    attribution: AdsAttributionWindow
  ): { reportTypeId: string; groupBy: string[]; columns: string[] } {
    const metrics = [
      'impressions',
      'clicks',
      'cost',
      `purchases${attribution}`,
      `sales${attribution}`,
    ];
    if (level === 'keyword') {
      return {
        reportTypeId: 'spTargeting',
        groupBy: ['targeting'],
        columns: [
          'keywordId',
          'keyword',
          'matchType',
          'campaignId',
          'adGroupId',
          ...metrics,
        ],
      };
    }
    if (level === 'searchTerm') {
      // What shoppers actually typed. Finds negative-keyword candidates: a
      // broad-match keyword can look acceptable overall while hiding several
      // terms that only cost money.
      return {
        reportTypeId: 'spSearchTerm',
        groupBy: ['searchTerm'],
        columns: [
          'searchTerm',
          'keyword',
          'matchType',
          'campaignId',
          'adGroupId',
          ...metrics,
        ],
      };
    }
    return {
      reportTypeId: 'spCampaigns',
      groupBy: ['campaign'],
      columns: ['campaignId', 'campaignName', 'campaignStatus', ...metrics],
    };
  }

  /**
   * Ask Amazon to build a performance report. Returns in about a second.
   *
   * Deliberately does NOT wait. Generation takes minutes, and the chat route
   * has 300 seconds for an entire turn — model included — so waiting here
   * spends the whole budget on one tool and still often loses. Worse, a caller
   * that gives up has no way to reclaim the work: the report id is the only
   * handle on something Amazon is already billing for, so it is returned rather
   * than buried in a timeout.
   */
  public async requestPerformanceReport(params: {
    level: AdsPerformanceLevel;
    startDate: string;
    endDate: string;
    attribution?: AdsAttributionWindow;
  }): Promise<{
    reportId: string;
    level: AdsPerformanceLevel;
    attribution: AdsAttributionWindow;
    status?: string;
  }> {
    const attribution =
      params.attribution ?? AmazonAdsApiClient.DEFAULT_ATTRIBUTION;
    const config = AmazonAdsApiClient.performanceConfig(
      params.level,
      attribution
    );
    const { reportId, status } = await this.createAdsReport({
      name: `${params.level} ${params.startDate}..${params.endDate}`,
      startDate: params.startDate,
      endDate: params.endDate,
      timeUnit: 'SUMMARY',
      ...config,
    });
    return { reportId, level: params.level, attribution, status };
  }

  /**
   * Check a report once and return its rows if they are ready.
   *
   * One poll, no waiting. "Not ready" is a normal answer, not a failure.
   *
   * The attribution window is recovered from the payload's own column names
   * rather than threaded back through the caller. Requiring the caller to
   * resupply it would mean a caller that forgot — or a model that guessed —
   * silently normalised the numbers against a window Amazon never reported,
   * and the result would look entirely reasonable.
   */
  public async fetchPerformanceReport(reportId: string): Promise<
    | { ready: false; status: string; failureReason?: string }
    | {
        ready: true;
        rows: AdsPerformanceRow[];
        attribution: AdsAttributionWindow;
      }
  > {
    const report = await this.getAdsReport(reportId);

    if (report.status === 'FAILED') {
      return {
        ready: false,
        status: 'FAILED',
        failureReason: report.failureReason,
      };
    }
    if (report.status !== 'COMPLETED' || !report.url) {
      return { ready: false, status: report.status };
    }

    const raw = await this.downloadAdsReport(report.url);
    const attribution =
      AmazonAdsApiClient.detectAttribution(raw[0]) ??
      AmazonAdsApiClient.DEFAULT_ATTRIBUTION;
    return {
      ready: true,
      rows: raw.map((r) => AmazonAdsApiClient.toPerformanceRow(r, attribution)),
      attribution,
    };
  }

  /** Read the window back off the payload: exactly one `sales<window>` is requested. */
  private static detectAttribution(
    row: Record<string, unknown> | undefined
  ): AdsAttributionWindow | undefined {
    if (!row) return undefined;
    const windows: AdsAttributionWindow[] = ['1d', '7d', '14d', '30d'];
    return windows.find((w) => `sales${w}` in row);
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

  // ---------------------------------------------------------------------------
  // Sponsored Products, writes (#86 stage 3)
  //
  // The mutation endpoints are the list endpoints minus `/list`: PUT to update,
  // POST to create, same vendored media type in both headers. All of them are
  // bulk — the body is an array under the collection key — and all of them
  // answer 207 with per-item success/error arrays rather than succeeding or
  // failing as a whole.
  //
  // What is NOT here is as deliberate as what is. No creates for campaigns,
  // ad groups, keywords or product ads: creating spend structure from scratch
  // is a different risk class from adjusting what exists. No archive: Amazon
  // archives through separate delete endpoints and an archived entity can
  // never be re-enabled, so exposing it would give one bad call a permanent
  // consequence. Everything below can be undone by a second call.
  // ---------------------------------------------------------------------------

  private static readonly WRITE_ENDPOINTS = {
    campaigns: { path: '/sp/campaigns', media: 'spCampaign.v3' },
    adGroups: { path: '/sp/adGroups', media: 'spAdGroup.v3' },
    keywords: { path: '/sp/keywords', media: 'spKeyword.v3' },
    productAds: { path: '/sp/productAds', media: 'spProductAd.v3' },
    negativeKeywords: {
      path: '/sp/negativeKeywords',
      media: 'spNegativeKeyword.v3',
    },
  } as const;

  /**
   * Amazon takes up to 1000 items per request; this stops far short of that
   * on purpose. Every batch here has been individually approved by a human in
   * chat, and 100 line items is already past what anyone actually reviews —
   * a bigger bound would just make the approval a formality.
   */
  private static readonly MAX_MUTATION_BATCH = 100;

  private async mutateResource(
    endpoint: { path: string; media: string },
    collectionKey: string,
    method: 'put' | 'post',
    items: Array<Record<string, unknown>>
  ): Promise<AdsMutationResult> {
    if (items.length === 0) {
      throw new Error('Nothing to write: the batch is empty.');
    }
    if (items.length > AmazonAdsApiClient.MAX_MUTATION_BATCH) {
      throw new Error(
        `Batch of ${items.length} exceeds the ${AmazonAdsApiClient.MAX_MUTATION_BATCH}-item ` +
          'limit — split it so each approval stays reviewable.'
      );
    }

    const response = await this.httpClient[method](
      endpoint.path,
      { [collectionKey]: items },
      {
        headers: {
          Accept: `application/vnd.${endpoint.media}+json`,
          'Content-Type': `application/vnd.${endpoint.media}+json`,
        },
      }
    );

    const outcome = response.data?.[collectionKey] ?? {};
    return {
      success: outcome.success ?? [],
      error: outcome.error ?? [],
    };
  }

  /** A positive amount or absent — 0 and negatives fail here, not at Amazon. */
  private static assertPositive(
    value: number | undefined,
    what: string,
    id: string
  ): void {
    if (value !== undefined && !(value > 0)) {
      throw new Error(`${what} for ${id} must be a positive number.`);
    }
  }

  /**
   * Update campaign state and/or daily budget.
   *
   * `dailyBudget` is in the profile's own currency — a CA profile budgets in
   * CAD — and is translated here to Amazon's `{ budget, budgetType: 'DAILY' }`
   * envelope, DAILY being the only type v3 accepts. Fields not supplied are
   * left untouched (sparse update), so an update that names neither state nor
   * budget would be a no-op Amazon happily accepts; it is refused locally
   * instead.
   */
  public async updateCampaigns(
    updates: Array<{
      campaignId: string;
      state?: AdsEntityState;
      dailyBudget?: number;
    }>
  ): Promise<AdsMutationResult> {
    const items = updates.map((u) => {
      if (u.state === undefined && u.dailyBudget === undefined) {
        throw new Error(
          `Update for campaign ${u.campaignId} changes nothing — supply state or dailyBudget.`
        );
      }
      AmazonAdsApiClient.assertPositive(
        u.dailyBudget,
        'dailyBudget',
        u.campaignId
      );
      return {
        campaignId: u.campaignId,
        ...(u.state ? { state: u.state } : {}),
        ...(u.dailyBudget !== undefined
          ? { budget: { budget: u.dailyBudget, budgetType: 'DAILY' } }
          : {}),
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.campaigns,
      'campaigns',
      'put',
      items
    );
  }

  /** Update ad group state and/or default bid (used when a keyword has none). */
  public async updateAdGroups(
    updates: Array<{
      adGroupId: string;
      state?: AdsEntityState;
      defaultBid?: number;
    }>
  ): Promise<AdsMutationResult> {
    const items = updates.map((u) => {
      if (u.state === undefined && u.defaultBid === undefined) {
        throw new Error(
          `Update for ad group ${u.adGroupId} changes nothing — supply state or defaultBid.`
        );
      }
      AmazonAdsApiClient.assertPositive(
        u.defaultBid,
        'defaultBid',
        u.adGroupId
      );
      return {
        adGroupId: u.adGroupId,
        ...(u.state ? { state: u.state } : {}),
        ...(u.defaultBid !== undefined ? { defaultBid: u.defaultBid } : {}),
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.adGroups,
      'adGroups',
      'put',
      items
    );
  }

  /**
   * Update keyword bids and/or state — the bid-adjustment write.
   *
   * Bids are validated as positive only; Amazon's real floor varies by
   * marketplace (USD 0.02, JPY 2, …) and is enforced in its 207 per-item
   * errors, where the message names the actual limit. Duplicating that table
   * here would mean silently drifting out of date with it.
   */
  public async updateKeywords(
    updates: Array<{
      keywordId: string;
      state?: AdsEntityState;
      bid?: number;
    }>
  ): Promise<AdsMutationResult> {
    const items = updates.map((u) => {
      if (u.state === undefined && u.bid === undefined) {
        throw new Error(
          `Update for keyword ${u.keywordId} changes nothing — supply state or bid.`
        );
      }
      AmazonAdsApiClient.assertPositive(u.bid, 'bid', u.keywordId);
      return {
        keywordId: u.keywordId,
        ...(u.state ? { state: u.state } : {}),
        ...(u.bid !== undefined ? { bid: u.bid } : {}),
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.keywords,
      'keywords',
      'put',
      items
    );
  }

  /**
   * Add negative keywords at AD GROUP level — the "stop paying for this search
   * term" write, and the usual action after a search-term report.
   *
   * Created ENABLED always: a paused negative blocks nothing, and a caller
   * who wants one off later pauses it with `updateNegativeKeywords`. Campaign
   * -level negatives are a separate endpoint not exposed here, matching the
   * read side, which also only sees the ad-group level.
   */
  public async createNegativeKeywords(
    creates: Array<{
      campaignId: string;
      adGroupId: string;
      keywordText: string;
      matchType: AdsNegativeMatchType;
    }>
  ): Promise<AdsMutationResult> {
    const items = creates.map((c) => {
      if (!c.keywordText.trim()) {
        throw new Error(
          `Negative keyword for ad group ${c.adGroupId} has empty keyword text.`
        );
      }
      return {
        campaignId: c.campaignId,
        adGroupId: c.adGroupId,
        keywordText: c.keywordText,
        matchType: c.matchType,
        state: 'ENABLED',
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.negativeKeywords,
      'negativeKeywords',
      'post',
      items
    );
  }

  /**
   * Pause or re-enable existing negative keywords — the undo for
   * `createNegativeKeywords`. State is the only field Amazon allows an update
   * to touch, so it is required rather than optional here.
   */
  public async updateNegativeKeywords(
    updates: Array<{ keywordId: string; state: AdsEntityState }>
  ): Promise<AdsMutationResult> {
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.negativeKeywords,
      'negativeKeywords',
      'put',
      updates.map((u) => ({ keywordId: u.keywordId, state: u.state }))
    );
  }

  // ---------------------------------------------------------------------------
  // Sponsored Products, creation (#146)
  //
  // A different risk class from everything above, and the comment on
  // WRITE_ENDPOINTS said so before any of this existed: the writes above can
  // each be undone by a second call, and a create cannot. Amazon has no delete
  // that returns a campaign to not-existing — only archive, which is permanent
  // and which this client deliberately does not expose.
  //
  // Two things make it safe enough to offer anyway.
  //
  // FIRST, everything is created PAUSED, whatever the caller asked for. That is
  // what converts an irreversible operation into a reversible one in the only
  // sense that matters here — money. A paused tree spends nothing, so a mistake
  // costs a console cleanup rather than a budget. Enabling is a separate,
  // already-reversible `updateCampaigns` call the seller makes after looking at
  // what was actually built.
  //
  // SECOND, a tree is four POSTs and each answers 207 independently, so partial
  // trees are not an edge case — they are the normal failure. `createCampaignTree`
  // reports the tree that EXISTS rather than the one that was asked for, and
  // computes whether it can serve at all, because the dangerous outcome is not
  // an error: it is a campaign that looks created, is missing its product ads,
  // and can never show an impression.
  // ---------------------------------------------------------------------------

  /**
   * Create campaigns. Always PAUSED — see the section comment.
   *
   * `startDate` is omitted rather than defaulted to today: Amazon defaults it
   * itself, in the profile's timezone, which is the one place that knows what
   * "today" means for this advertiser.
   */
  public async createCampaigns(
    campaigns: Array<{
      name: string;
      targetingType: AdsTargetingType;
      dailyBudget: number;
      /** Defaults to Amazon's own recommendation for the targeting type. */
      biddingStrategy?:
        | 'LEGACY_FOR_SALES'
        | 'AUTO_FOR_SALES'
        | 'MANUAL'
        | 'RULE_BASED';
    }>
  ): Promise<AdsMutationResult> {
    const items = campaigns.map((c) => {
      if (!c.name.trim()) {
        throw new Error('A campaign needs a name.');
      }
      AmazonAdsApiClient.assertPositive(c.dailyBudget, 'dailyBudget', c.name);
      return {
        name: c.name,
        targetingType: c.targetingType,
        // Not the caller's choice. See the section comment.
        state: 'PAUSED',
        budget: { budget: c.dailyBudget, budgetType: 'DAILY' },
        ...(c.biddingStrategy
          ? { dynamicBidding: { strategy: c.biddingStrategy } }
          : {}),
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.campaigns,
      'campaigns',
      'post',
      items
    );
  }

  /** Create ad groups under existing campaigns. Always PAUSED. */
  public async createAdGroups(
    adGroups: Array<{ campaignId: string; name: string; defaultBid: number }>
  ): Promise<AdsMutationResult> {
    const items = adGroups.map((g) => {
      if (!g.name.trim()) throw new Error('An ad group needs a name.');
      AmazonAdsApiClient.assertPositive(g.defaultBid, 'defaultBid', g.name);
      return {
        campaignId: g.campaignId,
        name: g.name,
        defaultBid: g.defaultBid,
        state: 'PAUSED',
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.adGroups,
      'adGroups',
      'post',
      items
    );
  }

  /**
   * Put SKUs into an ad group. Without at least one, a campaign can never
   * serve — which is why `createCampaignTree` treats zero as a failed tree
   * rather than a partial success.
   *
   * `sku` is preferred over `asin` when both are given: a seller's own SKU
   * identifies THEIR listing, while an ASIN identifies a product several
   * sellers may offer (see the SKU/FNSKU distinction the catalog code relies
   * on). Advertising the ASIN when the seller meant their SKU can point spend
   * at a listing they do not own.
   */
  public async createProductAds(
    productAds: Array<{
      campaignId: string;
      adGroupId: string;
      sku?: string;
      asin?: string;
    }>
  ): Promise<AdsMutationResult> {
    const items = productAds.map((a) => {
      if (!a.sku && !a.asin) {
        throw new Error(
          `A product ad in ad group ${a.adGroupId} names neither sku nor asin.`
        );
      }
      return {
        campaignId: a.campaignId,
        adGroupId: a.adGroupId,
        state: 'PAUSED',
        ...(a.sku ? { sku: a.sku } : { asin: a.asin }),
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.productAds,
      'productAds',
      'post',
      items
    );
  }

  /**
   * Create keywords. Always PAUSED.
   *
   * `bid` is optional because an omitted bid inherits the ad group's default,
   * which is usually what a seller means by "add these keywords" — and is
   * strictly safer than this code inventing a number.
   */
  public async createKeywords(
    keywords: Array<{
      campaignId: string;
      adGroupId: string;
      keywordText: string;
      matchType: AdsKeywordMatchType;
      bid?: number;
    }>
  ): Promise<AdsMutationResult> {
    const items = keywords.map((k) => {
      if (!k.keywordText.trim()) {
        throw new Error('A keyword needs text.');
      }
      AmazonAdsApiClient.assertPositive(k.bid, 'bid', k.keywordText);
      return {
        campaignId: k.campaignId,
        adGroupId: k.adGroupId,
        keywordText: k.keywordText,
        matchType: k.matchType,
        state: 'PAUSED',
        ...(k.bid !== undefined ? { bid: k.bid } : {}),
      };
    });
    return this.mutateResource(
      AmazonAdsApiClient.WRITE_ENDPOINTS.keywords,
      'keywords',
      'post',
      items
    );
  }

  /**
   * Amazon's per-item error, as a sentence.
   *
   * The 207 error entries carry an `errors` array of `{errorType, message}` and
   * nothing human-readable at the top level, so a caller that stringifies the
   * object gets JSON in front of a seller. Falls back to the whole object only
   * when the shape is unfamiliar — losing the detail would be worse than
   * printing something ugly.
   */
  private static describeItemError(entry: Record<string, unknown>): string {
    const inner = entry['errors'];
    if (Array.isArray(inner) && inner.length > 0) {
      const messages = inner
        .map((e) => {
          const o = e as Record<string, unknown>;
          return [o['errorType'], o['message']].filter(Boolean).join(': ');
        })
        .filter(Boolean);
      if (messages.length) return messages.join('; ');
    }
    return typeof entry['message'] === 'string'
      ? entry['message']
      : JSON.stringify(entry);
  }

  /** Fold a 207 into per-item counts, labelling failures by the caller's own name for the item. */
  private static levelResult(
    result: AdsMutationResult,
    labels: string[]
  ): AdTreeLevelResult {
    return {
      requested: labels.length,
      created: result.success.length,
      failures: result.error.map((entry) => {
        // `index` maps the failure back to the request item; without it a
        // seller is told "one of these failed" and has to guess which.
        const index = entry['index'];
        return {
          item:
            typeof index === 'number' && labels[index] !== undefined
              ? labels[index]
              : '(unidentified item)',
          error: AmazonAdsApiClient.describeItemError(entry),
        };
      }),
    };
  }

  /**
   * Build a whole campaign, PAUSED, reporting what exists.
   *
   * Descends only while the level above succeeded, because the ids come from the
   * responses: no campaign id means no ad group is possible, and no ad group id
   * means neither product ads nor keywords are. Product ads and keywords are
   * siblings — one failing does not stop the other, and both are attempted so
   * the seller learns about both problems in one pass rather than two.
   *
   * Never throws for a partial tree. A throw would discard the ids of what was
   * already created, which is the one piece of information needed to finish or
   * clean up — and Amazon has already created it either way.
   */
  public async createCampaignTree(
    request: AdCampaignTreeRequest
  ): Promise<AdCampaignTreeResult> {
    if (request.products.length === 0) {
      throw new Error(
        `Campaign ${request.name} names no products. A campaign with no product ` +
          'ads can never serve, so this is refused before anything is created.'
      );
    }
    const keywords = request.keywords ?? [];
    if (request.targetingType === 'MANUAL' && keywords.length === 0) {
      throw new Error(
        `Campaign ${request.name} is MANUAL but names no keywords, so it could ` +
          'never serve. Supply keywords, or use AUTO targeting.'
      );
    }
    if (request.targetingType === 'AUTO' && keywords.length > 0) {
      throw new Error(
        `Campaign ${request.name} is AUTO, which chooses its own targets — ` +
          'Amazon rejects keywords on an AUTO campaign rather than ignoring them.'
      );
    }

    const empty: AdTreeLevelResult = { requested: 0, created: 0, failures: [] };
    const productLabels = request.products.map(
      (p) => p.sku ?? p.asin ?? '(unnamed product)'
    );
    const keywordLabels = keywords.map(
      (k) => `${k.keywordText} (${k.matchType})`
    );

    const campaignResult = await this.createCampaigns([
      {
        name: request.name,
        targetingType: request.targetingType,
        dailyBudget: request.dailyBudget,
        ...(request.biddingStrategy
          ? { biddingStrategy: request.biddingStrategy }
          : {}),
      },
    ]);
    const campaignId = campaignResult.success[0]?.['campaignId'];
    if (typeof campaignId !== 'string') {
      const error = campaignResult.error[0]
        ? AmazonAdsApiClient.describeItemError(campaignResult.error[0])
        : 'Amazon returned no campaign id and no error.';
      return {
        campaign: { name: request.name, created: false, error },
        adGroup: { name: request.adGroup.name, created: false },
        productAds: { ...empty, requested: productLabels.length },
        keywords: { ...empty, requested: keywordLabels.length },
        servable: false,
        // The only clean outcome on this path: nothing was created, so there is
        // nothing to clean up.
        remediation: ['Nothing was created. Fix the reported error and retry.'],
      };
    }

    const adGroupResult = await this.createAdGroups([
      {
        campaignId,
        name: request.adGroup.name,
        defaultBid: request.adGroup.defaultBid,
      },
    ]);
    const adGroupId = adGroupResult.success[0]?.['adGroupId'];
    if (typeof adGroupId !== 'string') {
      const error = adGroupResult.error[0]
        ? AmazonAdsApiClient.describeItemError(adGroupResult.error[0])
        : 'Amazon returned no ad group id and no error.';
      return {
        campaign: { name: request.name, created: true, campaignId },
        adGroup: { name: request.adGroup.name, created: false, error },
        productAds: { ...empty, requested: productLabels.length },
        keywords: { ...empty, requested: keywordLabels.length },
        servable: false,
        remediation: [
          `Campaign ${request.name} (${campaignId}) exists with no ad group, so ` +
            'it can never serve. It is PAUSED and spends nothing. Either add an ' +
            'ad group in the console, or archive the campaign there — this tool ' +
            'cannot archive.',
        ],
      };
    }

    const [productAdResult, keywordResult] = await Promise.all([
      this.createProductAds(
        request.products.map((p) => ({ campaignId, adGroupId, ...p }))
      ),
      keywords.length
        ? this.createKeywords(
            keywords.map((k) => ({ campaignId, adGroupId, ...k }))
          )
        : Promise.resolve<AdsMutationResult>({ success: [], error: [] }),
    ]);

    const productAds = AmazonAdsApiClient.levelResult(
      productAdResult,
      productLabels
    );
    const keywordLevel = AmazonAdsApiClient.levelResult(
      keywordResult,
      keywordLabels
    );

    const needsKeywords = request.targetingType === 'MANUAL';
    const servable =
      productAds.created > 0 && (!needsKeywords || keywordLevel.created > 0);

    const remediation: string[] = [];
    if (productAds.created === 0) {
      remediation.push(
        `No product ads were created, so campaign ${request.name} ` +
          `(${campaignId}) cannot serve. Add the SKUs in the console, or archive ` +
          'the campaign there.'
      );
    } else if (productAds.failures.length) {
      remediation.push(
        `${productAds.failures.length} of ${productAds.requested} product ads ` +
          'failed — the campaign will serve, but not for those SKUs.'
      );
    }
    if (needsKeywords && keywordLevel.created === 0) {
      remediation.push(
        `No keywords were created on a MANUAL campaign, so ${request.name} ` +
          `(${campaignId}) cannot serve. Add targets in the console, or archive it.`
      );
    } else if (keywordLevel.failures.length) {
      remediation.push(
        `${keywordLevel.failures.length} of ${keywordLevel.requested} keywords ` +
          'failed — the campaign will serve on the rest.'
      );
    }
    if (servable) {
      // Said on every successful path, because "created" reads as "running" and
      // it is not: nothing spends until somebody enables it.
      remediation.push(
        `Created PAUSED and spending nothing. Enable ${request.name} ` +
          `(${campaignId}) when the structure looks right.`
      );
    }

    return {
      campaign: { name: request.name, created: true, campaignId },
      adGroup: { name: request.adGroup.name, created: true, adGroupId },
      productAds,
      keywords: keywordLevel,
      servable,
      remediation,
    };
  }
}
