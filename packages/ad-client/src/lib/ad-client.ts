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
}
