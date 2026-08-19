import crypto from 'node:crypto';
import {
  executeQuery,
  upsertDocument,
  collectionName,
} from '@amz-spapi/couchbase-utils';
import {
  NUMERIC_FIELDS,
  REPORTS,
  type ReportFieldName,
} from './report-registry.js';
import { retentionSecondsFromEnv } from '@amz-spapi/data-rights';
import type { ReportKind } from './report-registry.js';
import {
  readDateSpan,
  remapStoredRow,
  type ReportRow,
} from './report-ingest.js';

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

/**
 * How long report data is kept.
 *
 * This was 730 days, for a good reason: rows are evidence for reimbursement
 * claims and Amazon's filing windows are long. The reason did not survive the
 * SP-API Data Protection Policy, which caps non-PII Amazon Information at 18
 * months — so the ceiling wins and claims older than that have to be filed from
 * the seller's own records rather than ours.
 *
 * `REPORT_ROW_TTL_DAYS` still shortens it per environment. It can no longer
 * lengthen it: `retentionSeconds` clamps, so the variable cannot lift a
 * compliance ceiling by being set wrong.
 *
 * Not retroactive. Couchbase stamps an absolute expiry at write time, so rows
 * already stored keep the 730-day expiry they were written with until they are
 * re-imported.
 */
function rowTtlSeconds(): number {
  return retentionSecondsFromEnv('REPORT_ROW_TTL_DAYS');
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

/** What is already stored under these ids, and how it was parsed. */
type StoredShape = { mappingVersion?: string; importId?: string };

async function existingRowShapes(
  ids: string[]
): Promise<Map<string, StoredShape>> {
  const found = new Map<string, StoredShape>();
  for (const batch of chunk(ids, KEY_BATCH)) {
    const { rows } = await reportStorage.executeQuery<
      StoredShape & { id: string }
    >(
      SCOPE,
      `SELECT META(d).id AS id, d.mappingVersion AS mappingVersion,
              d.importId AS importId
         FROM ${ROWS} AS d USE KEYS $ids`,
      { parameters: { ids: batch }, readonly: true }
    );
    for (const row of rows) {
      found.set(row.id, {
        mappingVersion: row.mappingVersion,
        importId: row.importId,
      });
    }
  }
  return found;
}

/**
 * Persist rows. Already-stored rows are skipped — UNLESS they were parsed under
 * a different column mapping, in which case they are re-written.
 *
 * That exception is the whole point. Identity is a content hash, so re-sending
 * a file after the registry has been corrected dedupes every row and leaves the
 * old, wrong interpretation in place while reporting a successful import. A
 * seller who was told "your storage fees are unmapped, re-attach the file" did
 * exactly that, twice, and nothing changed either time. Re-attaching the file is
 * the repair anyone will reach for first, so it has to BE the repair.
 *
 * Refreshed rows are still counted as duplicates — no new facts arrived — and
 * keep the importId that first stored them, so coverage windows do not move
 * under a re-read.
 */
export async function storeReportRows(
  rows: ReportRow[],
  /** Stamped on each row so coverage can be derived from the rows themselves. */
  importId?: string
): Promise<{ stored: number; duplicate: number; refreshed: number }> {
  if (!rows.length) return { stored: 0, duplicate: 0, refreshed: 0 };

  const existing = await existingRowShapes(rows.map((row) => row.rowId));
  const fresh: ReportRow[] = [];
  let duplicate = 0;
  let refreshed = 0;
  for (const row of rows) {
    const prior = existing.get(row.rowId);
    if (!prior) {
      fresh.push(importId ? { ...row, importId } : row);
      continue;
    }
    duplicate += 1;
    if (prior.mappingVersion === row.mappingVersion) continue;
    refreshed += 1;
    fresh.push({ ...row, importId: prior.importId ?? importId });
  }
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

  // `fresh` carries both the new rows and the re-read ones, so the new count is
  // what is left after taking the refreshes out.
  return { stored: fresh.length - refreshed, duplicate, refreshed };
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

/**
 * The window a parsed file actually covers, from its rows.
 *
 * Exported because the upload path needs it BEFORE storing: the overlap guard
 * has to know which days a file holds while refusing it is still possible.
 * Returns whatever the date column held — a value the normaliser could not
 * reduce to a day (the campaign export's "Jul 13, 2026 - Aug 01, 2026") comes
 * back raw, so callers that compare dates must check the shape first.
 */
export function observedRange(rows: ReportRow[]): {
  from?: string;
  to?: string;
} {
  const dates = rows
    .flatMap((row) => {
      const value =
        row.fields.date ?? row.fields.shipmentDate ?? row.fields.requestDate;
      if (!value) return [];
      // A row dated with a SPAN covers both its ends and everything between,
      // so the window is the ends — not the raw string, which sorts against
      // ISO dates as nonsense and reported a coverage window of "Jul 13, 2026
      // - Aug 01, 2026" to both ends of the range.
      const span = readDateSpan(value);
      return span ? [span.from, span.to] : [value];
    })
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
      record,
      // Same ceiling as the rows it describes. An audit record that outlives
      // its rows documents coverage that no longer exists.
      rowTtlSeconds()
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

/**
 * The import ledger for one seller, newest first.
 *
 * The file-level view of what has been ingested: which file, when, how many
 * rows it actually contributed, and the window it covers. `getCoverage` answers
 * the same question per KIND and derives it from the rows, which is right for
 * "can this reconciliation be trusted" and useless for "what did I upload, and
 * can I get rid of that one".
 *
 * Uses `idx_report_imports_seller_kind` by its leading key. The sort is done
 * after the scan — an import ledger is tens of rows per seller, not thousands.
 */
export async function listImports(params: {
  sellerId: string;
  kind?: ReportKind;
  limit?: number;
}): Promise<ReportImport[]> {
  if (!params.sellerId) return [];

  const conditions = ['d.sellerId = $sellerId'];
  const parameters: Record<string, unknown> = {
    sellerId: params.sellerId,
    limit: params.limit ?? 500,
  };
  if (params.kind) {
    conditions.push('d.kind = $kind');
    parameters['kind'] = params.kind;
  }

  const { rows } = await reportStorage.executeQuery<ReportImport>(
    SCOPE,
    `SELECT RAW d FROM ${IMPORTS} AS d
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.createdAt DESC
       LIMIT $limit`,
    { parameters, readonly: true }
  );
  return rows;
}

/**
 * How many stored rows still carry this import's id — what deleting it costs.
 *
 * Asked separately from the delete so a seller can be shown the price before
 * they agree to pay it. It is NOT `rowsNew` off the import record: rows expire
 * at `REPORT_ROW_TTL_DAYS`, and a two-year-old import whose rows are long gone
 * would otherwise offer to delete 1,043 rows and delete none.
 */
export async function countRowsForImport(params: {
  sellerId: string;
  importId: string;
}): Promise<number> {
  const { rows } = await reportStorage.executeQuery<number>(
    SCOPE,
    `SELECT RAW COUNT(*) FROM ${ROWS} AS d
       WHERE d.sellerId = $sellerId AND d.importId = $importId`,
    {
      parameters: { sellerId: params.sellerId, importId: params.importId },
      readonly: true,
    }
  );
  return rows[0] ?? 0;
}

/**
 * Delete one import: the rows it brought in, and its ledger entry.
 *
 * The per-file counterpart to `deleteReportRows`, which can only take a whole
 * report kind — too blunt for "this settlement was for the wrong account".
 *
 * One consequence worth stating, because it is not obvious and cannot be fixed
 * here. A row's `importId` is the import that FIRST stored it, and a later
 * import that re-supplied the same row keeps that original id (see
 * `storeReportRows`). So deleting the first import removes rows a second import
 * also covered, and the second import's coverage shrinks with it. That is the
 * honest outcome — the rows really are gone — and the repair is what it has
 * always been: import the file again.
 */
export async function deleteImport(params: {
  sellerId: string;
  importId: string;
}): Promise<{ rowsDeleted: number; importDeleted: boolean }> {
  const { rows: deletedRows } = await reportStorage.executeQuery<number>(
    SCOPE,
    `DELETE FROM ${ROWS} AS d
       WHERE d.sellerId = $sellerId AND d.importId = $importId
       RETURNING RAW 1`,
    { parameters: { sellerId: params.sellerId, importId: params.importId } }
  );

  // Scoped by sellerId as well as the id, so a guessed import id cannot delete
  // another seller's ledger entry.
  const { rows: deletedImports } = await reportStorage.executeQuery<number>(
    SCOPE,
    `DELETE FROM ${IMPORTS} AS d
       WHERE d.sellerId = $sellerId AND d.importId = $importId
       RETURNING RAW 1`,
    { parameters: { sellerId: params.sellerId, importId: params.importId } }
  );

  return {
    rowsDeleted: deletedRows.length,
    importDeleted: deletedImports.length > 0,
  };
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
 * Rewrite stored rows to what today's registry would produce, in place.
 *
 * For data whose source file is gone — a sync from an API role since revoked,
 * an upload nobody kept. Everything it derives is a pure function of the
 * strings already in the row, so it repairs what re-importing cannot reach.
 *
 * A ONE-WAY conversion, not a compatibility layer: afterwards there is a single
 * representation and nothing reads the old one.
 *
 * Keys are collected first and then read in batches rather than paged with
 * OFFSET — the writes go back to the keys they were read from, so a shifting
 * window would be a hazard for no benefit.
 */
export async function migrateReportRows(params: {
  sellerId: string;
  kind: ReportKind;
}): Promise<{ scanned: number; updated: number }> {
  const { rows: ids } = await reportStorage.executeQuery<string>(
    SCOPE,
    `SELECT RAW META(d).id FROM ${ROWS} AS d
       WHERE d.sellerId = $sellerId AND d.reportKind = $kind`,
    {
      parameters: { sellerId: params.sellerId, kind: params.kind },
      readonly: true,
    }
  );

  const ttl = rowTtlSeconds();
  let scanned = 0;
  let updated = 0;

  for (const batch of chunk(ids, KEY_BATCH)) {
    const { rows } = await reportStorage.executeQuery<ReportRow>(
      SCOPE,
      `SELECT RAW d FROM ${ROWS} AS d USE KEYS $ids`,
      { parameters: { ids: batch }, readonly: true }
    );
    scanned += rows.length;

    const changed = rows
      .map((row) => remapStoredRow(row))
      .filter((row): row is ReportRow => row !== null);
    updated += changed.length;

    for (const writeBatch of chunk(changed, WRITE_BATCH)) {
      const pairs = writeBatch
        .map((_, index) => `($k${index}, $v${index}, {"expiration": $exp})`)
        .join(', ');
      const parameters: Record<string, unknown> = { exp: absoluteExpiry(ttl) };
      writeBatch.forEach((row, index) => {
        parameters[`k${index}`] = row.rowId;
        parameters[`v${index}`] = row;
      });
      await reportStorage.executeQuery(
        SCOPE,
        `UPSERT INTO ${ROWS} (KEY, VALUE, OPTIONS) VALUES ${pairs}`,
        { parameters }
      );
    }
  }

  return { scanned, updated };
}

/**
 * Delete stored rows for a seller and report kind.
 *
 * Still the blunt instrument, for a registry change too structural to migrate —
 * a column now read as a different field entirely. For the ordinary case, prefer
 * re-importing the file (which re-reads rows stored under an older mapping) or
 * `migrateReportRows` when the file is gone.
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

/**
 * Stored search-term rows, aggregated the way a harvest reads them (#147).
 *
 * One query rather than five `queryReportAggregate` calls, because the harvest
 * needs all five measures for the SAME grouping and five separate calls could
 * disagree — a row that expires between the clicks query and the orders query
 * yields a term with clicks and no orders, which is precisely the shape the
 * waste rule proposes a negative for.
 *
 * Numbers come from `numbers`, not `fields`: `numbers` is the parsed copy made
 * once at ingest, and summing the string column is how "0.011" totals as 11.
 *
 * Grouped by term AND placement, because the same term in two ad groups is two
 * pieces of evidence about two bids, not one. Collapsing them would average a
 * winning ad group with a losing one and graduate neither honestly.
 *
 * Rows whose search term is missing are dropped rather than grouped under an
 * empty key: an API pull and a console export disagree about which columns
 * exist, and a NULL group would present itself as a term to graduate.
 */
export type HarvestSourceRow = {
  campaignId?: string;
  adGroupId?: string;
  campaignName?: string;
  adGroupName?: string;
  searchTerm: string;
  matchType?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
};

export async function queryHarvestRows(params: {
  sellerId: string;
  from: string;
  to: string;
  /** Restrict to one campaign's evidence, when the funnel names one. */
  campaignIds?: string[];
}): Promise<HarvestSourceRow[]> {
  const conditions = [
    'd.sellerId = $sellerId',
    "d.reportKind = 'search-term'",
    'd.fields.`searchTerm` IS NOT MISSING',
    "d.fields.`searchTerm` != ''",
    'd.fields.`date` >= $from',
    'd.fields.`date` <= $to',
  ];
  const parameters: Record<string, unknown> = {
    sellerId: params.sellerId,
    from: params.from,
    to: params.to,
  };
  if (params.campaignIds?.length) {
    conditions.push('d.fields.`campaignId` IN $campaignIds');
    parameters['campaignIds'] = params.campaignIds;
  }

  // COALESCE to zero per row: a missing column is an absent measurement, and
  // SUM over a NULL would return NULL for the whole group — one row lacking a
  // sales column would erase the group's sales entirely.
  const sum = (field: string) =>
    `SUM(COALESCE(TONUMBER(d.numbers.\`${field}\`), 0))`;

  const { rows } = await reportStorage.executeQuery<HarvestSourceRow>(
    SCOPE,
    `SELECT d.fields.\`searchTerm\` AS searchTerm,
            MIN(d.fields.\`campaignId\`) AS campaignId,
            MIN(d.fields.\`adGroupId\`) AS adGroupId,
            MIN(d.fields.\`campaignName\`) AS campaignName,
            MIN(d.fields.\`adGroupName\`) AS adGroupName,
            MIN(d.fields.\`matchType\`) AS matchType,
            ${sum('impressions')} AS impressions,
            ${sum('clicks')} AS clicks,
            ${sum('spend')} AS spend,
            ${sum('sales')} AS sales,
            ${sum('orders')} AS orders
       FROM ${ROWS} AS d
       WHERE ${conditions.join(' AND ')}
       GROUP BY d.fields.\`searchTerm\`, d.fields.\`campaignId\`,
                d.fields.\`adGroupId\`, d.fields.\`matchType\`
       ORDER BY ${sum('clicks')} DESC`,
    { parameters, readonly: true }
  );
  return rows;
}

/** One reimbursement (or reversal) row, as Amazon reported it. */
export type ReimbursementRow = {
  date?: string;
  sku?: string;
  fnsku?: string;
  /** "Lost_Inbound", "Reimbursement_Reversal", "CustomerReturn", … */
  reason?: string;
  quantity: number;
  amount: number;
  currency?: string;
  reimbursementId?: string;
  /** On a reversal: the reimbursement it claws back. */
  originalReimbursementId?: string;
  caseId?: string;
};

/**
 * Every reimbursement row for a seller, reversals included.
 *
 * Deliberately NOT netted here: which reversal cancels which payment is a
 * judgement with an exact path (`originalReimbursementId`) and a fallback
 * (same SKU and amount), and it belongs in tested TypeScript, not in a query.
 * Callers get the rows Amazon reported and net them accountably.
 */
export async function queryReimbursements(params: {
  sellerId: string;
  skus?: string[];
}): Promise<ReimbursementRow[]> {
  const conditions = [
    'd.sellerId = $sellerId',
    "d.reportKind = 'reimbursement'",
  ];
  const parameters: Record<string, unknown> = { sellerId: params.sellerId };
  if (params.skus?.length) {
    conditions.push('d.fields.msku IN $skus');
    parameters['skus'] = params.skus;
  }

  const { rows } = await reportStorage.executeQuery<ReimbursementRow>(
    SCOPE,
    `SELECT d.fields.\`date\` AS \`date\`,
            d.fields.msku AS sku,
            d.fields.fnsku AS fnsku,
            d.fields.reason AS reason,
            IFMISSINGORNULL(TONUMBER(d.fields.quantity), 0) AS quantity,
            IFMISSINGORNULL(TONUMBER(d.fields.amountTotal), 0) AS amount,
            d.fields.currency AS currency,
            d.fields.reimbursementId AS reimbursementId,
            d.fields.originalReimbursementId AS originalReimbursementId,
            d.fields.caseId AS caseId
       FROM ${ROWS} AS d
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.fields.\`date\``,
    { parameters, readonly: true }
  );
  return rows;
}

/**
 * A caller asked for a field this report does not have. Carries the valid names
 * so the answer is "here is what you can group by", not "no".
 */
export class ReportQueryError extends Error {
  constructor(message: string, readonly validFields: ReportFieldName[]) {
    super(message);
    this.name = 'ReportQueryError';
  }
}

/** One group of a totalled query. */
export type ReportAggregateGroup = {
  /** The grouping columns' values. Empty object when nothing was grouped by. */
  key: Partial<Record<ReportFieldName, string | null>>;
  total: number;
  rows: number;
  /** Rows that HAD a value which would not parse. Never counted as zero. */
  unparsed: number;
  /**
   * Rows with no such column at all.
   *
   * Distinct from `unparsed`, and the difference matters: a column absent from
   * every stored row is not a total of zero, it is a question that cannot be
   * answered from what was imported — an export that lacked the column, or rows
   * stored before it was mapped. Without this the query answers 0 and means
   * "you were not charged".
   */
  absent: number;
};

export type ReportAggregate = {
  kind: ReportKind;
  measure: ReportFieldName;
  /**
   * The spreadsheet columns this measure was read from.
   *
   * Provenance travels with the figure because a total on its own is not
   * checkable, and an unverifiable number invites a reader to substitute its
   * own. A model asked for storage fees, given "27.65", guessed aloud that the
   * tool had summed the wrong column and sent the seller to Excel — while the
   * number was exactly right. Saying "amountTotal, from
   * estimated_monthly_storage_fee" ends that argument with evidence.
   */
  measureColumns: string[];
  groupBy: ReportFieldName[];
  groups: ReportAggregateGroup[];
  rowsMatched: number;
  /** Rows the measure could not be read from, across every group. */
  unparsed: number;
  /** Rows carrying no such column at all, across every group. */
  absent: number;
  /** Set when `limit` cut the group list — the totals shown are not all of them. */
  truncated: boolean;
};

/** Groups returned by default. Enough for a per-ASIN breakdown of a catalogue. */
const AGGREGATE_LIMIT = 500;

/** Backticked because `date` and several others are reserved words in N1QL. */
function fieldPath(field: ReportFieldName): string {
  return `d.fields.\`${field}\``;
}

/**
 * The parsed number for a field, written at ingest by `readReportNumber`.
 *
 * MISSING where the value would not parse, and — for rows stored before numeric
 * parsing existed — missing everywhere. The query reports that as unreadable
 * rather than as zero, which is the honest answer: those rows have to be
 * dropped and imported again to be totalled.
 */
function numberPath(field: ReportFieldName): string {
  return `d.numbers.\`${field}\``;
}

/** Fields this report actually declares — the only identifiers ever interpolated. */
function queryableFields(kind: ReportKind): ReportFieldName[] {
  const definition = REPORTS[kind];
  return (Object.keys(definition.fields) as ReportFieldName[]).filter(
    (field) => definition.fields[field]?.length
  );
}

function assertField(
  kind: ReportKind,
  field: string,
  role: string
): ReportFieldName {
  const valid = queryableFields(kind);
  if (!valid.includes(field as ReportFieldName)) {
    throw new ReportQueryError(
      `"${field}" is not a ${role} on the ${REPORTS[kind].label} report. ` +
        `Available: ${valid.join(', ')}.`,
      valid
    );
  }
  return field as ReportFieldName;
}

/**
 * The measure has to be a field that holds a number.
 *
 * Summing a text column is not an error the database will report — it answers
 * zero, or null, and a caller reads that as "you were not charged". Refusing it
 * by name, with the numeric columns listed, turns a wrong answer into a retry.
 */
function assertNumericField(kind: ReportKind, field: string): ReportFieldName {
  const measure = assertField(kind, field, 'measure');
  const numeric = queryableFields(kind).filter((entry) =>
    NUMERIC_FIELDS.has(entry)
  );
  if (!NUMERIC_FIELDS.has(measure)) {
    throw new ReportQueryError(
      `"${field}" on the ${REPORTS[kind].label} report holds text, not a ` +
        `number, so it cannot be totalled. Numeric measures: ${
          numeric.length ? numeric.join(', ') : 'none on this report'
        }.`,
      numeric
    );
  }
  return measure;
}

/**
 * Total a numeric column of stored report rows, grouped by any of its own
 * columns. The general form of "what did I pay for these two ASINs".
 *
 * Reads stored rows only, exactly like `queryLedgerRows` — an empty result
 * means nothing was ingested, not that nothing happened, so coverage still has
 * to be checked before concluding anything from zero.
 *
 * Reduced in the query service rather than in the caller: a year of storage
 * fees is tens of thousands of rows and the answer is a handful of numbers,
 * and the same reasoning that put `queryReceiptAggregates` in N1QL applies
 * here with a bigger multiplier.
 *
 * `currency` joins the grouping automatically wherever the report has one.
 * Summing GBP into USD produces a number that is wrong in a way no reader can
 * see, and no caller remembers to guard against it every time.
 */
export async function queryReportAggregate(params: {
  sellerId: string;
  kind: ReportKind;
  /** Logical field holding the number to total. */
  measure: string;
  groupBy?: string[];
  from?: string;
  to?: string;
  /** field -> accepted values. Matched case-insensitively. */
  filters?: Record<string, string[]>;
  limit?: number;
}): Promise<ReportAggregate> {
  const measure = assertNumericField(params.kind, params.measure);

  const requested = (params.groupBy ?? []).map((field) =>
    assertField(params.kind, field, 'grouping')
  );
  const hasCurrency = queryableFields(params.kind).includes('currency');
  const groupBy = [
    ...new Set(
      hasCurrency && measure !== 'currency'
        ? [...requested, 'currency' as ReportFieldName]
        : requested
    ),
  ];

  const conditions = ['d.sellerId = $sellerId', 'd.reportKind = $kind'];
  const parameters: Record<string, unknown> = {
    sellerId: params.sellerId,
    kind: params.kind,
  };
  if (params.from) {
    conditions.push('d.fields.`date` >= $from');
    parameters['from'] = params.from;
  }
  if (params.to) {
    conditions.push('d.fields.`date` <= $to');
    parameters['to'] = params.to;
  }
  for (const [index, [field, values]] of Object.entries(
    params.filters ?? {}
  ).entries()) {
    const column = assertField(params.kind, field, 'filter');
    if (!values.length) continue;
    // Upper-cased both sides: an ASIN typed in lower case is the same ASIN, and
    // a filter that silently matches nothing reads as "you were not charged".
    conditions.push(`UPPER(${fieldPath(column)}) IN $filter${index}`);
    parameters[`filter${index}`] = values.map((value) => value.toUpperCase());
  }

  // Interpolated rather than bound — N1QL will not take a parameter in LIMIT —
  // so it is forced to a positive integer here and cannot be anything else.
  const limit = Math.max(
    1,
    Math.floor(Number(params.limit) || AGGREGATE_LIMIT)
  );

  // The database only ADDS UP. Every value was read into a number at ingest by
  // `readReportNumber`, which is a plain function under test — the arithmetic
  // that used to live here as N1QL regular expressions could not be executed by
  // any test, and was wrong.
  //
  // A row counts as unreadable when the export HAD a value and it would not
  // parse; a blank cell is simply not a figure and is not held against the
  // total. Rows stored before numeric parsing existed have no `numbers` at all,
  // so they all land here — which is the honest report, and says to re-import.
  const unreadable =
    `CASE WHEN ${numberPath(measure)} IS MISSING ` +
    `AND ${fieldPath(measure)} IS NOT MISSING ` +
    `AND ${fieldPath(measure)} != "" THEN 1 ELSE 0 END`;

  const { rows } = await reportStorage.executeQuery<
    Record<string, unknown> & {
      total: number;
      rows: number;
      unparsed: number;
      absent: number;
    }
  >(
    SCOPE,
    `SELECT ${[
      ...groupBy.map((field) => `${fieldPath(field)} AS \`${field}\``),
      `SUM(${numberPath(measure)}) AS total`,
      'COUNT(*) AS `rows`',
      `SUM(${unreadable}) AS unparsed`,
      `SUM(CASE WHEN ${fieldPath(measure)} IS MISSING THEN 1 ELSE 0 END) ` +
        'AS absent',
    ].join(', ')}
       FROM ${ROWS} AS d
       WHERE ${conditions.join(' AND ')}
       ${groupBy.length ? `GROUP BY ${groupBy.map(fieldPath).join(', ')}` : ''}
       ORDER BY ABS(SUM(${numberPath(measure)})) DESC
       LIMIT ${limit + 1}`,
    { parameters, readonly: true }
  );

  const truncated = rows.length > limit;
  const groups = rows.slice(0, limit).map((row) => ({
    key: Object.fromEntries(
      groupBy.map((field) => [field, (row[field] as string | null) ?? null])
    ) as Partial<Record<ReportFieldName, string | null>>,
    // SUM over rows that are all unreadable is NULL, not 0.
    total: typeof row.total === 'number' ? row.total : 0,
    rows: row.rows,
    unparsed: row.unparsed,
    absent: row.absent,
  }));

  return {
    kind: params.kind,
    measure,
    measureColumns: REPORTS[params.kind].fields[measure] ?? [],
    groupBy,
    groups,
    rowsMatched: groups.reduce((sum, group) => sum + group.rows, 0),
    unparsed: groups.reduce((sum, group) => sum + group.unparsed, 0),
    absent: groups.reduce((sum, group) => sum + group.absent, 0),
    truncated,
  };
}
