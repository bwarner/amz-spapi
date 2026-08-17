/**
 * Sponsored Products read paths (#86).
 *
 * Two failure modes worth pinning, both of which produce an unhelpful error at
 * the far end of an HTTP call rather than anything local:
 *
 * 1. Every v3 list endpoint demands its own vendored media type in BOTH Accept
 *    and Content-Type. Plain `application/json` returns 415 without saying
 *    which header was wrong.
 * 2. The filters travel in a POST body, not a query string — and Amazon wraps
 *    each one in `{ include: [...] }`. A bare array is accepted and ignored,
 *    which silently returns everything instead of the filtered set.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AmazonAdsApiClient } from './ad-client.js';

type Captured = {
  method: 'post' | 'put';
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function clientWithCapture(responseData: unknown = {}) {
  const captured: Captured[] = [];
  const client = new AmazonAdsApiClient({
    clientId: 'amzn1.application-oa2-client.test',
    marketplaceId: 'ATVPDKIKX0DER',
    profileId: '967757046531288',
    accessToken: 'token',
  });

  const record =
    (method: 'post' | 'put') =>
    async (path: string, body: unknown, config: unknown) => {
      captured.push({
        method,
        path,
        body: (body ?? {}) as Record<string, unknown>,
        headers: ((config as { headers?: Record<string, string> })?.headers ??
          {}) as Record<string, string>,
      });
      return { data: responseData };
    };

  // Replace the transport, keeping the class's own header and body assembly.
  (client as unknown as { httpClient: unknown }).httpClient = {
    post: vi.fn(record('post')),
    put: vi.fn(record('put')),
    get: vi.fn(async () => ({ data: responseData })),
  };

  return { client, captured };
}

describe('vendored media types', () => {
  let subject: ReturnType<typeof clientWithCapture>;

  beforeEach(() => {
    subject = clientWithCapture({ campaigns: [] });
  });

  it('sends the same vendored type in Accept and Content-Type', async () => {
    // Amazon rejects a mismatch with 415 and does not say which header it
    // disliked, so both must be set and they must agree.
    await subject.client.listCampaigns();

    const { headers } = subject.captured[0];
    expect(headers.Accept).toBe('application/vnd.spCampaign.v3+json');
    expect(headers['Content-Type']).toBe('application/vnd.spCampaign.v3+json');
  });

  it.each([
    ['listAdGroups', 'spAdGroup.v3'],
    ['listKeywords', 'spKeyword.v3'],
    ['listProductAds', 'spProductAd.v3'],
    ['listNegativeKeywords', 'spNegativeKeyword.v3'],
  ] as const)('uses the right type for %s', async (method, media) => {
    const local = clientWithCapture({});
    await (local.client as unknown as Record<string, () => Promise<unknown>>)[
      method
    ]();

    expect(local.captured[0].headers.Accept).toBe(
      `application/vnd.${media}+json`
    );
  });

  it('never falls back to plain application/json', async () => {
    // The default on the axios instance is application/json. If a method
    // forgets its override it inherits that and 415s in production only.
    await subject.client.listCampaigns();

    expect(subject.captured[0].headers['Content-Type']).not.toBe(
      'application/json'
    );
  });
});

describe('filters', () => {
  it('wraps filters in { include }, which Amazon requires', async () => {
    // A bare array is accepted and IGNORED — the call succeeds and returns
    // every campaign, so the failure looks like "the filter did nothing".
    const { client, captured } = clientWithCapture({ campaigns: [] });
    await client.listAdGroups({ campaignIdFilter: ['123', '456'] });

    expect(captured[0].body['campaignIdFilter']).toEqual({
      include: ['123', '456'],
    });
  });

  it('excludes ARCHIVED by default', async () => {
    // An archived campaign is not one anyone is managing. Including them by
    // default makes every list longer and every count wrong for the question
    // usually being asked.
    const { client, captured } = clientWithCapture({ campaigns: [] });
    await client.listCampaigns();

    expect(captured[0].body['stateFilter']).toEqual({
      include: ['ENABLED', 'PAUSED'],
    });
  });

  it('honours an explicit request for archived campaigns', async () => {
    const { client, captured } = clientWithCapture({ campaigns: [] });
    await client.listCampaigns({ stateFilter: ['ARCHIVED'] });

    expect(captured[0].body['stateFilter']).toEqual({ include: ['ARCHIVED'] });
  });

  it('omits absent filters rather than sending empty ones', async () => {
    // `{ include: [] }` is not the same as no filter: an empty include matches
    // nothing, so sending one for an unspecified filter returns zero rows.
    const { client, captured } = clientWithCapture({ adGroups: [] });
    await client.listAdGroups();

    expect(captured[0].body).not.toHaveProperty('campaignIdFilter');
    expect(captured[0].body).not.toHaveProperty('adGroupIdFilter');
  });
});

describe('responses', () => {
  it('reads the collection under its own key', async () => {
    // `nextToken` is no longer returned to callers — it is followed. See the
    // pagination block below for that contract.
    const { client } = clientWithCapture({
      campaigns: [{ campaignId: '1' }, { campaignId: '2' }],
      totalResults: 2,
    });
    const result = await client.listCampaigns();

    expect(result.items).toHaveLength(2);
    expect(result.totalResults).toBe(2);
  });

  it('returns an empty list rather than undefined when the key is absent', async () => {
    // Callers map over `items`. Amazon omits the key entirely when there are no
    // results, and an undefined here becomes a TypeError at the call site.
    const { client } = clientWithCapture({});
    const result = await client.listCampaigns();

    expect(result.items).toEqual([]);
  });

  it('keeps per-campaign errors alongside successes for budget usage', async () => {
    // This endpoint degrades per row: one bad campaign id does not fail the
    // call, so discarding the error array loses the only signal that a
    // requested campaign was not answered.
    const { client } = clientWithCapture({
      success: [{ campaignId: '1', budgetUsagePercent: 42 }],
      error: [{ campaignId: '2', code: 'NOT_FOUND' }],
    });
    const result = await client.getCampaignBudgetUsage(['1', '2']);

    expect(result.usage).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});

/**
 * Pagination. The client follows `nextToken` to the end rather than handing the
 * caller one page, because Amazon reports `totalResults` for the WHOLE set — so
 * a single page arrives beside an accurate total, and any breakdown built from
 * it disagrees with its own headline figure while nothing errors.
 *
 * The live account has 172 campaigns and fits in one page, which is exactly why
 * this needs tests: the bug is invisible until an account outgrows a page.
 */
function pagingClient(pages: Array<Record<string, unknown>>) {
  const calls: Array<Record<string, unknown>> = [];
  const client = new AmazonAdsApiClient({
    clientId: 'c',
    marketplaceId: 'ATVPDKIKX0DER',
    profileId: '1',
    accessToken: 't',
  });
  let index = 0;
  (client as unknown as { httpClient: unknown }).httpClient = {
    post: vi.fn(async (_p: string, body: Record<string, unknown>) => {
      calls.push(body);
      return { data: pages[Math.min(index++, pages.length - 1)] };
    }),
    get: vi.fn(),
  };
  return { client, calls };
}

describe('pagination', () => {
  it('follows nextToken and returns every page', async () => {
    const { client } = pagingClient([
      { campaigns: [{ campaignId: '1' }], nextToken: 'p2', totalResults: 3 },
      { campaigns: [{ campaignId: '2' }], nextToken: 'p3', totalResults: 3 },
      { campaigns: [{ campaignId: '3' }], totalResults: 3 },
    ]);

    const result = await client.listCampaigns();

    expect(result.items).toHaveLength(3);
    expect(result.truncated).toBeUndefined();
  });

  it('resends the filters with each page', async () => {
    // Ads v3 expects the original body PLUS the token, unlike SP-API where a
    // continuation token travels alone. Dropping the filters partway through
    // would widen the result set mid-walk.
    const { client, calls } = pagingClient([
      { adGroups: [{ adGroupId: '1' }], nextToken: 'p2' },
      { adGroups: [{ adGroupId: '2' }] },
    ]);

    await client.listAdGroups({ campaignIdFilter: ['123'] });

    expect(calls).toHaveLength(2);
    expect(calls[1]['campaignIdFilter']).toEqual({ include: ['123'] });
    expect(calls[1]['nextToken']).toBe('p2');
  });

  it('stops at the page bound and flags the result as truncated', async () => {
    // Never silently: a partial list that does not say so is the failure this
    // whole change exists to prevent.
    const { client, calls } = pagingClient([
      {
        campaigns: [{ campaignId: 'x' }],
        nextToken: 'always',
        totalResults: 99999,
      },
    ]);

    const result = await client.listCampaigns();

    expect(result.truncated).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(20);
    expect(result.totalResults).toBe(99999);
  });

  it('stops when a page comes back empty even with a token', async () => {
    // A token with no rows makes no progress; looping on it burns the bound.
    const { client, calls } = pagingClient([
      { campaigns: [], nextToken: 'still-here' },
    ]);

    const result = await client.listCampaigns();

    expect(result.items).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('single page still reports totalResults', async () => {
    // The 172-campaign case: one page, complete, not truncated.
    const { client } = pagingClient([
      {
        campaigns: Array.from({ length: 172 }, (_, i) => ({
          campaignId: `${i}`,
        })),
        totalResults: 172,
      },
    ]);

    const result = await client.listCampaigns();

    expect(result.items).toHaveLength(172);
    expect(result.totalResults).toBe(172);
    expect(result.truncated).toBeUndefined();
  });
});

/**
 * Reporting v3 (#86 stage 2), two-step.
 *
 * Requesting and fetching are separate calls because generation takes minutes
 * and the chat route has 300 seconds for an entire turn. Waiting inside the
 * tool spent the whole budget on one call and still often lost — and losing
 * threw away the report id, which is the only handle on work Amazon has already
 * started billing for.
 *
 * The failures worth pinning are still arithmetic: an ACOS against the wrong
 * attribution window, and an ACOS of zero standing in for "no sales". Both
 * produce a confident number that reverses the ranking a seller asked for.
 */
function reportingClient(opts: {
  status?: string;
  rows?: Array<Record<string, unknown>>;
  failureReason?: string;
}) {
  const posts: Array<{ path: string; body: any; headers: any }> = [];
  const client = new AmazonAdsApiClient({
    clientId: 'c',
    marketplaceId: 'ATVPDKIKX0DER',
    profileId: '1',
    accessToken: 't',
  });
  (client as unknown as { httpClient: unknown }).httpClient = {
    post: vi.fn(async (path: string, body: any, config: any) => {
      posts.push({ path, body, headers: config?.headers ?? {} });
      return { data: { reportId: 'r-1', status: 'PENDING' } };
    }),
    get: vi.fn(async () => ({
      data: {
        reportId: 'r-1',
        status: opts.status ?? 'COMPLETED',
        ...(opts.status === undefined || opts.status === 'COMPLETED'
          ? { url: 'https://s3/report' }
          : {}),
        ...(opts.failureReason ? { failureReason: opts.failureReason } : {}),
      },
    })),
  };
  // The download bypasses the client deliberately (presigned S3), so stub it.
  (client as any).downloadAdsReport = vi.fn(async () => opts.rows ?? []);
  return { client, posts };
}

describe('requesting a report', () => {
  it('returns immediately with an id rather than waiting', async () => {
    const { client, posts } = reportingClient({});
    const result = await client.requestPerformanceReport({
      level: 'campaign',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(result.reportId).toBe('r-1');
    // Exactly one call: the create. No polling in this step.
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/reporting/reports');
  });

  it('sends the media type Amazon documents', async () => {
    const { client, posts } = reportingClient({});
    await client.requestPerformanceReport({
      level: 'campaign',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(posts[0].headers['Content-Type']).toBe(
      'application/vnd.createasyncreportrequest.v3+json'
    );
  });

  it('asks for the columns matching the requested window', async () => {
    // Requesting sales14d and reading sales7d would report a different number
    // than the one asked for, with nothing to show it happened.
    const { client, posts } = reportingClient({});
    await client.requestPerformanceReport({
      level: 'campaign',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      attribution: '7d',
    });

    const cols = posts[0].body.configuration.columns;
    expect(cols).toContain('sales7d');
    expect(cols).toContain('purchases7d');
    expect(cols).not.toContain('sales14d');
  });

  it('defaults to 14d and says so', async () => {
    const { client, posts } = reportingClient({});
    const result = await client.requestPerformanceReport({
      level: 'campaign',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(result.attribution).toBe('14d');
    expect(posts[0].body.configuration.columns).toContain('sales14d');
  });

  it('requests SUMMARY, not a row per campaign per day', async () => {
    // 172 campaigns x 30 days is 5,160 rows for the model to aggregate itself.
    const { client, posts } = reportingClient({});
    await client.requestPerformanceReport({
      level: 'campaign',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(posts[0].body.configuration.timeUnit).toBe('SUMMARY');
    expect(posts[0].body.configuration.format).toBe('GZIP_JSON');
  });

  it('groups search term reports by searchTerm', async () => {
    const { client, posts } = reportingClient({});
    await client.requestPerformanceReport({
      level: 'searchTerm',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(posts[0].body.configuration.reportTypeId).toBe('spSearchTerm');
    expect(posts[0].body.configuration.groupBy).toEqual(['searchTerm']);
  });
});

describe('fetching a report', () => {
  it('reports not-ready as a normal answer, not an error', async () => {
    const { client } = reportingClient({ status: 'PROCESSING' });
    const result = await client.fetchPerformanceReport('r-1');

    expect(result.ready).toBe(false);
    expect(result).toMatchObject({ status: 'PROCESSING' });
  });

  it('surfaces the failure reason rather than a generic error', async () => {
    const { client } = reportingClient({
      status: 'FAILED',
      failureReason: 'bad columns',
    });
    const result = await client.fetchPerformanceReport('r-1');

    expect(result).toMatchObject({
      ready: false,
      status: 'FAILED',
      failureReason: 'bad columns',
    });
  });

  it('recovers the attribution window from the payload itself', async () => {
    // Not threaded back through the caller: a caller that forgot, or a model
    // that guessed, would normalise against a window Amazon never reported and
    // the result would look entirely reasonable.
    const { client } = reportingClient({
      rows: [{ campaignId: '1', cost: 25, sales7d: 100 }],
    });
    const result = await client.fetchPerformanceReport('r-1');

    expect(result).toMatchObject({ ready: true, attribution: '7d' });
  });
});

describe('performance arithmetic', () => {
  async function rowsFrom(rows: Array<Record<string, unknown>>) {
    const { client } = reportingClient({ rows });
    const result = await client.fetchPerformanceReport('r-1');
    if (!result.ready) throw new Error('expected ready');
    return result.rows;
  }

  it('computes acos from the window actually present', async () => {
    // 25/100 on the 14d window, NOT 25/400 on the 30d column beside it.
    const rows = await rowsFrom([
      { campaignId: '1', cost: 25, sales14d: 100, sales30d: 400 },
    ]);

    expect(rows[0].acos).toBeCloseTo(0.25, 6);
  });

  it('leaves acos UNDEFINED when there are no sales', async () => {
    // Zero reads as perfectly efficient for the rows that are pure waste, so
    // sorting ascending would put the worst campaigns first and call them best.
    const rows = await rowsFrom([
      { campaignId: 'waste', cost: 90, sales14d: 0 },
    ]);

    expect(rows[0].acos).toBeUndefined();
    expect(rows[0].cost).toBe(90);
    expect(rows[0].sales).toBe(0);
  });

  it('does not rank a wasteful row above a profitable one', async () => {
    const rows = await rowsFrom([
      { campaignId: 'waste', cost: 90, sales14d: 0 },
      { campaignId: 'good', cost: 10, sales14d: 100 },
    ]);

    expect(rows.find((r) => r['campaignId'] === 'waste')?.acos).toBeUndefined();
    expect(rows.find((r) => r['campaignId'] === 'good')?.acos).toBeCloseTo(
      0.1,
      6
    );
  });

  it('coerces string numerics, which the JSON report does emit', async () => {
    const rows = await rowsFrom([
      { campaignId: '1', cost: '12.50', sales14d: '50', clicks: '5' },
    ]);

    expect(rows[0].cost).toBe(12.5);
    expect(rows[0].acos).toBeCloseTo(0.25, 6);
  });
});

/**
 * Writes (#86 stage 3).
 *
 * The failure worth pinning is the 207: Amazon applies each item of a batch
 * independently and returns success and error arrays TOGETHER, so a client
 * that only distinguishes "resolved" from "thrown" reads a half-applied batch
 * as fully applied. Everything else here guards the request shape — vendored
 * media types, the collection-key envelope — where a mistake produces a bare
 * 415/400 at the far end of an HTTP call.
 */
describe('writes', () => {
  it('updates campaigns with PUT and the campaign media type', async () => {
    const { client, captured } = clientWithCapture({
      campaigns: { success: [], error: [] },
    });
    await client.updateCampaigns([{ campaignId: 'c1', state: 'PAUSED' }]);

    expect(captured[0].method).toBe('put');
    expect(captured[0].path).toBe('/sp/campaigns');
    expect(captured[0].headers.Accept).toBe(
      'application/vnd.spCampaign.v3+json'
    );
    expect(captured[0].headers['Content-Type']).toBe(
      'application/vnd.spCampaign.v3+json'
    );
  });

  it('wraps the batch under the collection key', async () => {
    const { client, captured } = clientWithCapture({
      keywords: { success: [], error: [] },
    });
    await client.updateKeywords([{ keywordId: 'k1', bid: 0.75 }]);

    expect(captured[0].body).toEqual({
      keywords: [{ keywordId: 'k1', bid: 0.75 }],
    });
  });

  it('translates dailyBudget into the DAILY budget envelope', async () => {
    const { client, captured } = clientWithCapture({
      campaigns: { success: [], error: [] },
    });
    await client.updateCampaigns([{ campaignId: 'c1', dailyBudget: 12.5 }]);

    expect(captured[0].body['campaigns']).toEqual([
      { campaignId: 'c1', budget: { budget: 12.5, budgetType: 'DAILY' } },
    ]);
  });

  it('returns both halves of a 207 rather than only the successes', async () => {
    const { client } = clientWithCapture({
      keywords: {
        success: [{ index: 0, keywordId: 'k1' }],
        error: [{ index: 1, errors: [{ errorType: 'BID_TOO_LOW' }] }],
      },
    });
    const result = await client.updateKeywords([
      { keywordId: 'k1', bid: 0.5 },
      { keywordId: 'k2', bid: 0.01 },
    ]);

    expect(result.success).toHaveLength(1);
    expect(result.error).toHaveLength(1);
  });

  it('answers empty arrays when Amazon omits a half, not undefined', async () => {
    const { client } = clientWithCapture({
      keywords: { success: [{ index: 0, keywordId: 'k1' }] },
    });
    const result = await client.updateKeywords([{ keywordId: 'k1', bid: 1 }]);

    expect(result.error).toEqual([]);
  });

  it('refuses an empty batch locally', async () => {
    const { client, captured } = clientWithCapture({});

    await expect(client.updateKeywords([])).rejects.toThrow(/empty/);
    expect(captured).toHaveLength(0);
  });

  it('refuses an update that changes nothing', async () => {
    // Amazon accepts a bare-id update and reports it as success — an
    // "applied" that applied nothing. Catch it before the wire.
    const { client, captured } = clientWithCapture({});

    await expect(
      client.updateCampaigns([{ campaignId: 'c1' }])
    ).rejects.toThrow(/changes nothing/);
    await expect(client.updateKeywords([{ keywordId: 'k1' }])).rejects.toThrow(
      /changes nothing/
    );
    await expect(client.updateAdGroups([{ adGroupId: 'g1' }])).rejects.toThrow(
      /changes nothing/
    );
    expect(captured).toHaveLength(0);
  });

  it('refuses non-positive money before the wire', async () => {
    const { client, captured } = clientWithCapture({});

    await expect(
      client.updateKeywords([{ keywordId: 'k1', bid: 0 }])
    ).rejects.toThrow(/positive/);
    await expect(
      client.updateCampaigns([{ campaignId: 'c1', dailyBudget: -5 }])
    ).rejects.toThrow(/positive/);
    expect(captured).toHaveLength(0);
  });

  it('creates negative keywords ENABLED, with POST', async () => {
    // A paused negative blocks nothing; creating one paused would report
    // success while changing no delivery at all.
    const { client, captured } = clientWithCapture({
      negativeKeywords: { success: [], error: [] },
    });
    await client.createNegativeKeywords([
      {
        campaignId: 'c1',
        adGroupId: 'g1',
        keywordText: 'free',
        matchType: 'NEGATIVE_EXACT',
      },
    ]);

    expect(captured[0].method).toBe('post');
    expect(captured[0].path).toBe('/sp/negativeKeywords');
    expect(captured[0].body['negativeKeywords']).toEqual([
      {
        campaignId: 'c1',
        adGroupId: 'g1',
        keywordText: 'free',
        matchType: 'NEGATIVE_EXACT',
        state: 'ENABLED',
      },
    ]);
  });

  it('caps a batch at 100 so an approval stays reviewable', async () => {
    const { client, captured } = clientWithCapture({});
    const batch = Array.from({ length: 101 }, (_, i) => ({
      keywordId: `k${i}`,
      state: 'PAUSED' as const,
    }));

    await expect(client.updateKeywords(batch)).rejects.toThrow(/100/);
    expect(captured).toHaveLength(0);
  });
});

/**
 * Creating a campaign tree (#146).
 *
 * Everything above this point can be undone by a second call. None of this can:
 * Amazon has no delete that returns a campaign to not-existing, and archiving is
 * permanent and deliberately unexposed. So the tests are about the two things
 * that keep it safe — nothing is created ENABLED, and a partial tree is reported
 * as what it is rather than as success.
 */
describe('createCampaignTree', () => {
  /** Responses per endpoint, so each level can succeed or fail independently. */
  function treeClient(byPath: Record<string, unknown>) {
    const captured: Captured[] = [];
    const client = new AmazonAdsApiClient({
      clientId: 'amzn1.application-oa2-client.test',
      marketplaceId: 'ATVPDKIKX0DER',
      profileId: '967757046531288',
      accessToken: 'token',
    });
    const post = async (path: string, body: unknown, config: unknown) => {
      captured.push({
        method: 'post',
        path,
        body: (body ?? {}) as Record<string, unknown>,
        headers: ((config as { headers?: Record<string, string> })?.headers ??
          {}) as Record<string, string>,
      });
      return { data: byPath[path] ?? {} };
    };
    (client as unknown as { httpClient: unknown }).httpClient = {
      post: vi.fn(post),
      put: vi.fn(post),
      get: vi.fn(async () => ({ data: {} })),
    };
    return { client, captured };
  }

  const ok = {
    '/sp/campaigns': {
      campaigns: { success: [{ campaignId: 'C1' }], error: [] },
    },
    '/sp/adGroups': { adGroups: { success: [{ adGroupId: 'G1' }], error: [] } },
    '/sp/productAds': {
      productAds: { success: [{ adId: 'A1' }], error: [] },
    },
    '/sp/keywords': { keywords: { success: [{ keywordId: 'K1' }], error: [] } },
  };

  const manual = {
    name: 'SP - Exact - French Press',
    targetingType: 'MANUAL' as const,
    dailyBudget: 25,
    adGroup: { name: 'Core', defaultBid: 0.75 },
    products: [{ sku: 'FP-24OZ' }],
    keywords: [{ keywordText: 'french press', matchType: 'EXACT' as const }],
  };

  it('creates every level PAUSED, whatever was asked for', async () => {
    // The property that converts an irreversible create into a reversible one:
    // a paused tree spends nothing, so a mistake costs a cleanup and not money.
    const { client, captured } = treeClient(ok);
    await client.createCampaignTree(manual);

    expect(captured).toHaveLength(4);
    for (const call of captured) {
      const collection = Object.values(call.body)[0] as Array<
        Record<string, unknown>
      >;
      for (const item of collection) {
        expect(item.state).toBe('PAUSED');
      }
    }
  });

  it('reports a complete tree as servable, and says it is not running', async () => {
    const { client } = treeClient(ok);
    const result = await client.createCampaignTree(manual);

    expect(result.servable).toBe(true);
    expect(result.campaign.campaignId).toBe('C1');
    expect(result.adGroup.adGroupId).toBe('G1');
    expect(result.productAds.created).toBe(1);
    expect(result.keywords.created).toBe(1);
    // "Created" reads as "running" and must not.
    expect(result.remediation.join(' ')).toMatch(/PAUSED and spending nothing/);
  });

  it('stops when the campaign fails, and says nothing was created', async () => {
    const { client, captured } = treeClient({
      '/sp/campaigns': {
        campaigns: {
          success: [],
          error: [
            {
              index: 0,
              errors: [
                { errorType: 'DUPLICATE_VALUE', message: 'name exists' },
              ],
            },
          ],
        },
      },
    });
    const result = await client.createCampaignTree(manual);

    expect(captured).toHaveLength(1);
    expect(result.campaign.created).toBe(false);
    expect(result.campaign.error).toContain('name exists');
    expect(result.servable).toBe(false);
    // The one clean failure: nothing exists, so nothing needs cleaning up.
    expect(result.remediation.join(' ')).toMatch(/Nothing was created/);
  });

  it('keeps the campaign id when the ad group fails, because there is no rollback', async () => {
    // Throwing here would discard the id of the thing Amazon already created,
    // which is the only handle for finishing or archiving it.
    const { client, captured } = treeClient({
      ...ok,
      '/sp/adGroups': {
        adGroups: {
          success: [],
          error: [{ index: 0, errors: [{ message: 'bid too low' }] }],
        },
      },
    });
    const result = await client.createCampaignTree(manual);

    expect(captured.map((c) => c.path)).toEqual([
      '/sp/campaigns',
      '/sp/adGroups',
    ]);
    expect(result.campaign.created).toBe(true);
    expect(result.campaign.campaignId).toBe('C1');
    expect(result.adGroup.created).toBe(false);
    expect(result.servable).toBe(false);
    expect(result.remediation.join(' ')).toContain('C1');
    expect(result.remediation.join(' ')).toMatch(
      /cannot archive|archive the campaign/
    );
  });

  it('is NOT servable when every product ad fails, even though the campaign exists', async () => {
    // The dangerous outcome: a campaign that looks created and can never show
    // an impression.
    const { client } = treeClient({
      ...ok,
      '/sp/productAds': {
        productAds: {
          success: [],
          error: [{ index: 0, errors: [{ message: 'sku not found' }] }],
        },
      },
    });
    const result = await client.createCampaignTree(manual);

    expect(result.campaign.created).toBe(true);
    expect(result.adGroup.created).toBe(true);
    expect(result.servable).toBe(false);
    expect(result.remediation.join(' ')).toMatch(/No product ads/);
  });

  it('is servable when only SOME product ads fail, and says which', async () => {
    const { client } = treeClient({
      ...ok,
      '/sp/productAds': {
        productAds: {
          success: [{ adId: 'A1' }],
          error: [{ index: 1, errors: [{ message: 'sku not found' }] }],
        },
      },
    });
    const result = await client.createCampaignTree({
      ...manual,
      products: [{ sku: 'FP-24OZ' }, { sku: 'GONE-SKU' }],
    });

    expect(result.servable).toBe(true);
    // Named by the caller's own label, not by index — "one of these failed" is
    // not an answer a seller can act on.
    expect(result.productAds.failures).toEqual([
      { item: 'GONE-SKU', error: 'sku not found' },
    ]);
  });

  it('is NOT servable when a MANUAL campaign gets no keywords', async () => {
    const { client } = treeClient({
      ...ok,
      '/sp/keywords': {
        keywords: {
          success: [],
          error: [{ index: 0, errors: [{ message: 'blocked term' }] }],
        },
      },
    });
    const result = await client.createCampaignTree(manual);

    expect(result.servable).toBe(false);
    expect(result.remediation.join(' ')).toMatch(/No keywords .* MANUAL/);
  });

  it('does not require keywords for an AUTO campaign', async () => {
    const { client, captured } = treeClient(ok);
    const result = await client.createCampaignTree({
      name: 'Auto - Discovery',
      targetingType: 'AUTO',
      dailyBudget: 10,
      adGroup: { name: 'Discovery', defaultBid: 0.5 },
      products: [{ sku: 'FP-24OZ' }],
    });

    expect(result.servable).toBe(true);
    expect(captured.map((c) => c.path)).not.toContain('/sp/keywords');
  });

  it('refuses combinations that could never serve, before creating anything', async () => {
    const cases: Array<
      [string, Parameters<AmazonAdsApiClient['createCampaignTree']>[0], RegExp]
    > = [
      ['no products', { ...manual, products: [] }, /can never serve/],
      [
        'MANUAL with no keywords',
        { ...manual, keywords: [] },
        /MANUAL but names no keywords/,
      ],
      [
        'AUTO with keywords',
        { ...manual, targetingType: 'AUTO' as const },
        /AUTO, which chooses its own targets/,
      ],
    ];

    for (const [, request, expected] of cases) {
      const { client, captured } = treeClient(ok);
      await expect(client.createCampaignTree(request)).rejects.toThrow(
        expected
      );
      // Refused locally: Amazon was never called, so there is nothing to clean up.
      expect(captured).toHaveLength(0);
    }
  });

  it('advertises the SKU rather than the ASIN when both are given', async () => {
    // A SKU identifies the seller's own listing; an ASIN identifies a product
    // several sellers may offer.
    const { client, captured } = treeClient(ok);
    await client.createCampaignTree({
      ...manual,
      products: [{ sku: 'FP-24OZ', asin: 'B0SOMETHING' }],
    });

    const call = captured.find((c) => c.path === '/sp/productAds');
    const [ad] = call?.body['productAds'] as Array<Record<string, unknown>>;
    expect(ad.sku).toBe('FP-24OZ');
    expect(ad.asin).toBeUndefined();
  });

  it('sends the vendored media type for product ads', async () => {
    const { client, captured } = treeClient(ok);
    await client.createCampaignTree(manual);

    const call = captured.find((c) => c.path === '/sp/productAds');
    expect(call?.headers.Accept).toBe('application/vnd.spProductAd.v3+json');
  });
});
