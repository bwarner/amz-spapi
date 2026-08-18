import crypto from 'node:crypto';
import type { SpApiClient } from '@farvisionllc/sp-client';
import {
  decodeReportBuffer,
  detectReportKind,
  parseReport,
  type ReportRow,
} from './report-ingest.js';
import { REPORTS, type ReportKind } from './report-registry.js';
import {
  observedRange,
  recordImport,
  storeReportRows,
  type ReportImport,
  type ReportSource,
} from './report-store.js';
import {
  ingestedAdsWindows,
  isAdsReportKind,
  overlapsIngestedWindow,
  type AdsWindow,
} from './ads-sync-store.js';

/**
 * The single path every report takes once its bytes exist, whoever produced
 * them: decode → identify → parse → dedupe → store → record coverage.
 *
 * An uploaded file and an API sync differ only in how the text is obtained.
 * Keeping the rest shared is what stops the two from drifting into different
 * dedup or coverage behaviour — which is exactly the bug that would let the
 * same rows land twice depending on which route a user happened to use.
 */

export type IngestOutcome = {
  kind: ReportKind;
  rowsParsed: number;
  rowsNew: number;
  rowsDuplicate: number;
  /**
   * Rows already held that were RE-READ under the current column mapping.
   *
   * A subset of `rowsDuplicate`: no new facts arrived, but the ones already
   * stored now carry what the registry maps today. Non-zero means an earlier
   * import of this file had captured less.
   */
  rowsRefreshed: number;
  /** Columns the registry did not recognise — kept in `raw`, surfaced here. */
  unmappedHeaders: string[];
  observedFrom?: string;
  observedTo?: string;
  importId: string;
  /** Set when the caller let us identify the report from its headers. */
  detectedKind?: ReportKind;
  detectionConfidence?: number;
  /**
   * Things the caller should be told about a load that nonetheless succeeded.
   *
   * A check that could not run is not the same as a check that passed, and the
   * difference has to reach the seller — silently skipping the overlap guard is
   * the failure it exists to remove.
   */
  warnings?: string[];
};

export type IngestError = {
  error: string;
  /** What detection thought, so the caller can offer a manual choice. */
  candidates?: Array<{ kind: ReportKind; matched: number; possible: number }>;
  /**
   * The synced window this upload collided with, when that is why it was
   * refused. Present so a caller can offer `allowOverlap` deliberately rather
   * than having to parse the sentence.
   */
  overlap?: { kind: ReportKind; from: string; to: string; profileId: string };
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether an ads upload would double-count a window the scheduled sync holds.
 *
 * Row identity is built from the RAW header names and cell values (`rowIdFor`),
 * deliberately — it means a change to our own normalisation cannot re-import
 * history. The consequence is that the SAME data from two sources does not
 * collide: the console writes `customersearchterm` and `$278.25` where the API
 * writes `searchTerm` and `278.25`, so dedup never fires and every row lands
 * twice. A seller who uploads July while the sync also holds July sees double
 * the spend, with both figures looking entirely plausible. Nothing downstream
 * can detect it afterwards, which is why it is caught here, before the rows
 * exist.
 *
 * Returns a REASON when the check could not run rather than passing quietly.
 * Both ads console exports are readable now — `toIsoDate` handles their
 * "Jun 03, 2026" days and `readDateSpan` handles the campaign export's
 * "Jul 13, 2026 - Aug 01, 2026" range — but a file whose date column holds
 * something neither recognises still has an unknown window, and unknown must
 * not read as clear.
 */
async function adsUploadOverlap(params: {
  userId: string;
  kind: ReportKind;
  rows: ReportRow[];
}): Promise<
  { collision: AdsWindow } | { unchecked: string } | Record<string, never>
> {
  // Every profile of this user, not one: a console export carries no profile
  // column, so which of the seller's ads accounts produced the file is not
  // knowable from it. Checking against all of them is the conservative reading
  // — it can refuse an upload for a profile the sync has not covered, and
  // `allowOverlap` is the deliberate way past that.
  const held = await ingestedAdsWindows({
    userId: params.userId,
    kind: params.kind,
  });
  if (!held.length) return {};

  const { from, to } = observedRange(params.rows);
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to)) {
    return {
      unchecked:
        'Could not check this against the scheduled ads sync: its date column ' +
        `holds ${
          from ? `"${from}"` : 'nothing readable'
        }, which is neither a ` +
        'day nor a range, so the window this file covers is unknown. If the ' +
        'sync already holds these days they are now stored twice — the two ' +
        'sources spell their columns differently, so duplicate detection ' +
        'cannot merge them.',
    };
  }

  const collision = overlapsIngestedWindow(held, { from, to });
  return collision ? { collision } : {};
}

/**
 * Ingest report bytes. `kind` may be omitted for uploads — headers identify the
 * report far more reliably than a filename Amazon does not control.
 */
export async function ingestReportBuffer(params: {
  sellerId: string;
  buffer: Buffer;
  source: ReportSource;
  kind?: ReportKind;
  fileName?: string;
  requestedFrom?: string;
  requestedTo?: string;
  options?: Record<string, string>;
  snapshotDate?: string;
  /**
   * Who is uploading. Only used to look up what the ads sync already holds for
   * them, and only on the upload path — the sync's own ingest passes
   * `source: 'api'` and must never be refused by its own run record.
   */
  userId?: string;
  /** Store an ads window the sync already holds anyway, having been told. */
  allowOverlap?: boolean;
}): Promise<IngestOutcome | IngestError> {
  const text = decodeReportBuffer(params.buffer);
  if (!text.trim()) return { error: 'The file is empty.' };

  const detection = detectReportKind(text);
  const kind = params.kind ?? detection.kind ?? undefined;
  if (!kind) {
    return {
      error:
        'Could not tell which Amazon report this is from its column headers. ' +
        'Check it is an unmodified export (Excel re-saves can rename columns), ' +
        'or say which report it is.',
      candidates: detection.scores,
    };
  }

  const definition = REPORTS[kind];
  // Snapshot reports need a date to distinguish two days of the same list; a
  // file that carries none is dated by when it was ingested.
  const snapshotDate = definition.snapshot
    ? params.snapshotDate ??
      params.requestedTo ??
      new Date().toISOString().slice(0, 10)
    : params.snapshotDate ?? params.requestedTo;

  const parsed = parseReport({
    kind,
    sellerId: params.sellerId,
    text,
    snapshotDate,
    options: params.options,
  });
  if (!parsed.rows.length) {
    return {
      error:
        `Recognised this as ${definition.label} but found no data rows — the ` +
        'export may cover a window with no activity.',
    };
  }

  const warnings: string[] = [];
  if (params.source === 'upload' && params.userId && isAdsReportKind(kind)) {
    const overlap = await adsUploadOverlap({
      userId: params.userId,
      kind,
      rows: parsed.rows,
    });
    if ('collision' in overlap) {
      const { from, to, profileId } = overlap.collision;
      if (!params.allowOverlap) {
        return {
          error:
            `The scheduled ads sync already holds ${definition.label} for ` +
            `${from}..${to} (advertiser profile ${profileId}), and this file ` +
            'covers days inside that window. Loading it would store those days ' +
            'twice: a console export and an API pull spell their columns ' +
            'differently, so duplicate detection cannot merge them. Narrow the ' +
            "export's date range, or import it anyway if this is a different " +
            'advertiser profile.',
          overlap: { kind, from, to, profileId },
        };
      }
      warnings.push(
        `Imported over a window the ads sync already holds (${from}..${to}, ` +
          `profile ${profileId}). Totals for those days will be overstated if ` +
          'this export covers the same advertiser profile.'
      );
    } else if ('unchecked' in overlap) {
      warnings.push(overlap.unchecked);
    }
  }

  // Minted here so the rows and the audit record share it: coverage groups on
  // the rows' copy, so it must exist before they are written.
  const importId = crypto.randomUUID();
  const { stored, duplicate, refreshed } = await storeReportRows(
    parsed.rows,
    importId
  );
  const record: ReportImport = await recordImport({
    importId,
    sellerId: params.sellerId,
    kind,
    reportType: definition.reportType,
    source: params.source,
    rows: parsed.rows,
    stored,
    duplicate,
    requestedFrom: params.requestedFrom,
    requestedTo: params.requestedTo,
    options: params.options,
    unmappedHeaders: parsed.unmappedHeaders,
    fileName: params.fileName,
    fileBytes: params.buffer,
  });

  return {
    kind,
    rowsParsed: parsed.rows.length,
    rowsNew: stored,
    rowsDuplicate: duplicate,
    rowsRefreshed: refreshed,
    unmappedHeaders: parsed.unmappedHeaders,
    observedFrom: record.observedFrom,
    observedTo: record.observedTo,
    importId: record.importId,
    detectedKind: detection.kind ?? undefined,
    detectionConfidence: detection.confidence,
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * Fetch a report from SP-API and ingest it.
 *
 * Requires the app to hold the role for that report — the FBA reports need the
 * same Fulfillment role that a 403 on /fba/inbound/v0/shipments indicates is
 * missing. When it is absent the error names the role rather than looking like
 * a connection failure.
 */
/**
 * Fetch every already-generated report of a type in a window, concatenated.
 *
 * Amazon produces settlement reports on its own cycle — roughly fortnightly, and
 * not aligned to anything the caller asks for — so a date range covers SEVERAL
 * of them rather than one. Each is a separate document that has to be downloaded
 * and stitched together.
 *
 * Only the first file keeps its header row. Ingest identifies columns from the
 * header, so leaving the others in would parse them as data and produce rows
 * whose every field is a column name.
 *
 * `createdSince` filters on when Amazon PRODUCED a report, not the period it
 * covers, and the two differ by days. The window is widened rather than trusted:
 * a settlement for late in the range is published after the range ends, and
 * asking precisely would silently miss the most recent one every time.
 */
const AUTO_GENERATED_PUBLICATION_LAG_DAYS = 14;

async function fetchAutoGeneratedReports(
  params: {
    client: SpApiClient;
    from: string;
    to: string;
    marketplaceIds?: string[];
    onStatus?: (status: string) => void;
  },
  definition: { reportType: string }
): Promise<string> {
  const lagMs = AUTO_GENERATED_PUBLICATION_LAG_DAYS * 24 * 60 * 60 * 1000;
  const listed = await params.client.listReports({
    reportTypes: [definition.reportType],
    marketplaceIds: params.marketplaceIds,
    createdSince: new Date(new Date(params.from).getTime()).toISOString(),
    createdUntil: new Date(new Date(params.to).getTime() + lagMs).toISOString(),
    processingStatuses: ['DONE'],
  });

  const withDocuments = listed.reports.filter((r) => r.reportDocumentId);
  if (withDocuments.length === 0) {
    throw new Error(
      `No ${definition.reportType} reports have been generated in that window. ` +
        'Amazon produces these on its own settlement cycle and they cannot be ' +
        'requested; only about 90 days are retained.'
    );
  }

  params.onStatus?.(`FOUND ${withDocuments.length}`);

  const parts: string[] = [];
  for (const [index, report] of withDocuments.entries()) {
    const document = await params.client.getReportDocument(
      report.reportDocumentId as string
    );
    const body = await params.client.downloadReportDocument(document);
    parts.push(index === 0 ? body : stripHeaderRow(body));
  }
  return parts.join('\n');
}

/** Drop the first line, so a concatenated file has one header and not N. */
function stripHeaderRow(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? '' : text.slice(newline + 1);
}

export async function syncReport(params: {
  client: SpApiClient;
  sellerId: string;
  kind: ReportKind;
  from: string;
  to: string;
  options?: Record<string, string>;
  marketplaceIds?: string[];
  timeoutMs?: number;
  onStatus?: (status: string) => void;
}): Promise<IngestOutcome | IngestError> {
  const definition = REPORTS[params.kind];
  const options = definition.requiresReportOptions
    ? { ...definition.defaultReportOptions, ...params.options }
    : params.options;

  let text: string;
  try {
    text = definition.autoGenerated
      ? await fetchAutoGeneratedReports(params, definition)
      : (
          await params.client.runReport({
            reportType: definition.reportType,
            dataStartTime: new Date(params.from).toISOString(),
            dataEndTime: new Date(params.to).toISOString(),
            marketplaceIds: params.marketplaceIds,
            reportOptions: options,
            timeoutMs: params.timeoutMs,
            onStatus: params.onStatus,
          })
        ).text;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Report request failed.',
    };
  }

  return ingestReportBuffer({
    sellerId: params.sellerId,
    buffer: Buffer.from(text, 'utf8'),
    source: 'api',
    kind: params.kind,
    requestedFrom: params.from,
    requestedTo: params.to,
    options,
  });
}

/** Narrowing helper for callers. */
export function isIngestError(
  result: IngestOutcome | IngestError
): result is IngestError {
  return 'error' in result;
}

export type { ReportRow };
