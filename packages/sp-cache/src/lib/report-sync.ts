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
  recordImport,
  storeReportRows,
  type ReportImport,
  type ReportSource,
} from './report-store.js';

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
};

export type IngestError = {
  error: string;
  /** What detection thought, so the caller can offer a manual choice. */
  candidates?: Array<{ kind: ReportKind; matched: number; possible: number }>;
};

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
