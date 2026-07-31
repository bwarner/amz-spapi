import crypto from 'node:crypto';
import {
  executeQuery,
  upsertDocument,
  collectionName,
} from '@amz-spapi/couchbase-utils';
import type { ReportKind } from './report-registry.js';
import type { ReportRow } from './report-ingest.js';

/**
 * Storage for ingested report rows, plus the import ledger that records what
 * has actually been ingested.
 *
 * The import ledger is not bookkeeping garnish — it is what stops silent
 * incompleteness. Rows alone cannot distinguish "no receipts happened in June"
 * from "we only ever imported eventType=Adjustments for June". Reconciliation
 * that cannot tell those apart will confidently report units as missing when
 * the receipts were simply never fetched.
 */

/**
 * Storage seam — same pattern as the cost ledger. Coverage and dedup decide
 * whether a claim is defensible, so they must be verifiable without a cluster.
 */
export const reportStorage = { executeQuery, upsertDocument };

const SCOPE = 'reports';
/**
 * Backticked because `rows` is a RESERVED WORD in N1QL — unquoted it fails with
 * "syntax error ... at: rows (reserved word)". Every statement touching these
 * collections must use these constants rather than the bare names.
 */
const ROWS = `\`${collectionName(SCOPE, 'rows')}\``;
const IMPORTS = `\`${collectionName(SCOPE, 'imports')}\``;
/** Unquoted form: upsertDocument escapes the identifier itself. */
const IMPORTS_RAW = 'imports';

/** Rows are evidence for claims, and Amazon's filing windows are long. */
function rowTtlSeconds(): number {
  const days = Number(process.env['REPORT_ROW_TTL_DAYS']);
  return (Number.isFinite(days) && days > 0 ? days : 730) * 24 * 60 * 60;
}

/** Data API round-trips are per statement, so write in batches. */
const WRITE_BATCH = 100;
const KEY_BATCH = 500;

export type ReportSource = 'api' | 'upload';

export type ReportImport = {
  importId: string;
  sellerId: string;
  kind: ReportKind;
  reportType: string;
  source: ReportSource;
  /** Window asked for, when the caller stated one. */
  requestedFrom?: string;
  requestedTo?: string;
  /** Window actually observed in the data — the honest coverage figure. */
  observedFrom?: string;
  observedTo?: string;
  options?: Record<string, string>;
  rowsParsed: number;
  rowsNew: number;
  rowsDuplicate: number;
  unmappedHeaders?: string[];
  fileName?: string;
  fileSha256?: string;
  createdAt: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** Which of these row ids already exist. */
async function existingRowIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of chunk(ids, KEY_BATCH)) {
    const { rows } = await reportStorage.executeQuery<string>(
      SCOPE,
      `SELECT RAW META(d).id FROM ${ROWS} AS d USE KEYS $ids`,
      { parameters: { ids: batch }, readonly: true }
    );
    for (const id of rows) found.add(id);
  }
  return found;
}

/**
 * Persist rows, skipping ones already stored. Returns what was new so the
 * caller can report "imported 1,240 rows, 1,190 already known" rather than
 * implying every import added data.
 */
export async function storeReportRows(
  rows: ReportRow[],
  /** Stamped on each row so coverage can be derived from the rows themselves. */
  importId?: string
): Promise<{ stored: number; duplicate: number }> {
  if (!rows.length) return { stored: 0, duplicate: 0 };

  const existing = await existingRowIds(rows.map((row) => row.rowId));
  const fresh = rows
    .filter((row) => !existing.has(row.rowId))
    .map((row) => (importId ? { ...row, importId } : row));
  const ttl = rowTtlSeconds();

  for (const batch of chunk(fresh, WRITE_BATCH)) {
    // UPSERT ... VALUES with numbered parameters — the same statement shape the
    // rest of the codebase uses, just batched.
    const pairs = batch
      .map((_, index) => `($k${index}, $v${index}, {"expiration": $exp})`)
      .join(', ');
    const parameters: Record<string, unknown> = { exp: absoluteExpiry(ttl) };
    batch.forEach((row, index) => {
      parameters[`k${index}`] = row.rowId;
      parameters[`v${index}`] = row;
    });
    await reportStorage.executeQuery(
      SCOPE,
      `UPSERT INTO ${ROWS} (KEY, VALUE, OPTIONS) VALUES ${pairs}`,
      { parameters }
    );
  }

  return { stored: fresh.length, duplicate: rows.length - fresh.length };
}

/**
 * Couchbase treats an expiry over 30 days as an absolute epoch; a raw 730-day
 * value would be interpreted as 1970 and expire the document immediately.
 */
function absoluteExpiry(seconds: number): number {
  return seconds > 30 * 24 * 60 * 60
    ? Math.floor(Date.now() / 1000) + seconds
    : seconds;
}

function observedRange(rows: ReportRow[]): {
  from?: string;
  to?: string;
} {
  const dates = rows
    .map(
      (row) =>
        row.fields.date ?? row.fields.shipmentDate ?? row.fields.requestDate
    )
    .filter((value): value is string => Boolean(value))
    .sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

/** Record an import. Never throws — losing the audit row must not fail a load. */
export async function recordImport(params: {
  /** Supplied by the caller so the rows carry the same id. */
  importId?: string;
  sellerId: string;
  kind: ReportKind;
  reportType: string;
  source: ReportSource;
  rows: ReportRow[];
  stored: number;
  duplicate: number;
  requestedFrom?: string;
  requestedTo?: string;
  options?: Record<string, string>;
  unmappedHeaders?: string[];
  fileName?: string;
  fileBytes?: Buffer;
}): Promise<ReportImport> {
  const observed = observedRange(params.rows);
  const record: ReportImport = {
    importId: params.importId ?? crypto.randomUUID(),
    sellerId: params.sellerId,
    kind: params.kind,
    reportType: params.reportType,
    source: params.source,
    requestedFrom: params.requestedFrom,
    requestedTo: params.requestedTo,
    observedFrom: observed.from,
    observedTo: observed.to,
    options: params.options,
    rowsParsed: params.rows.length,
    rowsNew: params.stored,
    rowsDuplicate: params.duplicate,
    unmappedHeaders: params.unmappedHeaders?.length
      ? params.unmappedHeaders
      : undefined,
    fileName: params.fileName,
    fileSha256: params.fileBytes
      ? crypto.createHash('sha256').update(params.fileBytes).digest('hex')
      : undefined,
    createdAt: Date.now(),
  };
  try {
    await reportStorage.upsertDocument(
      SCOPE,
      IMPORTS_RAW,
      `import::${record.importId}`,
      record
    );
  } catch (error) {
    console.error(
      '[reports] import record failed',
      record.kind,
      error instanceof Error ? error.message : error
    );
  }
  return record;
}

export type Coverage = {
  kind: ReportKind;
  /** Merged windows actually ingested, ascending. */
  covered: Array<{ from: string; to: string }>;
  /** Windows inside the requested range with no data ingested. */
  gaps: Array<{ from: string; to: string }>;
  /** Distinct reportOptions used — a filtered pull is not full coverage. */
  filtersUsed: Array<Record<string, string>>;
  imports: number;
};

function mergeRanges(
  ranges: Array<{ from: string; to: string }>
): Array<{ from: string; to: string }> {
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from));
  const merged: Array<{ from: string; to: string }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      if (range.to > last.to) last.to = range.to;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * What has actually been ingested for a report kind, and where the holes are.
 * Reconciliation should refuse to declare units missing over a gap.
 */
export async function getCoverage(params: {
  kind: ReportKind;
  sellerId: string;
  from?: string;
  to?: string;
}): Promise<Coverage> {
  // Derived from the ROWS, not from the import records.
  //
  // Import records never expire; rows do, at REPORT_ROW_TTL_DAYS. Reading
  // coverage from the records meant that on day 731 a window was still reported
  // as covered with nothing behind it — a reconciliation resting on no data,
  // reported as complete, which is the exact failure coverage exists to catch.
  // Grouping the rows by the import that wrote them gives the same windows and
  // cannot outlive them.
  const { rows } = await reportStorage.executeQuery<{
    importId: string | null;
    from: string | null;
    to: string | null;
    options: Record<string, string> | null;
    rows: number;
  }>(
    SCOPE,
    `SELECT d.importId AS importId,
            MIN(d.fields.\`date\`) AS \`from\`,
            MAX(d.fields.\`date\`) AS \`to\`,
            MIN(d.\`options\`) AS \`options\`,
            COUNT(*) AS \`rows\`
       FROM ${ROWS} AS d
       WHERE d.sellerId = $sellerId AND d.reportKind = $kind
       GROUP BY d.importId
       ORDER BY MIN(d.fields.\`date\`)`,
    {
      parameters: { kind: params.kind, sellerId: params.sellerId },
      readonly: true,
    }
  );

  const ranges = rows
    .filter((row) => row.from && row.to)
    .map((row) => ({ from: row.from as string, to: row.to as string }));
  const covered = mergeRanges(ranges);

  const gaps: Array<{ from: string; to: string }> = [];
  if (params.from && params.to) {
    let cursor = params.from;
    for (const range of covered) {
      if (range.to < cursor) continue;
      if (range.from > cursor) {
        gaps.push({ from: cursor, to: range.from });
      }
      if (range.to > cursor) cursor = range.to;
      if (cursor >= params.to) break;
    }
    if (cursor < params.to) gaps.push({ from: cursor, to: params.to });
  }

  const seen = new Set<string>();
  const filtersUsed: Array<Record<string, string>> = [];
  for (const row of rows) {
    const key = JSON.stringify(row.options ?? {});
    if (seen.has(key)) continue;
    seen.add(key);
    filtersUsed.push(row.options ?? {});
  }

  return {
    kind: params.kind,
    covered,
    gaps,
    filtersUsed,
    // Groups of rows still held, which is what coverage is about. The imports
    // collection remains the audit trail of what was loaded and when.
    imports: rows.length,
  };
}

/**
 * Which ledger view answers which question.
 *
 * The two views are not alternative formats of one dataset — they are two
 * descriptions of the SAME movements, so combining them double counts. A unit
 * that appears as `lost: 1` in the summary is the same unit that appears as an
 * `Adjustments` event in the detail view.
 *
 * Authority is therefore split by question, not by preference:
 *  - DETAIL is authoritative for reconciliation. Only it carries referenceId,
 *    which is the join to an inbound shipment, removal order or reimbursement
 *    case, and only it resolves individual events.
 *  - SUMMARY is authoritative for balances. Only it states starting and ending
 *    warehouse balance per period; deriving those from the detail view would
 *    mean replaying every event since the account opened.
 */
export const LEDGER_AUTHORITY = {
  reconciliation: 'ledger-detail',
  balances: 'ledger-summary',
} as const;

export type LedgerQuery = {
  sellerId: string;
  /** Required: there is no correct default, and mixing views double counts. */
  view: 'ledger-detail' | 'ledger-summary';
  from?: string;
  to?: string;
  fnsku?: string;
  /**
   * Summary only. DAILY and MONTHLY rows both contain the same movements for a
   * month, so a query spanning both counts them twice — the granularity must be
   * pinned even though identity already keeps the rows distinct.
   */
  granularity?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
};

/**
 * Read ledger rows for exactly one view. Returns rows in date order.
 *
 * Deliberately has no "both views" mode: the guard belongs at the only place
 * that can enforce it, and an API that cannot express the unsafe query cannot
 * be used to write it by accident.
 */
export async function queryLedgerRows(
  query: LedgerQuery
): Promise<ReportRow[]> {
  const conditions = ['d.sellerId = $sellerId', 'd.reportKind = $view'];
  const parameters: Record<string, unknown> = {
    sellerId: query.sellerId,
    view: query.view,
  };

  if (query.from) {
    conditions.push('d.fields.`date` >= $from');
    parameters['from'] = query.from;
  }
  if (query.to) {
    conditions.push('d.fields.`date` <= $to');
    parameters['to'] = query.to;
  }
  if (query.fnsku) {
    conditions.push('d.fields.fnsku = $fnsku');
    parameters['fnsku'] = query.fnsku;
  }
  if (query.view === 'ledger-summary' && query.granularity) {
    conditions.push('d.options.aggregatedByTimePeriod = $granularity');
    parameters['granularity'] = query.granularity;
  }

  const { rows } = await reportStorage.executeQuery<ReportRow>(
    SCOPE,
    `SELECT RAW d FROM ${ROWS} AS d
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.fields.\`date\``,
    { parameters, readonly: true }
  );
  return rows;
}

/**
 * Delete stored rows for a seller and report kind.
 *
 * Needed because remapping columns changes how a row is INTERPRETED without
 * changing its content hash, so a re-import correctly reports every row as a
 * duplicate and the old sparse mapping persists. Dropping and re-importing is
 * the honest fix; a migration path for that is machinery for a problem that
 * only exists while the registry is still being corrected.
 */
export async function deleteReportRows(params: {
  sellerId: string;
  kind: ReportKind;
}): Promise<number> {
  const { rows } = await reportStorage.executeQuery<{ deleted: number }>(
    SCOPE,
    `DELETE FROM ${ROWS} AS d
       WHERE d.sellerId = $sellerId AND d.reportKind = $kind
       RETURNING RAW 1`,
    { parameters: { sellerId: params.sellerId, kind: params.kind } }
  );
  return rows.length;
}

/** Import records for a kind, so coverage can be reset alongside the rows. */
export async function deleteReportImports(params: {
  sellerId: string;
  kind: ReportKind;
}): Promise<number> {
  const { rows } = await reportStorage.executeQuery<number>(
    SCOPE,
    `DELETE FROM ${IMPORTS} AS d
       WHERE d.sellerId = $sellerId AND d.kind = $kind
       RETURNING RAW 1`,
    { parameters: { sellerId: params.sellerId, kind: params.kind } }
  );
  return rows.length;
}

/**
 * One shipment/SKU's receipt totals, already reduced.
 *
 * Reconciliation needs sums and date bounds, not documents. Computing them in
 * the query service returns one row per shipment and SKU instead of every
 * receipt event, and lets the index do the filtering.
 */
export type ReceiptAggregate = {
  shipmentId: string;
  sku?: string;
  fnsku?: string;
  receivedGross: number;
  reversed: number;
  firstReceipt?: string;
  lastReceipt?: string;
  lastReversal?: string;
  reversalEvents: number;
  fulfillmentCenters: string[];
};

/**
 * Aggregate receipts by shipment and SKU in N1QL.
 *
 * Only Receipts rows carry a reference id, so the WHERE clause does the same
 * work the caller would otherwise do after transferring everything: on a real
 * seller this is 46 rows of 857, and the ratio only worsens as the ledger grows.
 *
 * Quantities are stored as the strings the export contained, so they are cast
 * here rather than trusting Couchbase to compare them numerically.
 */
export async function queryReceiptAggregates(params: {
  sellerId: string;
  shipmentId?: string;
}): Promise<ReceiptAggregate[]> {
  const conditions = [
    'd.sellerId = $sellerId',
    "d.reportKind = 'ledger-detail'",
    "d.fields.eventType = 'Receipts'",
    'd.fields.referenceId IS NOT MISSING',
    "d.fields.referenceId != ''",
  ];
  const parameters: Record<string, unknown> = { sellerId: params.sellerId };
  if (params.shipmentId) {
    conditions.push('d.fields.referenceId = $shipmentId');
    parameters['shipmentId'] = params.shipmentId;
  }

  const qty = 'TONUMBER(d.fields.quantity)';
  const { rows } = await reportStorage.executeQuery<ReceiptAggregate>(
    SCOPE,
    `SELECT d.fields.referenceId AS shipmentId,
            d.fields.msku AS sku,
            MIN(d.fields.fnsku) AS fnsku,
            SUM(CASE WHEN ${qty} > 0 THEN ${qty} ELSE 0 END) AS receivedGross,
            ABS(SUM(CASE WHEN ${qty} < 0 THEN ${qty} ELSE 0 END)) AS reversed,
            MIN(d.fields.eventTimestamp) AS firstReceipt,
            MAX(d.fields.eventTimestamp) AS lastReceipt,
            MAX(CASE WHEN ${qty} < 0 THEN d.fields.eventTimestamp ELSE NULL END)
              AS lastReversal,
            SUM(CASE WHEN ${qty} < 0 THEN 1 ELSE 0 END) AS reversalEvents,
            ARRAY_DISTINCT(ARRAY_AGG(d.fields.fulfillmentCenter))
              AS fulfillmentCenters
       FROM ${ROWS} AS d
       WHERE ${conditions.join(' AND ')}
       GROUP BY d.fields.referenceId, d.fields.msku
       ORDER BY MIN(d.fields.eventTimestamp) DESC`,
    { parameters, readonly: true }
  );
  return rows;
}
