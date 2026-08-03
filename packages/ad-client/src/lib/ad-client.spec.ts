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

  // Replace the transport, keeping the class's own header and body assembly.
  (client as unknown as { httpClient: unknown }).httpClient = {
    post: vi.fn(async (path: string, body: unknown, config: unknown) => {
      captured.push({
        path,
        body: (body ?? {}) as Record<string, unknown>,
        headers: ((config as { headers?: Record<string, string> })?.headers ??
          {}) as Record<string, string>,
      });
      return { data: responseData };
    }),
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
 * Reporting v3 (#86 stage 2).
 *
 * Two things here are wrong in ways nothing throws: an ACOS computed against
 * the wrong attribution window, and an ACOS of zero standing in for "no sales".
 * Both produce a confident number that reverses the ranking a seller asked for.
 */
function reportingClient(opts: {
  statuses?: string[];
  rows?: Array<Record<string, unknown>>;
}) {
  const posts: Array<{ path: string; body: any; headers: any }> = [];
  const client = new AmazonAdsApiClient({
    clientId: 'c',
    marketplaceId: 'ATVPDKIKX0DER',
    profileId: '1',
    accessToken: 't',
  });
  const statuses = opts.statuses ?? ['COMPLETED'];
  let poll = 0;
  (client as unknown as { httpClient: unknown }).httpClient = {
    post: vi.fn(async (path: string, body: any, config: any) => {
      posts.push({ path, body, headers: config?.headers ?? {} });
      return { data: { reportId: 'r-1', status: 'PENDING' } };
    }),
    get: vi.fn(async () => {
      const status = statuses[Math.min(poll++, statuses.length - 1)];
      return {
        data: {
          reportId: 'r-1',
          status,
          ...(status === 'COMPLETED' ? { url: 'https://s3/report' } : {}),
          ...(status === 'FAILED' ? { failureReason: 'bad columns' } : {}),
        },
      };
    }),
  };
  // The download bypasses the client on purpose (presigned S3), so stub it.
  (client as any).downloadAdsReport = vi.fn(async () => opts.rows ?? []);
  return { client, posts };
}

describe('reporting requests', () => {
  it('sends the create media type Amazon documents', async () => {
    const { client, posts } = reportingClient({ rows: [] });
    await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(posts[0].path).toBe('/reporting/reports');
    expect(posts[0].headers['Content-Type']).toBe(
      'application/vnd.createasyncreportrequest.v3+json'
    );
  });

  it('asks for the columns matching the requested attribution window', async () => {
    // Requesting sales14d and then reading sales7d would silently report a
    // different number than the one asked for.
    const { client, posts } = reportingClient({ rows: [] });
    await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      attribution: '7d',
    });

    const cols = posts[0].body.configuration.columns;
    expect(cols).toContain('sales7d');
    expect(cols).toContain('purchases7d');
    expect(cols).not.toContain('sales14d');
  });

  it('defaults to 14d and reports which window it used', async () => {
    const { client, posts } = reportingClient({ rows: [] });
    const result = await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(result.attribution).toBe('14d');
    expect(posts[0].body.configuration.columns).toContain('sales14d');
  });

  it('requests SUMMARY, not a row per campaign per day', async () => {
    // 172 campaigns x 30 days is 5,160 rows the model would have to aggregate
    // itself, badly and at length.
    const { client, posts } = reportingClient({ rows: [] });
    await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(posts[0].body.configuration.timeUnit).toBe('SUMMARY');
    expect(posts[0].body.configuration.format).toBe('GZIP_JSON');
  });

  it('polls until COMPLETED', async () => {
    // Fake timers because the real backoff waits 3s then 4.5s. Making the test
    // sit through that would buy nothing except a slow suite.
    vi.useFakeTimers();
    try {
      const { client } = reportingClient({
        statuses: ['PENDING', 'PROCESSING', 'COMPLETED'],
        rows: [{ campaignId: '1', cost: 10, sales14d: 40 }],
      });

      const pending = client.getCampaignPerformance({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        timeoutMs: 60_000,
      });
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;

      expect(result.rows).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces the failure reason rather than a generic error', async () => {
    const { client } = reportingClient({ statuses: ['FAILED'] });

    await expect(
      client.getCampaignPerformance({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      })
    ).rejects.toThrow(/bad columns/);
  });
});

describe('performance arithmetic', () => {
  it('computes acos from the requested window', async () => {
    const { client } = reportingClient({
      rows: [{ campaignId: '1', cost: 25, sales14d: 100, sales30d: 400 }],
    });

    const { rows } = await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    // 25/100 on the 14d window, NOT 25/400 on the 30d column sitting beside it.
    expect(rows[0].acos).toBeCloseTo(0.25, 6);
  });

  it('leaves acos UNDEFINED when there are no sales', async () => {
    // The trap: 0 reads as perfectly efficient for the rows that are pure
    // waste, so sorting by acos ascending would put the worst campaigns first
    // and call them the best.
    const { client } = reportingClient({
      rows: [{ campaignId: 'waste', cost: 90, sales14d: 0 }],
    });

    const { rows } = await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(rows[0].acos).toBeUndefined();
    expect(rows[0].cost).toBe(90);
    expect(rows[0].sales).toBe(0);
  });

  it('does not rank a wasteful row above a profitable one', async () => {
    // The consequence of the above, stated as the behaviour that matters.
    const { client } = reportingClient({
      rows: [
        { campaignId: 'waste', cost: 90, sales14d: 0 },
        { campaignId: 'good', cost: 10, sales14d: 100 },
      ],
    });

    const { rows } = await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    const waste = rows.find((r) => r['campaignId'] === 'waste');
    const good = rows.find((r) => r['campaignId'] === 'good');
    expect(waste?.acos).toBeUndefined();
    expect(good?.acos).toBeCloseTo(0.1, 6);
  });

  it('coerces string numerics, which the JSON report does emit', async () => {
    const { client } = reportingClient({
      rows: [{ campaignId: '1', cost: '12.50', sales14d: '50', clicks: '5' }],
    });

    const { rows } = await client.getCampaignPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(rows[0].cost).toBe(12.5);
    expect(rows[0].acos).toBeCloseTo(0.25, 6);
  });

  it('search term reports group by searchTerm', async () => {
    const { client, posts } = reportingClient({ rows: [] });
    await client.getSearchTermPerformance({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });

    expect(posts[0].body.configuration.reportTypeId).toBe('spSearchTerm');
    expect(posts[0].body.configuration.groupBy).toEqual(['searchTerm']);
  });
});
