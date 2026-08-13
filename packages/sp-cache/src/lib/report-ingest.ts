import crypto from 'node:crypto';
import {
  NUMERIC_FIELDS,
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

/** Fields holding a calendar date, normalised to ISO so they can be ordered. */
const DATE_FIELDS = new Set<ReportFieldName>([
  'date',
  'shipmentDate',
  'requestDate',
]);

/**
 * Normalise a report date to YYYY-MM-DD.
 *
 * Amazon writes MM/DD/YYYY. Sorting that lexically works by accident inside one
 * calendar year and inverts across a boundary — 12/15/2025 sorts after
 * 01/05/2026 — so every coverage window spanning New Year would come back
 * backwards. Values already ISO are returned unchanged; anything unrecognised
 * is left alone rather than guessed at.
 *
 * A bare month ("2026-06", which is all the storage fee report states) becomes
 * the first of that month. Left as-is it is a PREFIX of every day in it, so
 * `date >= '2026-06-01'` excludes the month it names and any range query over a
 * month-granular report silently returns nothing.
 */
export function toIsoDate(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const month = value.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[1]}-${month[2]}-01`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return value;
}

/**
 * Read a report cell as a number, or null.
 *
 * Runs ONCE, here, at ingest — not at query time. The first version of the
 * aggregate query did this arithmetic in N1QL, where no test could execute it,
 * and shipped reading every three-decimal figure as European thousands: "0.011"
 * totalled as 11 and "0.787" as 787, turning a $23 storage month into thousands
 * in front of a seller. A number the database merely SUMS cannot be got wrong
 * by the database, and this function is covered by tests that run.
 *
 * Only some of locale formatting is decidable. "1.234" is genuinely ambiguous —
 * 1234 written in German, 1.234 written in English — and nothing in the string
 * separates them, so the English reading wins: it is what Amazon's own machine
 * exports always are. Only UNAMBIGUOUS European forms are converted, being ones
 * English never writes: more than one dot group ("1.234.567"), dot groups with
 * a comma decimal ("1.234,56"), or a comma with one or two digits ("12,50").
 *
 * Anything unreadable — blank, "N/A", "--" — is null, and callers COUNT those
 * rather than treating them as zero. A total that quietly skips rows is the
 * failure this whole path exists to remove.
 */
export function readReportNumber(value: string): number | null {
  const cleaned = value.replace(/[\s$£€]/g, '');
  if (!cleaned) return null;

  const europeanGroups = /^-?\d{1,3}(\.\d{3}){2,}$/;
  const europeanGroupsWithDecimal = /^-?\d{1,3}(\.\d{3})+,\d+$/;
  // One or two digits after the comma: "1,234" is three, and is English.
  const europeanDecimal = /^-?\d+,\d{1,2}$/;

  const normalised =
    europeanGroups.test(cleaned) ||
    europeanGroupsWithDecimal.test(cleaned) ||
    europeanDecimal.test(cleaned)
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');

  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ReportRow = {
  rowId: string;
  /** Owning seller — part of identity, so two sellers cannot collide. */
  sellerId: string;
  reportKind: ReportKind;
  reportType: string;
  /** Mapped logical fields, present only when the header was recognised. */
  fields: Partial<Record<ReportFieldName, string>>;
  /**
   * The numeric fields, read as numbers. Absent where the value would not
   * parse, which is how a total can say how many rows it had to leave out.
   *
   * Alongside `fields` rather than replacing it: the string is what the export
   * actually said and stays the evidence for a claim.
   */
  numbers?: Partial<Record<ReportFieldName, number>>;
  /** Every column verbatim — kept only when some column was unrecognised. */
  raw?: Record<string, string>;
  /**
   * Which columns the registry extracted when this row was stored.
   *
   * Not part of identity — identity is the raw content, and must stay that way
   * or every mapping change would re-import history as new rows. This is the
   * other half of that trade: because identity ignores the mapping, a re-import
   * of the same file dedupes and the OLD interpretation survives, so sending
   * the file again — the obvious repair, and the one a user will try — silently
   * does nothing and reports success. Comparing this on write is what lets a
   * re-import actually re-read a file under the current registry.
   */
  mappingVersion?: string;
  /** reportOptions this row was fetched under, when known. */
  options?: Record<string, string>;
  /** Snapshot date for snapshot reports; the sync/import window end otherwise. */
  snapshotDate?: string;
  /**
   * The import that first stored this row. Coverage is derived by grouping on
   * it, so a window can only be reported as covered while its rows still exist.
   */
  importId?: string;
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

/**
 * Columns that DESCRIBE a row rather than identify it.
 *
 * A seller can rename a listing at any time. Two real exports of the same
 * events, taken either side of a rename, shared zero row ids and every figure
 * doubled — so the title must not be part of identity.
 */
const DESCRIPTIVE_FIELDS = new Set<ReportFieldName>(['title']);

function rowIdFor(
  definition: ReportDefinition,
  sellerId: string,
  raw: Record<string, string>,
  /** How many earlier rows in this file already had this same identity. */
  occurrence: number,
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
    // A ledger event carries no id from Amazon, and the ledger legitimately
    // contains repeated identical lines: three separate customer shipments of
    // one unit from the same FC on the same day are three events, not one.
    // Without this they collapsed, losing 65 of 361 rows on a real export.
    String(occurrence),
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
      // Already claimed by an earlier field — try this field's NEXT alias
      // rather than overwriting.
      //
      // Two fields may legitimately share an alias. The settlement report is
      // the live case: `date` and `postedDate` both list `posteddate`, and the
      // real file carries `posted-date` AND `posted-date-time`. Overwriting
      // meant `postedDate` took the column `date` had claimed, `date` was
      // stored nowhere, and `posted-date-time` was reported unrecognised —
      // while `foundFields` still listed `date`, so `missingFields` said
      // nothing. Silent, and it cost the settlement report its date: no
      // ordering, no joins, and an empty coverage window on every import.
      //
      // Skipping instead makes the pairing order-independent: `date` takes
      // `posted-date`, `postedDate` falls through to `posted-date-time`, and a
      // field that genuinely finds nothing is reported by `missingFields`
      // because it never reaches `foundFields`.
      if (fieldByIndex.has(index)) continue;
      fieldByIndex.set(index, field);
      foundFields.add(field);
      break;
    }
  }

  // A column is "unrecognised" only if it is neither mapped nor deliberately
  // ignored. Both the warning and the decision to keep `raw` read from this, so
  // they cannot disagree about what counts.
  const ignored = new Set(definition.ignoredColumns ?? []);
  const isUnrecognised = (index: number) =>
    !fieldByIndex.has(index) && !ignored.has(normalized[index] ?? '');

  const hasUnmapped = headers.some((_, index) => isUnrecognised(index));

  // One fingerprint for the whole file: it describes the MAPPING, not any row's
  // contents, so a row whose cell happened to be empty is not mistaken for a
  // row parsed under different rules. The numeric marker is part of it because
  // moving a field into NUMERIC_FIELDS changes what is stored without changing
  // which columns were recognised.
  const mappingVersion = crypto
    .createHash('sha256')
    .update(
      [...fieldByIndex.values()]
        .map((field) => `${field}${NUMERIC_FIELDS.has(field) ? '#n' : ''}`)
        .sort()
        .join(',')
    )
    .digest('hex')
    .slice(0, 12);
  const rows: ReportRow[] = [];
  const seen = new Set<string>();
  /** Distinguishes genuinely repeated identical events within one export. */
  const occurrences = new Map<string, number>();
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
      // Normalise dates for storage, but NOT for identity: identity is built
      // from the raw columns above, so a formatting change here cannot
      // re-import history as new rows.
      if (value)
        fields[field] = DATE_FIELDS.has(field) ? toIsoDate(value) : value;
    });

    // Identity is built from the identifying columns only, so a renamed
    // listing does not re-import the whole history as new rows.
    const identifying: Record<string, string> = {};
    headers.forEach((header, index) => {
      const field = fieldByIndex.get(index);
      if (field && DESCRIPTIVE_FIELDS.has(field)) return;
      identifying[header] = cells[index] ?? '';
    });

    const signature = canonicalJson(identifying);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);

    const rowId = rowIdFor(
      definition,
      params.sellerId,
      identifying,
      occurrence,
      params.snapshotDate,
      params.options
    );
    if (seen.has(rowId)) continue;
    seen.add(rowId);

    // Read once, here. Identity is built from the raw columns above, so adding
    // these cannot re-import history as new rows — but by the same token an
    // existing row will NOT gain them on re-import, since it dedupes. Changing
    // what is stored means dropping the rows and loading them again.
    const numbers: Partial<Record<ReportFieldName, number>> = {};
    for (const [field, value] of Object.entries(fields) as Array<
      [ReportFieldName, string]
    >) {
      if (!NUMERIC_FIELDS.has(field)) continue;
      const parsed = readReportNumber(value);
      if (parsed !== null) numbers[field] = parsed;
    }

    rows.push({
      rowId,
      sellerId: params.sellerId,
      reportKind: definition.kind,
      reportType: definition.reportType,
      fields,
      ...(Object.keys(numbers).length ? { numbers } : {}),
      mappingVersion,
      // `raw` duplicates every mapped field, so keep it only when the file had
      // columns the registry did not recognise — that is the case where the
      // extra bytes buy something (a column we may need to map later).
      ...(hasUnmapped ? { raw } : {}),
      snapshotDate: params.snapshotDate,
      ...(params.options ? { options: params.options } : {}),
      ingestedAt: Date.now(),
    });
  }

  const unmappedHeaders = headers.filter((_, index) => isUnrecognised(index));
  const missingFields = (
    Object.keys(definition.fields) as ReportFieldName[]
  ).filter(
    (field) => !foundFields.has(field) && definition.fields[field]?.length
  );

  return { rows, unmappedHeaders, missingFields };
}

/**
 * Bring a row stored under an older registry up to what it would be today,
 * from what is already in it. Returns null when nothing changed.
 *
 * This is a ONE-WAY conversion of old data, not a compatibility layer: rows
 * written before dates were normalised or numbers were parsed are rewritten to
 * carry both, and afterwards there is only one representation.
 *
 * It needs no source file, because everything it derives is a pure function of
 * the strings the row already holds — which is what makes it possible to repair
 * a sync whose export nobody kept.
 *
 * `mappingVersion` is deliberately NOT set. It records which columns the
 * registry extracted from a FILE, and this row never saw one; inventing a value
 * would tell a later re-import to skip a row it should re-read. Leaving it
 * absent keeps re-importing the file the stronger repair.
 */
export function remapStoredRow(row: ReportRow): ReportRow | null {
  const fields = { ...row.fields };
  let changed = false;

  for (const field of DATE_FIELDS) {
    const value = fields[field];
    if (!value) continue;
    const iso = toIsoDate(value);
    if (iso === value) continue;
    fields[field] = iso;
    changed = true;
  }

  const numbers: Partial<Record<ReportFieldName, number>> = {};
  for (const [field, value] of Object.entries(fields) as Array<
    [ReportFieldName, string]
  >) {
    if (!NUMERIC_FIELDS.has(field)) continue;
    const parsed = readReportNumber(value);
    if (parsed !== null) numbers[field] = parsed;
  }
  const before = row.numbers ?? {};
  if (
    Object.keys(numbers).length !== Object.keys(before).length ||
    (Object.keys(numbers) as ReportFieldName[]).some(
      (field) => before[field] !== numbers[field]
    )
  ) {
    changed = true;
  }

  if (!changed) return null;
  return {
    ...row,
    fields,
    ...(Object.keys(numbers).length ? { numbers } : {}),
  };
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
  /**
   * The kind claimed by a header no other report has, when one matched.
   *
   * Separate from `kind` because the two answer different questions. A caller
   * acting on a user's explicit "import this report" can accept a merely-best
   * guess; one importing automatically, because a file happened to be attached,
   * should not — and only this field tells it whether the identification rests
   * on a unique marker or on a share of columns any inventory export might have.
   */
  decisive: ReportKind | null;
  scores: Array<{ kind: ReportKind; matched: number; possible: number }>;
} {
  const headerLine = text.split(/\r?\n/).find((line) => line.trim().length);
  if (!headerLine) {
    return { kind: null, confidence: 0, decisive: null, scores: [] };
  }

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
    // FIRST deliberately: `decisiveHit` takes the first match in declaration
    // order, and `removal-order` below claims the weak marker `orderid`, which
    // a settlement file legitimately carries — so without this a settlement
    // report is confidently identified as a removal order and its fees are
    // parsed into removal columns. `settlementid` appears in no other report.
    settlement: ['settlementid'],
    // Unique to the storage fee report — no other kind carries either column,
    // so its position here is not load-bearing the way settlement's is.
    'storage-fee': ['estimatedmonthlystoragefee', 'monthofcharge'],
    reimbursement: ['reimbursementid'],
    'removal-shipment': ['trackingnumber'],
    'removal-order': ['removalorderid', 'orderid'],
    'ledger-detail': ['eventtype', 'referenceid'],
    stranded: ['strandedreason'],
    // Expected-vs-received is unique to the inbound performance report and is
    // the leg that makes shipment reconciliation possible without the API role.
    'inbound-performance': ['quantityreceived', 'problemtype'],
    // No FBA report carries a customer search term.
    'search-term': ['customersearchterm'],
    // Columns only the ads console's campaign export carries. NOT
    // 'campaignname' — the search-term report has that too, and a weak marker
    // here would misfile one as the other.
    'campaign-performance': ['viewablecpmvcpm', 'mainimdbadclicks'],
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
  return {
    kind,
    confidence: Math.round(confidence * 100) / 100,
    decisive: decisiveHit ?? null,
    scores,
  };
}
