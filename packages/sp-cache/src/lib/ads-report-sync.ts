import {
  ingestReportBuffer,
  isIngestError,
  type IngestError,
  type IngestOutcome,
} from './report-sync.js';
import type { ReportKind } from './report-registry.js';
import {
  adsRunId,
  isAdsReportKind,
  readAdsRun,
  writeAdsRun,
  type AdsReportKind,
  type AdsSyncRun,
} from './ads-sync-store.js';

/**
 * Fetch an Amazon Ads report on a schedule (#145).
 *
 * Split into two steps on purpose, because the flow does not fit one
 * invocation: Amazon generates a report over minutes, and a worker that waits
 * spends its whole runtime asleep and still dies at the Lambda ceiling.
 * `requestAdsReport` starts one and returns; `collectAdsReport` polls once and
 * ingests if ready. "Not ready" is a normal answer, not a failure — which is
 * exactly the shape a Step Functions Wait/Choice loop consumes, and it works
 * unchanged under a plain re-queue if that is what it ends up wired to.
 *
 * Framework-free, like `SYNC_JOBS`: no clock of its own, no queue, no
 * environment. The caller supplies the client and the window.
 */

/** The ads client surface these steps need — narrowed so tests need no HTTP. */
export type AdsReportClient = {
  requestPerformanceReport(params: {
    level: 'campaign' | 'keyword' | 'searchTerm';
    startDate: string;
    endDate: string;
  }): Promise<{ reportId: string; status?: string }>;
  fetchPerformanceReport(
    reportId: string
  ): Promise<
    | { ready: false; status: string; failureReason?: string }
    | { ready: true; rows: Array<Record<string, unknown>> }
  >;
};

/**
 * Which report level backs each stored kind.
 *
 * Keyed on `AdsReportKind` rather than a partial `ReportKind`, so adding a kind
 * to `ADS_REPORT_KINDS` — which is what makes the upload path guard it — fails
 * to compile until the level it fetches at is stated here too.
 */
const LEVEL_FOR_KIND: Record<
  AdsReportKind,
  'campaign' | 'keyword' | 'searchTerm'
> = {
  'search-term': 'searchTerm',
  'campaign-performance': 'campaign',
};

export class AdsReportSyncError extends Error {}

export type RequestAdsReportParams = {
  client: AdsReportClient;
  userId: string;
  /** Advertiser profile — the ads account this report belongs to. */
  profileId: string;
  kind: ReportKind;
  /** Inclusive ISO dates. */
  from: string;
  to: string;
};

/**
 * Start a report, or decline to.
 *
 * Declines when this exact window is already ingested: Amazon bills for
 * generation, so re-requesting what we already hold spends money to produce
 * rows that dedup would then discard.
 */
export async function requestAdsReport(
  params: RequestAdsReportParams
): Promise<
  | { started: true; run: AdsSyncRun }
  | { started: false; reason: string; run?: AdsSyncRun }
> {
  const level = isAdsReportKind(params.kind)
    ? LEVEL_FOR_KIND[params.kind]
    : undefined;
  if (!level) {
    throw new AdsReportSyncError(
      `${params.kind} is not an Ads report kind — nothing to request.`
    );
  }

  const existing = await readAdsRun(adsRunId(params));
  if (existing?.status === 'ingested') {
    return {
      started: false,
      reason: `Already ingested ${params.from}..${params.to}`,
      run: existing,
    };
  }
  if (existing?.status === 'requested' && existing.reportId) {
    // A live handle on a report Amazon is already building. Requesting a
    // second one would pay twice for the same window and orphan the first.
    return {
      started: false,
      reason: `Already requested (report ${existing.reportId})`,
      run: existing,
    };
  }

  try {
    const { reportId } = await params.client.requestPerformanceReport({
      level,
      startDate: params.from,
      endDate: params.to,
    });
    return {
      started: true,
      run: await writeAdsRun({
        userId: params.userId,
        profileId: params.profileId,
        kind: params.kind,
        from: params.from,
        to: params.to,
        status: 'requested',
        reportId,
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Report request failed.';
    await writeAdsRun({
      userId: params.userId,
      profileId: params.profileId,
      kind: params.kind,
      from: params.from,
      to: params.to,
      status: 'failed',
      error: message,
    });
    throw error;
  }
}

/**
 * Rows as a CSV the report parser can read.
 *
 * Round-tripping typed rows through text looks wasteful and is deliberate: it
 * keeps ONE ingest path, so API-fetched rows are parsed, dated, numbered,
 * deduped and coverage-recorded by exactly the code that handles an uploaded
 * export. Two paths would drift, and the drift would show up as figures that
 * disagree depending on where the data came from.
 *
 * The request window is emitted as `startDate`/`endDate` columns because a
 * SUMMARY report carries no date of its own — without them every row would
 * store dateless and fall outside every window query.
 */
export function adsRowsAsCsv(params: {
  rows: Array<Record<string, unknown>>;
  from: string;
  to: string;
}): string {
  const columns = [
    ...new Set(params.rows.flatMap((row) => Object.keys(row))),
  ].sort();
  const header = ['startDate', 'endDate', ...columns];
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    header.join(','),
    ...params.rows.map((row) =>
      [params.from, params.to, ...columns.map((c) => escape(row[c]))].join(',')
    ),
  ];
  return lines.join('\n');
}

export type CollectAdsReportParams = {
  client: AdsReportClient;
  userId: string;
  profileId: string;
  kind: ReportKind;
  from: string;
  to: string;
  /**
   * Whose rows these are in the report store.
   *
   * Ads profiles and seller accounts are different identifiers, and the manual
   * upload path files ads exports under the SELLER id. The sync must match it
   * or the same report lands in two partitions and the harvest sees only half.
   * Passed in rather than derived, because which seller an advertiser profile
   * belongs to is a question only the caller can answer.
   */
  sellerId: string;
  /** Give up after this many polls rather than looping forever. */
  maxPolls?: number;
};

const DEFAULT_MAX_POLLS = 40;

export type CollectAdsReportResult =
  | { state: 'pending'; status: string; run: AdsSyncRun }
  | {
      state: 'ingested';
      run: AdsSyncRun;
      /**
       * Present only when THIS call did the ingesting. Absent on a retried
       * collect of an already-ingested run — there is no outcome to report,
       * and inventing a zeroed one would read as "the report was empty".
       */
      outcome?: IngestOutcome;
    }
  | { state: 'failed'; error: string; run: AdsSyncRun };

/**
 * Poll once, and ingest if the report is ready.
 *
 * Never waits and never retries internally — both belong to the orchestrator,
 * which can express backoff declaratively and does not pay for the sleep.
 */
export async function collectAdsReport(
  params: CollectAdsReportParams
): Promise<CollectAdsReportResult> {
  const runId = adsRunId(params);
  const run = await readAdsRun(runId);
  if (!run) {
    throw new AdsReportSyncError(`No ads sync run ${runId} to collect.`);
  }
  if (run.status === 'ingested') {
    // Idempotent: a retried collect must not re-ingest and must not look like
    // a failure either.
    return { state: 'ingested', run };
  }
  if (!run.reportId) {
    throw new AdsReportSyncError(
      `Run ${runId} has no report id — it was never requested.`
    );
  }

  const polls = (run.polls ?? 0) + 1;
  const answer = await params.client.fetchPerformanceReport(run.reportId);

  if (!answer.ready) {
    // Amazon's own FAILED is terminal: the report will never become ready, so
    // polling on is spending time to learn nothing.
    if (answer.status === 'FAILED') {
      const error =
        answer.failureReason ?? 'Amazon reported the report as FAILED.';
      return {
        state: 'failed',
        error,
        run: await writeAdsRun({
          ...runFields(run),
          status: 'rejected',
          error,
          polls,
        }),
      };
    }
    if (polls >= (params.maxPolls ?? DEFAULT_MAX_POLLS)) {
      const error = `Report ${run.reportId} still ${answer.status} after ${polls} polls.`;
      return {
        state: 'failed',
        error,
        run: await writeAdsRun({
          ...runFields(run),
          status: 'failed',
          error,
          polls,
        }),
      };
    }
    return {
      state: 'pending',
      status: answer.status,
      run: await writeAdsRun({ ...runFields(run), status: 'requested', polls }),
    };
  }

  const csv = adsRowsAsCsv({
    rows: answer.rows,
    from: params.from,
    to: params.to,
  });
  const outcome = await ingestReportBuffer({
    sellerId: params.sellerId,
    buffer: Buffer.from(csv, 'utf8'),
    source: 'api',
    kind: params.kind,
    requestedFrom: params.from,
    requestedTo: params.to,
  });

  if (isIngestError(outcome)) {
    return {
      state: 'failed',
      error: outcome.error,
      run: await writeAdsRun({
        ...runFields(run),
        status: 'failed',
        error: outcome.error,
        polls,
      }),
    };
  }

  return {
    state: 'ingested',
    outcome,
    run: await writeAdsRun({
      ...runFields(run),
      status: 'ingested',
      rowsNew: outcome.rowsNew,
      rowsDuplicate: outcome.rowsDuplicate,
      polls,
      // Cleared: a run that succeeded must not keep showing why it once failed.
      error: undefined,
    }),
  };
}

function runFields(run: AdsSyncRun) {
  return {
    userId: run.userId,
    profileId: run.profileId,
    kind: run.kind,
    from: run.from,
    to: run.to,
    reportId: run.reportId,
    requestedAt: run.requestedAt,
  };
}

export type { IngestError, IngestOutcome };
