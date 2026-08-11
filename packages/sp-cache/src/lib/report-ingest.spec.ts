/**
 * Regression tests for report parsing.
 *
 * Every case here failed against real Amazon exports at some point. Fixtures
 * are trimmed and scrubbed copies of those exports — enough rows to exercise
 * the property, with addresses and names removed.
 */

import { describe, expect, it } from 'vitest';
import { detectReportKind, parseReport, toIsoDate } from './report-ingest.js';

/** Inventory Ledger, DETAIL view. One row per event. */
const DETAIL_HEADER =
  '"Date","FNSKU","ASIN","MSKU","Title","Event Type","Reference ID","Quantity",' +
  '"Fulfillment Center","Disposition","Reason","Country","Reconciled Quantity",' +
  '"Unreconciled Quantity","Date and Time","Store"';

function detailRow(
  overrides: Partial<{
    date: string;
    title: string;
    eventType: string;
    referenceId: string;
    quantity: string;
    fc: string;
    reason: string;
    reconciled: string;
    timestamp: string;
  }> = {}
): string {
  const o = {
    date: '07/06/2026',
    title: 'Example Coffee 250g',
    eventType: 'Shipments',
    referenceId: '',
    quantity: '-1',
    fc: 'ACY1',
    reason: '',
    reconciled: '',
    timestamp: '2026-07-06T00:00:00-0700',
    ...overrides,
  };
  return [
    o.date,
    'X004XONY53',
    'B0G51NDRX4',
    'FB-COF-HGE-250',
    o.title,
    o.eventType,
    o.referenceId,
    o.quantity,
    o.fc,
    'SELLABLE',
    o.reason,
    'US',
    o.reconciled,
    '',
    o.timestamp,
    '',
  ]
    .map((cell) => `"${cell}"`)
    .join(',');
}

const detailFile = (rows: string[]) => [DETAIL_HEADER, ...rows].join('\n');

const parse = (text: string, kind = 'ledger-detail' as const) =>
  parseReport({ kind, sellerId: 'SELLER1', text, snapshotDate: '2026-07-27' });

describe('toIsoDate', () => {
  it('normalises the MM/DD/YYYY that Amazon writes', () => {
    expect(toIsoDate('07/16/2026')).toBe('2026-07-16');
    expect(toIsoDate('1/5/2026')).toBe('2026-01-05');
  });

  it('leaves ISO values and unrecognised values alone', () => {
    expect(toIsoDate('2026-07-16')).toBe('2026-07-16');
    expect(toIsoDate('2026-07-16T00:00:00-0700')).toBe('2026-07-16');
    expect(toIsoDate('not a date')).toBe('not a date');
  });

  it('orders correctly across a year boundary', () => {
    // The bug: lexically '12/15/2025' sorts AFTER '01/05/2026', so any coverage
    // window spanning New Year came back inverted. Works by accident within one
    // calendar year, which is why real 2026-only data never showed it.
    const raw = ['12/15/2025', '01/05/2026'];
    expect([...raw].sort()).toEqual(['01/05/2026', '12/15/2025']);
    expect(raw.map(toIsoDate).sort()).toEqual(['2025-12-15', '2026-01-05']);
  });
});

describe('row identity', () => {
  it('survives a listing rename', () => {
    // Two exports of the same events either side of a rename shared ZERO row
    // ids, so every stored figure doubled. Title describes a row; it does not
    // identify one.
    const events = [
      detailRow({ date: '07/01/2026', quantity: '-1' }),
      detailRow({ date: '07/02/2026', quantity: '-3' }),
    ];
    const before = parse(detailFile(events));
    const after = parse(
      detailFile(
        events.map((row) =>
          row.replace('Example Coffee 250g', 'Example Coffee, Light Roast')
        )
      )
    );

    expect(after.rows.map((r) => r.rowId)).toEqual(
      before.rows.map((r) => r.rowId)
    );
  });

  it('keeps genuinely repeated identical events distinct', () => {
    // Amazon's ledger repeats a line legitimately: three separate customer
    // shipments of one unit from the same FC on the same day are three events,
    // and Amazon issues no event id. Collapsing them lost 65 of 361 rows.
    const identical = [detailRow(), detailRow(), detailRow()];
    const parsed = parse(detailFile(identical));

    expect(parsed.rows).toHaveLength(3);
    expect(new Set(parsed.rows.map((r) => r.rowId)).size).toBe(3);
  });

  it('still dedupes the same event across overlapping exports', () => {
    // The other half: an occurrence index must not make re-imports look new.
    const shared = [detailRow({ date: '07/01/2026' }), detailRow()];
    const wider = [detailRow({ date: '06/30/2026' }), ...shared];

    const narrowIds = parse(detailFile(shared)).rows.map((r) => r.rowId);
    const widerIds = parse(detailFile(wider)).rows.map((r) => r.rowId);

    for (const id of narrowIds) expect(widerIds).toContain(id);
  });

  it('is independent of row order in the file', () => {
    const rows = [detailRow({ date: '07/01/2026' }), detailRow()];
    const forward = parse(detailFile(rows))
      .rows.map((r) => r.rowId)
      .sort();
    const reversed = parse(detailFile([...rows].reverse()))
      .rows.map((r) => r.rowId)
      .sort();
    expect(reversed).toEqual(forward);
  });
});

describe('ledger detail field mapping', () => {
  it('maps every column of a real export', () => {
    const parsed = parse(
      detailFile([detailRow({ eventType: 'Adjustments', reconciled: '1' })])
    );
    expect(parsed.unmappedHeaders).toEqual([]);
    expect(parsed.missingFields).toEqual([]);
  });

  it('does not read a reconciled quantity as a reason', () => {
    // reconciledquantity was aliased as a fallback for `reason`. On a file with
    // no Reason column a quantity would land in a reason field.
    const parsed = parse(
      detailFile([
        detailRow({ eventType: 'Adjustments', reason: 'M', reconciled: '2' }),
      ])
    );
    expect(parsed.rows[0].fields.reason).toBe('M');
    expect(parsed.rows[0].fields.reconciledQuantity).toBe('2');
  });

  it('normalises the date field but keeps the raw timestamp', () => {
    const parsed = parse(detailFile([detailRow({ date: '07/06/2026' })]));
    expect(parsed.rows[0].fields.date).toBe('2026-07-06');
    expect(parsed.rows[0].fields.eventTimestamp).toContain('2026-07-06T');
  });
});

describe('ledger summary is a WIDE report', () => {
  // One row per SKU/date/location with a COLUMN PER EVENT TYPE. Modelled like
  // the detail view at first, which left lost/damaged/found — the entire point
  // of reconciliation — unmapped and unqueryable.
  const SUMMARY = [
    '"Date","FNSKU","ASIN","MSKU","Title","Disposition","Starting Warehouse Balance",' +
      '"In Transit Between Warehouses","Receipts","Customer Shipments","Customer Returns",' +
      '"Vendor Returns","Warehouse Transfer In/Out","Found","Lost","Damaged","Disposed",' +
      '"Other Events","Ending Warehouse Balance","Unknown Events","Location","Store"',
    '"07/16/2026","X004DB7FZ1","B0DCQHBQNM","FB-COF-GEI-250","Example Coffee",' +
      '"SELLABLE","5","0","2","1","0","0","0","0","1","0","1","0","4","0","SAN3",""',
  ].join('\n');

  it('maps all 22 columns, including the movement columns', () => {
    const parsed = parseReport({
      kind: 'ledger-summary',
      sellerId: 'SELLER1',
      text: SUMMARY,
      snapshotDate: '2026-07-16',
    });
    expect(parsed.unmappedHeaders).toEqual([]);

    const fields = parsed.rows[0].fields;
    expect(fields.lost).toBe('1');
    expect(fields.disposed).toBe('1');
    expect(fields.receipts).toBe('2');
    expect(fields.startingBalance).toBe('5');
    expect(fields.endingBalance).toBe('4');
    // "Location" is the FC on this view.
    expect(fields.fulfillmentCenter).toBe('SAN3');
  });
});

describe('detectReportKind', () => {
  it('tells the detail and summary ledger views apart', () => {
    expect(detectReportKind(detailFile([detailRow()])).kind).toBe(
      'ledger-detail'
    );
  });

  it('refuses to guess when nothing matches', () => {
    expect(detectReportKind('"Foo","Bar"\n"1","2"').kind).toBeFalsy();
  });
});

/**
 * The settlement report's two date columns.
 *
 * Header and rows below are verbatim from a real V2 flat file (settlement
 * 25889786381). It carries BOTH `posted-date` and `posted-date-time`, and the
 * registry has `date` and `postedDate` each listing `posteddate` first — so
 * before the fix the second field overwrote the first's column, `date` was
 * stored nowhere, and `posted-date-time` was reported unrecognised.
 *
 * Nothing threw. The report simply had no date: unorderable, unjoinable, and
 * an empty coverage window on every import. For the money report, that is the
 * column that matters most.
 */
describe('settlement date columns', () => {
  const HEADER = [
    'settlement-id',
    'settlement-start-date',
    'settlement-end-date',
    'deposit-date',
    'total-amount',
    'currency',
    'transaction-type',
    'order-id',
    'merchant-order-id',
    'adjustment-id',
    'shipment-id',
    'marketplace-name',
    'amount-type',
    'amount-description',
    'amount',
    'fulfillment-id',
    'posted-date',
    'posted-date-time',
    'order-item-code',
    'merchant-order-item-id',
    'merchant-adjustment-item-id',
    'sku',
    'quantity-purchased',
    'promotion-id',
  ].join('\t');

  // The header row (settlement totals, no transaction) then one order line.
  const ROWS = [
    '25889786381\t2026-03-13 20:21:38 UTC\t2026-03-27 20:21:38 UTC\t2026-03-29 20:21:38 UTC\t3711.36\tUSD\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t',
    '25889786381\t\t\t\t\t\tOrder\t111-5784799-3571457\t111-5784799-3571457\t\tPxRHfj7GG\tAmazon.com\tItemPrice\tPrincipal\t19.50\tAFN\t2026-03-14\t2026-03-14 08:49:04 UTC\t155037952465161\t\t\tFB-COF-GEI-75\t1\t',
  ].join('\n');

  const parsed = parseReport({
    kind: 'settlement',
    sellerId: 'SELLER1',
    text: `${HEADER}\n${ROWS}\n`,
  });

  it('stores a date, which is what the coverage window is built from', () => {
    const order = parsed.rows.find((r) => r.fields['amount'] !== undefined);
    expect(order?.fields['date']).toBe('2026-03-14');
  });

  it('gives postedDate the timestamp column rather than stealing date it', () => {
    // The two fields share `posteddate` as their first alias. `postedDate`
    // must fall through to `posteddatetime` instead of taking the column
    // `date` already claimed.
    const order = parsed.rows.find((r) => r.fields['amount'] !== undefined);
    expect(order?.fields['postedDate']).toContain('2026-03-14');
    expect(order?.fields['postedDate']).not.toBe(order?.fields['date']);
  });

  it('no longer reports posted-date-time as unrecognised', () => {
    expect(parsed.unmappedHeaders).not.toContain('posted-date-time');
    expect(parsed.unmappedHeaders).not.toContain('posted-date');
  });

  it('says nothing about columns we have decided not to index', () => {
    // These four are real columns we choose not to map. Reporting them on every
    // import made the warning permanently non-empty, which is how the genuine
    // `posted-date-time` problem stayed invisible inside it.
    expect(parsed.unmappedHeaders).toEqual([]);
  });

  it('stops keeping a verbatim copy of every row', () => {
    // One unrecognised column makes the parser store `raw` — all 24 columns
    // again — on EVERY row. Four permanently-ignored columns therefore doubled
    // the stored size of the settlement report to buy optionality on
    // identifiers nobody queries.
    expect(parsed.rows.every((row) => row.raw === undefined)).toBe(true);
  });

  it('STILL reports a column nobody has classified', () => {
    // The point is to quieten decisions, not to disable the warning. A column
    // that is neither mapped nor deliberately ignored is exactly the drift this
    // exists to catch, and it must still force `raw` so the values survive
    // until someone maps them.
    const withNewColumn = parseReport({
      kind: 'settlement',
      sellerId: 'SELLER1',
      text: `${HEADER}\tsome-new-amazon-column\n${ROWS}\tvalue\n`,
    });

    expect(withNewColumn.unmappedHeaders).toEqual(['some-new-amazon-column']);
    expect(withNewColumn.rows.some((row) => row.raw !== undefined)).toBe(true);
  });
});
