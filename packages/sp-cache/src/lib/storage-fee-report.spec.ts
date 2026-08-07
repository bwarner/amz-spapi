/**
 * Monthly Storage Fees, the report that made #101: a seller asked what two
 * ASINs cost them to store, the Finances API 403'd for want of a role, and the
 * CSV they attached instead could only be previewed 50 rows at a time.
 *
 * The properties under test are the ones that turn that file into an answer:
 * it must be identified from its headers alone, its month must become a date
 * that range queries can compare, and its fee column must reach `amountTotal`
 * where the aggregate query can total it.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  detectReportKind,
  parseReport,
  readReportNumber,
  remapStoredRow,
  toIsoDate,
  type ReportRow,
} from './report-ingest.js';
import { REPORTS } from './report-registry.js';
import {
  queryReportAggregate,
  ReportQueryError,
  reportStorage,
  storeReportRows,
} from './report-store.js';

/**
 * The header of a REAL export, verbatim and in file order.
 *
 * Written from an actual Monthly Storage Fees download rather than from
 * memory, because writing it from memory is what went wrong: an invented
 * `total_incremental_fee` column, and a belief that the fee excluded the
 * utilisation surcharge, put a false claim in the agent's tool description and
 * sent it hunting for columns that were not there.
 */
const HEADER =
  'asin,fnsku,product_name,fulfillment_center,country_code,longest_side,' +
  'median_side,shortest_side,measurement_units,weight,weight_units,' +
  'item_volume,volume_units,product_size_tier,average_quantity_on_hand,' +
  'average_quantity_pending_removal,estimated_total_item_volume,' +
  'month_of_charge,storage_utilization_ratio,storage_utilization_ratio_units,' +
  'base_rate,utilization_surcharge_rate,avg_qty_for_sus,est_vol_for_sus,' +
  'est_base_msf,est_sus,currency,estimated_monthly_storage_fee,' +
  'dangerous_goods_storage_type,eligible_for_inventory_discount,' +
  'qualifies_for_inventory_discount,total_incentive_fee_amount,' +
  'breakdown_incentive_fee_amount,average_quantity_customer_orders';

function row(
  asin: string,
  /** Amazon's own arithmetic: the fee IS base + surcharge. */
  parts: { base: string; surcharge: string; fee: string },
  overrides: Partial<{ fc: string; quantity: string; month: string }> = {}
): string {
  const o = { fc: "'ACY1'", quantity: '18.5', month: '2026-06', ...overrides };
  return [
    asin,
    'X001ABCDEF',
    'Example Coffee 250g',
    o.fc,
    'US',
    '9.5',
    '6.2',
    '4.1',
    'inches',
    '1.2',
    'pounds',
    '0.14',
    'cubic feet',
    'Large standard-size',
    o.quantity,
    '0.0',
    '2.6',
    o.month,
    '13.2',
    'weeks',
    '0.78',
    '0.0',
    '11.93',
    '2.2279',
    parts.base,
    parts.surcharge,
    'USD',
    parts.fee,
    '--',
    'N',
    'N',
    '0.0',
    '--',
    '0.0',
  ].join(',');
}

const FILE = [
  HEADER,
  row('B0FRD9RR2B', { base: '2.16', surcharge: '0.0', fee: '2.16' }),
  row(
    'B0FRD9RR2B',
    { base: '0.74', surcharge: '0.2', fee: '0.94' },
    { fc: "'MDW2'" }
  ),
  row('B0F1234567', { base: '11.40', surcharge: '0.0', fee: '11.40' }),
].join('\n');

describe('storage fee report', () => {
  it('is identified from its headers, with no filename to go on', () => {
    // The whole attachment path depends on this: the file arrives named
    // whatever the seller's browser called it, and nothing else identifies it.
    const detection = detectReportKind(FILE);
    expect(detection.kind).toBe('storage-fee');
  });

  it('is identified DECISIVELY, which is what the auto-import path requires', () => {
    // An attachment nobody described is imported only on a header no other
    // report has. Losing that marker would quietly turn the chat path off
    // while leaving the explicit upload working, so it is asserted here.
    expect(detectReportKind(FILE).decisive).toBe('storage-fee');
  });

  it('outscores every other kind, not merely wins on a tie-break', () => {
    // The other money reports carry asin/currency/amount-shaped columns too,
    // and a wrong kind here files the fees where nothing will look for them.
    // A clear margin is what keeps that true as more kinds are added.
    const { scores } = detectReportKind(FILE);
    const share = (kind: string) => {
      const score = scores.find((entry) => entry.kind === kind);
      if (!score) throw new Error(`no score for ${kind}`);
      return score.matched / score.possible;
    };
    const others = scores
      .filter((entry) => entry.kind !== 'storage-fee')
      .map((entry) => share(entry.kind));
    expect(share('storage-fee')).toBeGreaterThan(Math.max(...others));
  });

  it('maps the fee to amountTotal and the month to a comparable date', () => {
    const { rows } = parseReport({
      kind: 'storage-fee',
      sellerId: 'A1SELLER',
      text: FILE,
    });

    expect(rows).toHaveLength(3);
    expect(rows[0].fields.asin).toBe('B0FRD9RR2B');
    expect(rows[0].fields.amountTotal).toBe('2.16');
    expect(rows[0].fields.currency).toBe('USD');
    expect(rows[0].fields.averageQuantityOnHand).toBe('18.5');
    expect(rows[0].fields.productSizeTier).toBe('Large standard-size');
    // The numeric fields are read once, here, and are what gets totalled. The
    // string stays alongside as the evidence for a claim.
    expect(rows[0].numbers?.amountTotal).toBe(2.16);
    expect(rows[0].numbers?.averageQuantityOnHand).toBe(18.5);
    // Text fields never become numbers, however numeric they look.
    expect(rows[0].numbers?.productSizeTier).toBeUndefined();
    // "2026-06" left as-is is a PREFIX of every day in June, so `>= 2026-06-01`
    // would exclude the month it names and the seller's range query would come
    // back empty.
    expect(rows[0].fields.date).toBe('2026-06-01');
  });

  it('maps the fee breakdown, and the breakdown adds up to the fee', () => {
    // The fee ALREADY contains the utilisation surcharge — Amazon computes it
    // as est_base_msf + est_sus. Believing otherwise is what put a false claim
    // in the tool description; asserting the arithmetic keeps it honest.
    const { rows } = parseReport({
      kind: 'storage-fee',
      sellerId: 'A1SELLER',
      text: FILE,
    });
    const split = rows[1];
    expect(split.numbers?.storageFeeBase).toBe(0.74);
    expect(split.numbers?.storageFeeSurcharge).toBe(0.2);
    expect(split.numbers?.amountTotal).toBe(0.94);
    expect(
      (split.numbers?.storageFeeBase ?? 0) +
        (split.numbers?.storageFeeSurcharge ?? 0)
    ).toBeCloseTo(split.numbers?.amountTotal ?? 0, 10);
  });

  it('keeps the columns it does not map, rather than dropping them', () => {
    const { rows, unmappedHeaders } = parseReport({
      kind: 'storage-fee',
      sellerId: 'A1SELLER',
      text: FILE,
    });
    expect(unmappedHeaders).toContain('base_rate');
    expect(rows[0].raw?.['base_rate']).toBe('0.78');
  });

  it('keeps two fulfilment centres for one ASIN as two rows', () => {
    // One ASIN is billed per FC per month. Collapsing them would understate
    // the fee by however many warehouses hold the stock.
    const { rows } = parseReport({
      kind: 'storage-fee',
      sellerId: 'A1SELLER',
      text: FILE,
    });
    const forAsin = rows.filter((r) => r.fields.asin === 'B0FRD9RR2B');
    expect(forAsin).toHaveLength(2);
    expect(new Set(forAsin.map((r) => r.rowId)).size).toBe(2);
  });

  it('declares a requestable report type', () => {
    // Requestable, unlike settlement — the upload path exists because the app
    // may lack the role, not because Amazon refuses to generate it.
    expect(REPORTS['storage-fee'].reportType).toBe(
      'GET_FBA_STORAGE_FEE_CHARGES_DATA'
    );
    expect(REPORTS['storage-fee'].autoGenerated).toBeUndefined();
  });
});

describe('readReportNumber', () => {
  /**
   * The regression that made this a function at all.
   *
   * These read as European thousands under the first implementation and came
   * back multiplied by a thousand: a real seller's $23 storage month was
   * reported as thousands of dollars. The arithmetic lived in N1QL, where no
   * test could run it. It lives here now, and these are values copied from
   * their actual Monthly Storage Fees export.
   */
  it('reads three-decimal figures as decimals, not as thousands', () => {
    expect(readReportNumber('0.011')).toBe(0.011);
    expect(readReportNumber('0.009')).toBe(0.009);
    expect(readReportNumber('0.787')).toBe(0.787);
    expect(readReportNumber('2.243')).toBe(2.243);
    expect(readReportNumber('1.140')).toBe(1.14);
  });

  it('reads the other shapes a real export contains', () => {
    expect(readReportNumber('1.7484')).toBe(1.7484);
    expect(readReportNumber('23.07')).toBe(23.07);
    expect(readReportNumber('0.0')).toBe(0);
    expect(readReportNumber('-4.50')).toBe(-4.5);
    // Amazon writes small figures in exponential notation.
    expect(readReportNumber('5.0E-4')).toBe(0.0005);
    expect(readReportNumber('6.0E-4')).toBe(0.0006);
  });

  it('converts only the unambiguous European forms', () => {
    // Two groups, or a comma decimal after them: English writes neither.
    expect(readReportNumber('1.234.567')).toBe(1234567);
    expect(readReportNumber('1.234,56')).toBe(1234.56);
    expect(readReportNumber('12,50')).toBe(12.5);
    // Comma thousands with a dot decimal is English and stays English.
    expect(readReportNumber('1,234.56')).toBe(1234.56);
    // Three digits after the comma is a thousands group, not a decimal.
    expect(readReportNumber('1,234')).toBe(1234);
  });

  it('strips currency symbols and padding', () => {
    expect(readReportNumber('$3.99')).toBe(3.99);
    expect(readReportNumber(' 7.10 ')).toBe(7.1);
    expect(readReportNumber('£12')).toBe(12);
  });

  it('returns null for anything that is not a figure', () => {
    // Null, never zero. A total that silently absorbs these is the failure the
    // whole path exists to remove.
    expect(readReportNumber('')).toBeNull();
    expect(readReportNumber('   ')).toBeNull();
    expect(readReportNumber('N/A')).toBeNull();
    expect(readReportNumber('--')).toBeNull();
    expect(readReportNumber('1.2.3')).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('pins a bare month to the first of that month', () => {
    expect(toIsoDate('2026-06')).toBe('2026-06-01');
  });

  it('leaves full dates and unrecognised values alone', () => {
    expect(toIsoDate('2026-06-15')).toBe('2026-06-15');
    expect(toIsoDate('06/15/2026')).toBe('2026-06-15');
    expect(toIsoDate('June')).toBe('June');
  });
});

describe('remapStoredRow', () => {
  /**
   * Repairing rows whose source file is gone — a sync from an API role since
   * revoked, an upload nobody kept. Re-importing cannot reach those, and
   * everything needed is already in the row.
   */
  function stored(overrides: Partial<ReportRow> = {}): ReportRow {
    return {
      rowId: 'row-1',
      sellerId: 'A1SELLER',
      reportKind: 'ledger-summary',
      reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA',
      fields: { date: '03/01/2026', lost: '4', endingBalance: '1,240' },
      ingestedAt: 0,
      ...overrides,
    };
  }

  it('normalises a date left in Amazon US format', () => {
    // "03/01/2026" sorts after "12/15/2025", so every coverage window spanning
    // New Year came back backwards and range queries missed the month named.
    const migrated = remapStoredRow(stored());
    expect(migrated?.fields.date).toBe('2026-03-01');
  });

  it('parses the numbers the row was stored without', () => {
    const migrated = remapStoredRow(stored());
    expect(migrated?.numbers?.lost).toBe(4);
    expect(migrated?.numbers?.endingBalance).toBe(1240);
  });

  it('leaves an already-current row alone, so it is safe to re-run', () => {
    const current = stored({
      fields: { date: '2026-03-01', lost: '4', endingBalance: '1,240' },
      numbers: { lost: 4, endingBalance: 1240 },
    });
    expect(remapStoredRow(current)).toBeNull();
  });

  it('does not invent a mappingVersion', () => {
    // The row never saw a file, so claiming one would tell a later re-import
    // to skip a row it should re-read. Re-importing stays the stronger repair.
    expect(remapStoredRow(stored())?.mappingVersion).toBeUndefined();
  });

  it('never rewrites identity or the raw evidence', () => {
    const before = stored({ raw: { Date: '03/01/2026' } });
    const after = remapStoredRow(before);
    expect(after?.rowId).toBe(before.rowId);
    expect(after?.raw).toEqual(before.raw);
  });
});

describe('re-importing a file after the mapping changed', () => {
  /**
   * The failure this exists to stop.
   *
   * A seller was told their fee column had not been captured and to re-attach
   * the file. They did, twice. Identity is a content hash, so every row deduped
   * and the old interpretation survived while the import reported success —
   * leaving them exactly where they started, and eventually being told to open
   * Excel. Re-sending the file is the repair anyone reaches for first, so it
   * has to be the repair.
   */
  const executeQuery = vi.fn();
  const original = reportStorage.executeQuery;

  beforeEach(() => {
    executeQuery.mockReset();
    reportStorage.executeQuery = executeQuery as typeof original;
  });
  afterEach(() => {
    reportStorage.executeQuery = original;
  });

  const parsed = () =>
    parseReport({ kind: 'storage-fee', sellerId: 'A1SELLER', text: FILE }).rows;

  /** Answers the lookup with whatever shape the rows are already stored in. */
  function alreadyStored(shape: (row: { rowId: string }) => unknown) {
    executeQuery.mockImplementation(async (_scope, statement, options) => {
      if (statement.includes('USE KEYS')) {
        const ids = (options.parameters.ids ?? []) as string[];
        return { rows: ids.map((id) => shape({ rowId: id })) };
      }
      return { rows: [] };
    });
  }

  it('re-reads rows stored under an older mapping, and says how many', async () => {
    alreadyStored((row) => ({
      id: row.rowId,
      mappingVersion: 'older00',
      importId: 'first-import',
    }));

    const rows = parsed();
    const result = await storeReportRows(rows, 'second-import');

    expect(result.stored).toBe(0);
    expect(result.duplicate).toBe(rows.length);
    expect(result.refreshed).toBe(rows.length);

    // Actually written, not merely counted.
    const writes = executeQuery.mock.calls.filter(([, statement]) =>
      statement.includes('UPSERT')
    );
    expect(writes.length).toBeGreaterThan(0);
  });

  it('keeps the import that first stored a row, so coverage does not move', async () => {
    alreadyStored((row) => ({
      id: row.rowId,
      mappingVersion: 'older00',
      importId: 'first-import',
    }));

    await storeReportRows(parsed(), 'second-import');

    const [, , options] = executeQuery.mock.calls.find(([, statement]) =>
      statement.includes('UPSERT')
    ) as [string, string, { parameters: Record<string, { importId: string }> }];
    expect(options.parameters['v0'].importId).toBe('first-import');
  });

  it('still skips rows whose mapping has not changed', async () => {
    // The dedupe that makes overlapping windows safe to re-sync has to survive.
    const rows = parsed();
    const versions = new Map(
      rows.map((row) => [row.rowId, row.mappingVersion])
    );
    alreadyStored((row) => ({
      id: row.rowId,
      mappingVersion: versions.get(row.rowId),
      importId: 'first-import',
    }));

    const result = await storeReportRows(rows, 'second-import');

    expect(result.duplicate).toBe(rows.length);
    expect(result.refreshed).toBe(0);
    expect(
      executeQuery.mock.calls.filter(([, s]) => s.includes('UPSERT'))
    ).toHaveLength(0);
  });

  it('treats rows stored before mappings were versioned as stale', async () => {
    // Every row already in the database predates this field.
    alreadyStored((row) => ({ id: row.rowId, importId: 'first-import' }));
    const result = await storeReportRows(parsed(), 'second-import');
    expect(result.refreshed).toBe(parsed().length);
  });

  it('fingerprints the mapping, not the row contents', async () => {
    // Two rows from one file describe the same columns even when a cell is
    // empty, or an empty cell would look like a different parse and churn.
    const rows = parsed();
    expect(new Set(rows.map((row) => row.mappingVersion)).size).toBe(1);
    expect(rows[0].mappingVersion).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('queryReportAggregate', () => {
  const executeQuery = vi.fn();
  const original = reportStorage.executeQuery;

  beforeEach(() => {
    executeQuery.mockReset();
    executeQuery.mockResolvedValue({ rows: [] });
    reportStorage.executeQuery = executeQuery as typeof original;
  });
  afterEach(() => {
    reportStorage.executeQuery = original;
  });

  it('sums a fee column grouped by ASIN, filtered to the ASINs asked about', async () => {
    executeQuery.mockResolvedValue({
      rows: [
        {
          asin: 'B0F1234567',
          currency: 'USD',
          total: 11.4,
          rows: 1,
          unparsed: 0,
        },
        {
          asin: 'B0FRD9RR2B',
          currency: 'USD',
          total: 3.1,
          rows: 2,
          unparsed: 0,
        },
      ],
    });

    const result = await queryReportAggregate({
      sellerId: 'A1SELLER',
      kind: 'storage-fee',
      measure: 'amountTotal',
      groupBy: ['asin'],
      from: '2026-01-01',
      to: '2026-12-31',
      // Lower case on purpose: a seller pasting an ASIN is not a lookup key.
      filters: { asin: ['b0frd9rr2b', 'B0F1234567'] },
    });

    const [, statement, options] = executeQuery.mock.calls[0];
    expect(statement).toContain('GROUP BY');
    expect(options.parameters.filter0).toEqual(['B0FRD9RR2B', 'B0F1234567']);
    expect(options.readonly).toBe(true);

    expect(result.groups[0]).toMatchObject({
      key: { asin: 'B0F1234567', currency: 'USD' },
      total: 11.4,
    });
    expect(result.rowsMatched).toBe(3);
    expect(result.unparsed).toBe(0);
    // Provenance travels with the figure: a total nobody can check is a total
    // that gets argued with, and one agent argued its way to sending a seller
    // to Excel while the number was right.
    expect(result.measureColumns).toContain('estimatedmonthlystoragefee');
  });

  it('adds up stored numbers and does no arithmetic of its own', async () => {
    // The database SUMs a number that was parsed at ingest. When it did the
    // parsing itself, in N1QL, nothing could test it and it was wrong.
    await queryReportAggregate({
      sellerId: 'A1SELLER',
      kind: 'storage-fee',
      measure: 'amountTotal',
    });
    const statement = executeQuery.mock.calls[0][1] as string;

    expect(statement).toContain('SUM(d.numbers.`amountTotal`)');
    expect(statement).not.toMatch(/REGEXP_LIKE|TONUMBER/);
  });

  it('refuses to total a text column instead of answering zero', async () => {
    // SUM over text is not an error the database reports — it answers null,
    // and a caller reads that as "you were not charged".
    await expect(
      queryReportAggregate({
        sellerId: 'A1SELLER',
        kind: 'storage-fee',
        measure: 'productSizeTier',
      })
    ).rejects.toThrow(/holds text, not a number/);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('groups by currency even when the caller forgets to', async () => {
    // Summing GBP into USD is wrong in a way no reader of the answer can see.
    const result = await queryReportAggregate({
      sellerId: 'A1SELLER',
      kind: 'storage-fee',
      measure: 'amountTotal',
    });
    expect(result.groupBy).toContain('currency');
  });

  it('counts rows it could not read a number from instead of calling them zero', async () => {
    executeQuery.mockResolvedValue({
      rows: [{ currency: 'USD', total: 12, rows: 10, unparsed: 3, absent: 0 }],
    });
    const result = await queryReportAggregate({
      sellerId: 'A1SELLER',
      kind: 'storage-fee',
      measure: 'amountTotal',
    });
    expect(result.unparsed).toBe(3);
    expect(result.rowsMatched).toBe(10);
  });

  it('separates a column nothing carries from a total of zero', async () => {
    // Asking for a field no stored row has is not a $0 answer — it is a
    // question the imported data cannot answer, and reporting it as zero would
    // tell a seller they were not charged.
    executeQuery.mockResolvedValue({
      rows: [
        { currency: 'USD', total: null, rows: 61, unparsed: 0, absent: 61 },
      ],
    });
    const result = await queryReportAggregate({
      sellerId: 'A1SELLER',
      kind: 'storage-fee',
      measure: 'storageFeeSurcharge',
    });
    expect(result.absent).toBe(61);
    expect(result.unparsed).toBe(0);
    expect(result.groups[0].total).toBe(0);

    const statement = executeQuery.mock.calls[0][1] as string;
    expect(statement).toContain(
      'SUM(CASE WHEN d.fields.`storageFeeSurcharge` IS MISSING THEN 1 ELSE 0 END) AS absent'
    );
  });

  it('reads a total of nothing as 0 rather than NULL', async () => {
    // SUM over rows that are all unreadable is NULL in N1QL, and NULL would
    // reach the model as a total it might render as "null".
    executeQuery.mockResolvedValue({
      rows: [{ currency: 'USD', total: null, rows: 4, unparsed: 4 }],
    });
    const result = await queryReportAggregate({
      sellerId: 'A1SELLER',
      kind: 'storage-fee',
      measure: 'amountTotal',
    });
    expect(result.groups[0].total).toBe(0);
  });

  it('refuses a field the report does not have, and says which it does', async () => {
    // The agent guesses field names; an error that names the alternatives is
    // the difference between a retry and a dead end.
    await expect(
      queryReportAggregate({
        sellerId: 'A1SELLER',
        kind: 'storage-fee',
        measure: 'reimbursementId',
      })
    ).rejects.toBeInstanceOf(ReportQueryError);

    await expect(
      queryReportAggregate({
        sellerId: 'A1SELLER',
        kind: 'storage-fee',
        measure: 'amountTotal',
        groupBy: ['nonsense'],
      })
    ).rejects.toThrow(/Available: /);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('only ever interpolates identifiers it found in the registry', async () => {
    // Field names reach the statement as text. They are whitelisted against the
    // report definition first, which is what stops a tool argument becoming SQL.
    await expect(
      queryReportAggregate({
        sellerId: 'A1SELLER',
        kind: 'storage-fee',
        measure: 'amountTotal',
        filters: { 'asin` OR 1=1 --': ['x'] },
      })
    ).rejects.toBeInstanceOf(ReportQueryError);
  });
});
