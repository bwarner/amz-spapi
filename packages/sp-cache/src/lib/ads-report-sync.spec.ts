import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adsRowsAsCsv,
  collectAdsReport,
  requestAdsReport,
  type AdsReportClient,
} from './ads-report-sync.js';
import {
  adsSyncStorage,
  adsRunId,
  overlapsIngestedWindow,
  type AdsSyncRun,
} from './ads-sync-store.js';
import { detectReportKind, parseReport } from './report-ingest.js';

/**
 * The ads report sync. Every failure here is a figure that looks plausible and
 * is not: a report paid for twice, rows counted twice, or a fetch that failed
 * presented as a seller with no ads activity.
 */

const USER = 'auth0|seller';
const PROFILE = '3986589984566633';
const WINDOW = { from: '2026-07-08', to: '2026-08-07' } as const;

let store: Map<string, AdsSyncRun>;

/** Ready rows shaped as the Ads API returns them — not as the console exports. */
const API_ROWS = [
  {
    searchTerm: 'panama geisha coffee',
    campaignId: '555251554086397',
    campaignName: 'SP - Broad - Gran Del Val',
    matchType: 'BROAD',
    impressions: 1200,
    clicks: 12,
    cost: 6.6,
    sales: 55,
    purchases: 1,
  },
  {
    searchTerm: '24 oz french press',
    campaignId: '429101978476912',
    campaignName: 'Auto - close match - French Press',
    matchType: 'BROAD',
    impressions: 800,
    clicks: 5,
    cost: 2.68,
    sales: 0,
    purchases: 0,
  },
];

function client(overrides: Partial<AdsReportClient> = {}): AdsReportClient {
  return {
    requestPerformanceReport: vi.fn(async () => ({ reportId: 'rep-1' })),
    fetchPerformanceReport: vi.fn(async () => ({
      ready: true as const,
      rows: API_ROWS,
    })),
    ...overrides,
  };
}

beforeEach(() => {
  store = new Map();
  vi.spyOn(adsSyncStorage, 'getDocument').mockImplementation(
    async (_scope, _collection, key) =>
      (store.get(key as string) ?? null) as never
  );
  vi.spyOn(adsSyncStorage, 'upsertDocument').mockImplementation(
    async (_scope, _collection, key, value) => {
      store.set(key as string, value as AdsSyncRun);
      return undefined as never;
    }
  );
});

describe('requestAdsReport', () => {
  it('records the report id, because it is the only handle on paid work', async () => {
    const result = await requestAdsReport({
      client: client(),
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
    });

    expect(result.started).toBe(true);
    const run = store.get(
      adsRunId({
        userId: USER,
        profileId: PROFILE,
        kind: 'search-term',
        ...WINDOW,
      })
    );
    expect(run?.status).toBe('requested');
    expect(run?.reportId).toBe('rep-1');
  });

  it('will not pay twice for a window already ingested', async () => {
    const runId = adsRunId({
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
    });
    store.set(runId, {
      runId,
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
      status: 'ingested',
      requestedAt: '2026-08-08T05:00:00.000Z',
      updatedAt: '2026-08-08T05:02:00.000Z',
    });

    const spy = vi.fn(async () => ({ reportId: 'rep-2' }));
    const result = await requestAdsReport({
      client: client({ requestPerformanceReport: spy }),
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
    });

    expect(result.started).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('will not orphan a report Amazon is already building', async () => {
    const runId = adsRunId({
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
    });
    store.set(runId, {
      runId,
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
      status: 'requested',
      reportId: 'rep-live',
      requestedAt: '2026-08-08T05:00:00.000Z',
      updatedAt: '2026-08-08T05:00:00.000Z',
    });

    const spy = vi.fn(async () => ({ reportId: 'rep-second' }));
    const result = await requestAdsReport({
      client: client({ requestPerformanceReport: spy }),
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
    });

    expect(result.started).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(result.run?.reportId).toBe('rep-live');
  });

  it('records a failed request rather than leaving the window looking unattempted', async () => {
    // The whole point of the run record: "we could not fetch" must not read
    // downstream as "the seller ran no ads".
    const failing = client({
      requestPerformanceReport: vi.fn(async () => {
        throw new Error('429 Too Many Requests');
      }),
    });

    await expect(
      requestAdsReport({
        client: failing,
        userId: USER,
        profileId: PROFILE,
        kind: 'search-term',
        ...WINDOW,
      })
    ).rejects.toThrow(/429/);

    const run = store.get(
      adsRunId({
        userId: USER,
        profileId: PROFILE,
        kind: 'search-term',
        ...WINDOW,
      })
    );
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatch(/429/);
  });
});

describe('adsRowsAsCsv', () => {
  it('produces something the registry recognises as a search-term report', async () => {
    const csv = adsRowsAsCsv({ rows: API_ROWS, ...WINDOW });

    // API column names differ from the console export's, so the registry
    // aliases are what make one ingest path serve both sources.
    expect(detectReportKind(csv).kind).toBe('search-term');

    const parsed = parseReport({
      text: csv,
      kind: 'search-term',
      sellerId: 'A1SELLER',
    });
    const [first] = parsed.rows;
    expect(first.fields.searchTerm).toBe('panama geisha coffee');
    expect(first.numbers?.spend).toBeCloseTo(6.6);
    expect(first.numbers?.sales).toBeCloseTo(55);
    // `purchases` is the API's name for orders. Without that alias every
    // graduation rule would read zero orders and harvest nothing.
    expect(first.numbers?.orders).toBe(1);
  });

  it('carries the request window, since a SUMMARY report has no date of its own', () => {
    const csv = adsRowsAsCsv({ rows: API_ROWS, ...WINDOW });
    const [header, firstRow] = csv.split('\n');

    expect(header.startsWith('startDate,endDate,')).toBe(true);
    expect(firstRow.startsWith('2026-07-08,2026-08-07,')).toBe(true);
  });

  it('escapes a term containing a comma rather than shifting every later column', () => {
    const csv = adsRowsAsCsv({
      rows: [{ searchTerm: 'french press, stainless', clicks: 3 }],
      ...WINDOW,
    });
    expect(csv).toContain('"french press, stainless"');
  });
});

describe('collectAdsReport', () => {
  const seed = (
    status: AdsSyncRun['status'],
    extra: Partial<AdsSyncRun> = {}
  ) => {
    const runId = adsRunId({
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
    });
    store.set(runId, {
      runId,
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      ...WINDOW,
      status,
      reportId: 'rep-1',
      requestedAt: '2026-08-08T05:00:00.000Z',
      updatedAt: '2026-08-08T05:00:00.000Z',
      ...extra,
    });
    return runId;
  };

  const collectWith = (c: AdsReportClient, maxPolls?: number) =>
    collectAdsReport({
      client: c,
      userId: USER,
      profileId: PROFILE,
      kind: 'search-term',
      sellerId: 'A1SELLER',
      maxPolls,
      ...WINDOW,
    });

  it('treats "not ready" as a normal answer and counts the poll', async () => {
    seed('requested');
    const result = await collectWith(
      client({
        fetchPerformanceReport: vi.fn(async () => ({
          ready: false as const,
          status: 'PROCESSING',
        })),
      })
    );

    expect(result.state).toBe('pending');
    expect(result.run.status).toBe('requested');
    expect(result.run.polls).toBe(1);
  });

  it('stops on Amazon reporting FAILED rather than polling a report that will never arrive', async () => {
    seed('requested');
    const result = await collectWith(
      client({
        fetchPerformanceReport: vi.fn(async () => ({
          ready: false as const,
          status: 'FAILED',
          failureReason: 'Date range exceeds retention',
        })),
      })
    );

    expect(result.state).toBe('failed');
    expect(result.run.status).toBe('rejected');
    expect(result.run.error).toMatch(/retention/);
  });

  it('gives up after the poll ceiling instead of looping forever', async () => {
    seed('requested', { polls: 4 });
    const result = await collectWith(
      client({
        fetchPerformanceReport: vi.fn(async () => ({
          ready: false as const,
          status: 'PROCESSING',
        })),
      }),
      5
    );

    expect(result.state).toBe('failed');
    expect(result.run.status).toBe('failed');
    expect(result.run.error).toMatch(/still PROCESSING after 5 polls/);
  });

  it('is idempotent once ingested — a retried collect neither re-ingests nor reports an empty report', async () => {
    seed('ingested', { rowsNew: 41 });
    const spy = vi.fn();
    const result = await collectWith(
      client({ fetchPerformanceReport: spy as never })
    );

    expect(result.state).toBe('ingested');
    expect(spy).not.toHaveBeenCalled();
    // No fabricated outcome: absent means "this call did not ingest", which is
    // different from "the report held nothing".
    expect(
      result.state === 'ingested' ? result.outcome : undefined
    ).toBeUndefined();
    expect(result.run.rowsNew).toBe(41);
  });

  it('refuses to collect a run that was never requested', async () => {
    seed('failed', { reportId: undefined });
    await expect(collectWith(client())).rejects.toThrow(/never requested/);
  });
});

describe('window ownership (the double-count guard)', () => {
  it('finds any overlap, not just containment', () => {
    const owned = [{ from: '2026-07-08', to: '2026-08-07' }];

    // Half a synced window re-imported is half the rows doubled.
    expect(
      overlapsIngestedWindow(owned, { from: '2026-08-01', to: '2026-08-20' })
    ).toEqual(owned[0]);
    expect(
      overlapsIngestedWindow(owned, { from: '2026-06-01', to: '2026-07-08' })
    ).toEqual(owned[0]);
    expect(
      overlapsIngestedWindow(owned, { from: '2026-08-08', to: '2026-08-20' })
    ).toBeUndefined();
  });

  it('demonstrates WHY ownership is needed: the two sources do not dedupe', () => {
    // The same facts, as the API returns them and as the console exports
    // them. Row identity is built from raw headers and raw values
    // (`rowIdFor`), so these hash differently and both would be stored —
    // doubling every figure. Nothing in the ingest path can prevent that,
    // which is what the run record's window ownership is for.
    const apiCsv = adsRowsAsCsv({ rows: [API_ROWS[0]], ...WINDOW });
    const consoleCsv =
      '"Start Date","End Date","Campaign Name","Customer Search Term",' +
      '"Impressions","Clicks","Spend","7 Day Total Sales","7 Day Total Orders (#)"\n' +
      '"Jul 8, 2026","Aug 7, 2026","SP - Broad - Gran Del Val",' +
      '"panama geisha coffee","1200","12","$6.60","$55.00","1"';

    const fromApi = parseReport({
      text: apiCsv,
      kind: 'search-term',
      sellerId: 'A1SELLER',
    });
    const fromConsole = parseReport({
      text: consoleCsv,
      kind: 'search-term',
      sellerId: 'A1SELLER',
    });

    // Same search term, same spend — different identity.
    expect(fromApi.rows[0].fields.searchTerm).toBe(
      fromConsole.rows[0].fields.searchTerm
    );
    expect(fromApi.rows[0].numbers?.spend).toBeCloseTo(
      fromConsole.rows[0].numbers?.spend as number
    );
    expect(fromApi.rows[0].rowId).not.toBe(fromConsole.rows[0].rowId);
  });
});
