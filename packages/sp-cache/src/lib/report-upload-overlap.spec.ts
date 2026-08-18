import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestReportBuffer, isIngestError } from './report-sync.js';
import { adsSyncStorage, type AdsSyncRun } from './ads-sync-store.js';
import { reportStorage } from './report-store.js';

/**
 * The upload-path double-count guard (#145).
 *
 * The failure it exists to prevent is invisible after the fact: row identity is
 * built from RAW headers and values, so a console export ("Customer Search
 * Term", "$278.25") and an API pull ("searchTerm", "278.25") of the SAME day
 * never collide. Dedup does not fire, the rows both land, and the seller reads
 * double the spend off two figures that each look entirely plausible.
 *
 * Nothing downstream can tell them apart, so every case here is about catching
 * it before the rows exist — or, where the window cannot be known, saying so.
 */

const USER = 'auth0|seller';
const SELLER = 'A2HXBWIE3KMLKV';
const PROFILE = '967757046531288';

/** A console search-term export — the spelling a seller downloads. */
const SEARCH_TERM_HEADER =
  '"Start Date","End Date","Portfolio name","Campaign Name","Ad Group Name",' +
  '"Targeting","Match Type","Customer Search Term","Impressions","Clicks",' +
  '"Spend","7 Day Total Sales "';

function searchTermCsv(dates: string[]): Buffer {
  const rows = dates.map(
    (date) =>
      `"${date}","${date}","Coffee","SP - Broad","Ad Group 1","geisha",` +
      `"BROAD","panama geisha coffee","1200","12","6.60","55.00"`
  );
  return Buffer.from([SEARCH_TERM_HEADER, ...rows].join('\n'), 'utf8');
}

/**
 * The campaign export, which dates rows with a SPAN rather than a day — the
 * case the guard cannot resolve to a window.
 */
function campaignCsv(): Buffer {
  const header =
    '"Start Date","End Date","Campaign Name","Ad Group Name","Portfolio name",' +
    '"Budget Currency","Clicks","Total Cost","Sales","Units Sold"';
  const row =
    '"Jul 13, 2026 - Aug 01, 2026","Jul 13, 2026 - Aug 01, 2026",' +
    '"SP - Broad","Ad Group 1","Coffee","USD","12","6.60","55.00","1"';
  return Buffer.from([header, row].join('\n'), 'utf8');
}

let ingestedRuns: AdsSyncRun[];
let storedRows: number;

function ingestedRun(overrides: Partial<AdsSyncRun> = {}): AdsSyncRun {
  return {
    runId: 'run-1',
    userId: USER,
    profileId: PROFILE,
    kind: 'search-term',
    from: '2026-07-09',
    to: '2026-08-07',
    status: 'ingested',
    requestedAt: '2026-08-08T05:00:00.000Z',
    updatedAt: '2026-08-08T05:02:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  ingestedRuns = [];
  storedRows = 0;

  vi.spyOn(adsSyncStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: ingestedRuns } as never)
  );
  // Row storage counts rather than stores: what matters to every case here is
  // whether a refused upload wrote ANYTHING.
  vi.spyOn(reportStorage, 'upsertDocument').mockImplementation(async () => {
    storedRows += 1;
    return undefined as never;
  });
  vi.spyOn(reportStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: [] } as never)
  );
});

describe('ads upload overlap', () => {
  it('refuses a window the sync already holds, before storing a row', async () => {
    ingestedRuns = [ingestedRun()];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: searchTermCsv(['2026-07-20', '2026-07-21']),
      source: 'upload',
    });

    expect(isIngestError(result)).toBe(true);
    // The refusal is only worth anything if nothing was written first.
    expect(storedRows).toBe(0);
    if (!isIngestError(result)) return;
    expect(result.overlap).toEqual({
      kind: 'search-term',
      from: '2026-07-09',
      to: '2026-08-07',
      profileId: PROFILE,
    });
    // Names the profile, so a seller with four of them can tell which.
    expect(result.error).toContain(PROFILE);
  });

  it('refuses a PARTIAL overlap — half a doubled window is still doubled', async () => {
    ingestedRuns = [ingestedRun()];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      // Starts before the synced window and runs one day into it.
      buffer: searchTermCsv(['2026-06-20', '2026-07-09']),
      source: 'upload',
    });

    expect(isIngestError(result)).toBe(true);
    expect(storedRows).toBe(0);
  });

  it('allows a window the sync does not hold', async () => {
    ingestedRuns = [ingestedRun()];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: searchTermCsv(['2026-06-01', '2026-06-02']),
      source: 'upload',
    });

    expect(isIngestError(result)).toBe(false);
    expect(storedRows).toBeGreaterThan(0);
  });

  it('counts only ingested runs — requested and failed ones own nothing', async () => {
    // Refusing on a `requested` run blocks the seller's only way to get the
    // data in while Amazon is still generating a report that may yet fail; a
    // `failed` run holds no rows at all, so it can double-count nothing.
    ingestedRuns = [
      ingestedRun({ runId: 'run-req', status: 'requested' }),
      ingestedRun({ runId: 'run-fail', status: 'failed' }),
      ingestedRun({ runId: 'run-rej', status: 'rejected' }),
    ];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: searchTermCsv(['2026-07-20']),
      source: 'upload',
    });

    expect(isIngestError(result)).toBe(false);
    expect(storedRows).toBeGreaterThan(0);
  });

  it('asks across every advertiser profile, not one', async () => {
    // A console export carries no profile column, so narrowing the lookup to a
    // profile would be narrowing it to a guess.
    ingestedRuns = [];
    await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: searchTermCsv(['2026-07-20']),
      source: 'upload',
    });

    const [, query, options] = vi.mocked(adsSyncStorage.executeQuery).mock
      .calls[0] as [string, string, { parameters: Record<string, unknown> }];
    expect(query).toContain('`userId` = $userId');
    expect(query).not.toContain('profileId');
    expect(options.parameters['kind']).toBe('search-term');
  });

  it('warns rather than passing quietly when the window cannot be read', async () => {
    // The campaign export dates its rows with a span. Unknown must not read as
    // clear: the rows land, and the response says the check did not run.
    ingestedRuns = [ingestedRun({ kind: 'campaign-performance' })];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: campaignCsv(),
      source: 'upload',
    });

    expect(isIngestError(result)).toBe(false);
    if (isIngestError(result)) return;
    expect(result.kind).toBe('campaign-performance');
    expect(result.warnings?.join(' ')).toMatch(/window it covers is unknown/);
    expect(storedRows).toBeGreaterThan(0);
  });

  it('lets an overlap through when asked deliberately, and says what it did', async () => {
    // A console export carries no profile column, so an upload for a profile
    // the sync has NOT covered is indistinguishable from a real collision.
    // This is the way past it, and it is not silent.
    ingestedRuns = [ingestedRun()];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: searchTermCsv(['2026-07-20']),
      source: 'upload',
      allowOverlap: true,
    });

    expect(isIngestError(result)).toBe(false);
    if (isIngestError(result)) return;
    expect(result.warnings?.join(' ')).toMatch(/already holds/);
    expect(storedRows).toBeGreaterThan(0);
  });

  it('never refuses the sync itself — its own run record is not a collision', async () => {
    // `collectAdsReport` writes the run as ingested and a retried collect
    // re-ingests. Guarding the api path would make the sync refuse its own
    // second poll and record a failure for work Amazon had already billed.
    ingestedRuns = [ingestedRun()];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: searchTermCsv(['2026-07-20']),
      source: 'api',
    });

    expect(isIngestError(result)).toBe(false);
    expect(adsSyncStorage.executeQuery).not.toHaveBeenCalled();
  });

  it('does not query the ads store for a non-ads report', async () => {
    // Every upload would otherwise pay for a lookup that cannot ever match.
    const ledger = Buffer.from(
      '"Date","FNSKU","ASIN","MSKU","Title","Event Type","Reference ID",' +
        '"Quantity","Fulfillment Center","Disposition","Reason","Country",' +
        '"Reconciled Quantity","Unreconciled Quantity","Date and Time","Store"\n' +
        '"07/06/2026","X004XONY53","B0G51NDRX4","FB-COF-HGE-250","Coffee",' +
        '"Shipments","","-1","ACY1","SELLABLE","","US","","",' +
        '"2026-07-06T00:00:00-0700","Example"',
      'utf8'
    );

    await ingestReportBuffer({
      sellerId: SELLER,
      userId: USER,
      buffer: ledger,
      source: 'upload',
    });

    expect(adsSyncStorage.executeQuery).not.toHaveBeenCalled();
  });

  it('skips the check when there is no user to check against', async () => {
    // Rather than throwing: the guard is an addition to a path that worked
    // without it, and a caller with no session is not a reason to lose data.
    ingestedRuns = [ingestedRun()];

    const result = await ingestReportBuffer({
      sellerId: SELLER,
      buffer: searchTermCsv(['2026-07-20']),
      source: 'upload',
    });

    expect(isIngestError(result)).toBe(false);
    expect(adsSyncStorage.executeQuery).not.toHaveBeenCalled();
  });
});
