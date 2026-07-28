import crypto from 'node:crypto';
import {
  normalizeHeader,
  REPORTS,
  type ReportDefinition,
  type ReportFieldName,
  type ReportKind,
} from './report-registry.js';

/**
 * Parse and de-duplicate FBA report rows, from either an API sync or an
 * uploaded file. Both paths land here so they cannot diverge.
 *
 * IDENTITY IS A CONTENT HASH of the whole raw row, not a natural key. The
 * reasoning matters: Amazon regenerates these reports deterministically, so
 * re-fetching an overlapping window yields byte-identical rows and they collapse
 * — which is what "no dups" requires. A natural key would be worse than useless
 * here: if the key turned out not to be unique (a SKU with two identical
 * adjustments on one day), distinct events would OVERWRITE each other, losing
 * data silently. Collapsing rows that are identical in every column loses
 * nothing a consumer could have distinguished anyway.
 *
 * The exception is snapshot reports (stranded inventory), where the same row on
 * two different days is genuinely two facts — identity there includes the
 * snapshot date.
 */

export type ReportRow = {
  rowId: string;
  /** Owning seller — part of identity, so two sellers cannot collide. */
  sellerId: string;
  reportKind: ReportKind;
  reportType: string;
  /** Mapped logical fields, present only when the header was recognised. */
  fields: Partial<Record<ReportFieldName, string>>;
  /** Every column verbatim — kept only when some column was unrecognised. */
  raw?: Record<string, string>;
  /** reportOptions this row was fetched under, when known. */
  options?: Record<string, string>;
  /** Snapshot date for snapshot reports; the sync/import window end otherwise. */
  snapshotDate?: string;
  ingestedAt: number;
};

export type ParseResult = {
  rows: ReportRow[];
  /** Headers we could not map to a logical field — surfaced, not swallowed. */
  unmappedHeaders: string[];
  /** Logical fields the registry expected but this file did not contain. */
  missingFields: ReportFieldName[];
};

/** Split a TSV/CSV line honouring quoted cells. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Amazon ships TSV for FBA reports, but uploaded files are often CSV. */
function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs >= commas ? '\t' : ',';
}

function canonicalJson(row: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((key) => [key, row[key]])
  );
}

function rowIdFor(
  definition: ReportDefinition,
  sellerId: string,
  raw: Record<string, string>,
  snapshotDate?: string,
  options?: Record<string, string>
): string {
  const material = [
    sellerId,
    definition.reportType,
    definition.snapshot ? snapshotDate ?? '' : '',
    // Aggregates only — an event is the same fact whichever filter fetched
    // it, so including options here would store one receipt twice.
    definition.identityIncludesOptions && options ? canonicalJson(options) : '',
    canonicalJson(raw),
  ].join('\u0000');
  return crypto
    .createHash('sha256')
    .update(material)
    .digest('hex')
    .slice(0, 40);
}

/**
 * Parse a report body into rows. Never throws on a malformed line — a bad row
 * is reported through `unmappedHeaders`/skipped rather than aborting an import
 * of thousands of good rows.
 */
export function parseReport(params: {
  kind: ReportKind;
  sellerId: string;
  text: string;
  /** Report window end, or the day the file was pulled. */
  snapshotDate?: string;
  /** reportOptions used to fetch it; recorded, and identity-bearing for aggregates. */
  options?: Record<string, string>;
}): ParseResult {
  const definition = REPORTS[params.kind];
  const lines = params.text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { rows: [], unmappedHeaders: [], missingFields: [] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter);
  const normalized = headers.map(normalizeHeader);

  // header index -> logical field
  const fieldByIndex = new Map<number, ReportFieldName>();
  const foundFields = new Set<ReportFieldName>();
  for (const [field, aliases] of Object.entries(definition.fields) as Array<
    [ReportFieldName, string[]]
  >) {
    // Walk the ALIASES in declared order, not the headers. Scanning headers
    // first lets column order in the file decide precedence: a reimbursement
    // report listing amount-per-unit before amount-total would map amountTotal
    // to the per-unit figure and understate every claim.
    for (const alias of aliases) {
      const index = normalized.indexOf(alias);
      if (index < 0) continue;
      fieldByIndex.set(index, field);
      foundFields.add(field);
      break;
    }
  }

  const hasUnmapped = headers.some((_, index) => !fieldByIndex.has(index));
  const rows: ReportRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    // Tolerate ragged rows: pad short ones, ignore overflow.
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      raw[header] = cells[index] ?? '';
    });
    if (Object.values(raw).every((value) => value === '')) continue;

    const fields: Partial<Record<ReportFieldName, string>> = {};
    fieldByIndex.forEach((field, index) => {
      const value = cells[index];
      if (value) fields[field] = value;
    });

    const rowId = rowIdFor(
      definition,
      params.sellerId,
      raw,
      params.snapshotDate,
      params.options
    );
    // Collapse duplicates inside a single file too — Amazon reports do contain
    // repeated lines when a window overlaps a previous export.
    if (seen.has(rowId)) continue;
    seen.add(rowId);

    rows.push({
      rowId,
      sellerId: params.sellerId,
      reportKind: definition.kind,
      reportType: definition.reportType,
      fields,
      // `raw` duplicates every mapped field, so keep it only when the file had
      // columns the registry did not recognise — that is the case where the
      // extra bytes buy something (a column we may need to map later).
      ...(hasUnmapped ? { raw } : {}),
      snapshotDate: params.snapshotDate,
      ...(params.options ? { options: params.options } : {}),
      ingestedAt: Date.now(),
    });
  }

  const unmappedHeaders = headers.filter(
    (_, index) => !fieldByIndex.has(index)
  );
  const missingFields = (
    Object.keys(definition.fields) as ReportFieldName[]
  ).filter(
    (field) => !foundFields.has(field) && definition.fields[field]?.length
  );

  return { rows, unmappedHeaders, missingFields };
}

/**
 * Decode a downloaded report file.
 *
 * Seller Central's own downloads are frequently UTF-16LE TSV, which read as
 * interleaved NULs if you assume UTF-8 — the file parses to zero usable rows
 * with no obvious error. API-delivered reports are UTF-8 or Latin-1. Sniff the
 * BOM, then fall back on replacement characters.
 */
export function decodeReportBuffer(buffer: Buffer): string {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.subarray(2).toString('utf16le');
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      // UTF-16BE: swap byte pairs, Node has no direct decoder.
      const swapped = Buffer.from(buffer.subarray(2));
      swapped.swap16();
      return swapped.toString('utf16le');
    }
  }
  // No BOM but every other byte is NUL => UTF-16LE written without one.
  if (buffer.length >= 4 && buffer[1] === 0 && buffer[3] === 0) {
    return buffer.toString('utf16le');
  }
  const utf8 = buffer.toString('utf8');
  return utf8.includes('\uFFFD') ? buffer.toString('latin1') : utf8;
}

/**
 * Work out which report a file is from its headers, so an upload does not
 * depend on the user telling us (or on a filename Amazon does not control).
 * Scores each definition by how many of its logical fields it can map.
 */
export function detectReportKind(text: string): {
  kind: ReportKind | null;
  confidence: number;
  scores: Array<{ kind: ReportKind; matched: number; possible: number }>;
} {
  const headerLine = text.split(/\r?\n/).find((line) => line.trim().length);
  if (!headerLine) return { kind: null, confidence: 0, scores: [] };

  const delimiter = detectDelimiter(headerLine);
  const headers = new Set(
    splitLine(headerLine, delimiter).map(normalizeHeader)
  );

  const scores = (Object.keys(REPORTS) as ReportKind[]).map((kind) => {
    const fields = Object.entries(REPORTS[kind].fields) as Array<
      [ReportFieldName, string[]]
    >;
    const usable = fields.filter(([, aliases]) => aliases.length);
    const matched = usable.filter(([, aliases]) =>
      aliases.some((alias) => headers.has(alias))
    ).length;
    return { kind, matched, possible: usable.length };
  });

  // Rank by share of the definition matched, tie-broken by absolute matches so
  // a small definition cannot beat a fully-matched larger one.
  const ranked = [...scores].sort(
    (a, b) =>
      b.matched / b.possible - a.matched / a.possible || b.matched - a.matched
  );
  const best = ranked[0];
  const confidence = best.possible ? best.matched / best.possible : 0;

  // Distinguishing marks that separate otherwise similar FBA reports.
  const decisive: Partial<Record<ReportKind, string[]>> = {
    reimbursement: ['reimbursementid'],
    'removal-shipment': ['trackingnumber'],
    'removal-order': ['removalorderid', 'orderid'],
    'ledger-detail': ['eventtype', 'referenceid'],
    stranded: ['strandedreason'],
    // Expected-vs-received is unique to the inbound performance report and is
    // the leg that makes shipment reconciliation possible without the API role.
    'inbound-performance': ['quantityreceived', 'problemtype'],
  };
  const decisiveHit = (Object.keys(decisive) as ReportKind[]).find((kind) =>
    decisive[kind]?.some((header) => headers.has(header))
  );

  // A decisive header beats a marginally better score.
  const kind =
    decisiveHit && confidence < 0.9
      ? decisiveHit
      : confidence >= 0.5
      ? best.kind
      : null;
  return { kind, confidence: Math.round(confidence * 100) / 100, scores };
}
