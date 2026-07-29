/**
 * Reconciliation regression tests.
 *
 * The numbers below are the real FBA19CBC1Q88 case, trimmed: two SKUs on one
 * shipment, 80 declared each, where one was over-received and the other short
 * because units were received under the wrong FNSKU.
 */

import { describe, expect, it } from 'vitest';
import type { ReceiptAggregate } from './report-store.js';
import {
  aggregateReceipts,
  reconcileShipments,
} from './reconcile-shipments.js';
import type { ReportRow } from './report-ingest.js';

function receiptRow(
  shipmentId: string,
  sku: string,
  quantity: number,
  day: string,
  fc = 'HIA1'
): ReportRow {
  return {
    rowId: `${shipmentId}-${sku}-${day}-${quantity}-${fc}`,
    sellerId: 'SELLER1',
    reportKind: 'ledger-detail',
    reportType: 'GET_LEDGER_DETAIL_VIEW_DATA',
    fields: {
      date: day,
      eventType: 'Receipts',
      referenceId: shipmentId,
      quantity: String(quantity),
      msku: sku,
      fnsku: 'X004XONY53',
      fulfillmentCenter: fc,
      eventTimestamp: `${day}T00:00:00-0700`,
    },
    ingestedAt: 0,
  };
}

const HONEY = 'FB-COF-HGE-250';
const WASHED = 'FB-COF-GEI-250';
const SHIPMENT = 'FBA19CBC1Q88';

const rows: ReportRow[] = [
  receiptRow(SHIPMENT, HONEY, 80, '2026-05-04', 'HIA1'),
  receiptRow(SHIPMENT, HONEY, 40, '2026-05-05', 'MQJ1'),
  receiptRow(SHIPMENT, HONEY, -24, '2026-07-11', 'SMF1'),
  receiptRow(SHIPMENT, WASHED, 80, '2026-05-04', 'HIA1'),
  receiptRow(SHIPMENT, WASHED, -38, '2026-05-08', 'MQJ1'),
  // Not a receipt: must be ignored, since only receipts carry a shipment ref.
  {
    ...receiptRow(SHIPMENT, HONEY, -1, '2026-06-01'),
    rowId: 'a-sale',
    fields: {
      date: '2026-06-01',
      eventType: 'Shipments',
      quantity: '-1',
      msku: HONEY,
    },
  },
];

const shipped = [
  { shipmentId: SHIPMENT, sku: HONEY, quantity: 80, complete: true },
  { shipmentId: SHIPMENT, sku: WASHED, quantity: 80, complete: true },
];

describe('aggregateReceipts', () => {
  it('groups by shipment and SKU, splitting receipts from reversals', () => {
    const aggregates = aggregateReceipts(rows);
    expect(aggregates).toHaveLength(2);

    const honey = aggregates.find((a) => a.sku === HONEY) as ReceiptAggregate;
    expect(honey.receivedGross).toBe(120);
    expect(honey.reversed).toBe(24);
    expect(honey.reversalEvents).toBe(1);
    expect(honey.fulfillmentCenters).toEqual(['HIA1', 'MQJ1', 'SMF1']);
  });

  it('ignores events that are not receipts', () => {
    // Of 141 Shipments rows in a real export, zero carried a reference id — a
    // sale cannot be attributed to the shipment that supplied it.
    const total = aggregateReceipts(rows).reduce(
      (sum, a) => sum + a.receivedGross + a.reversed,
      0
    );
    expect(total).toBe(120 + 24 + 80 + 38);
  });
});

describe('reconcileShipments', () => {
  const [result] = reconcileShipments({
    receipts: aggregateReceipts(rows),
    shipped,
  });

  it('reports net received against what was shipped', () => {
    const honey = result.lines.find((l) => l.sku === HONEY);
    const washed = result.lines.find((l) => l.sku === WASHED);

    expect(honey?.receivedNet).toBe(96);
    expect(honey?.status).toBe('over-received');
    expect(washed?.receivedNet).toBe(42);
    expect(washed?.status).toBe('short');
  });

  it('raises the wrong-SKU signature when one SKU is over and another short', () => {
    // The finding a human scanning a ledger will not make. It took eight weeks
    // and a 16-page document to establish by hand.
    const warning = result.warnings.find((w) => w.includes('wrong SKU'));
    expect(warning).toBeDefined();
    expect(warning).toContain(HONEY);
    expect(warning).toContain(WASHED);
  });

  it('flags reversals long after receipt', () => {
    const warning = result.warnings.find((w) => w.includes('at pick'));
    expect(warning).toContain(HONEY);
  });

  it('marks an incomplete set of box labels as a floor, not a total', () => {
    const [partial] = reconcileShipments({
      receipts: aggregateReceipts(rows),
      shipped: [
        { shipmentId: SHIPMENT, sku: HONEY, quantity: 40, complete: false },
      ],
    });
    const honey = partial.lines.find((l) => l.sku === HONEY);
    expect(honey?.shippedIsFloor).toBe(true);
    expect(partial.warnings.some((w) => w.includes('floor'))).toBe(true);
  });

  it('says so when no box label is held rather than implying a match', () => {
    const [unchecked] = reconcileShipments({
      receipts: aggregateReceipts(rows),
    });
    expect(unchecked.lines.every((l) => l.status === 'shipped-unknown')).toBe(
      true
    );
    expect(unchecked.warnings.some((w) => w.includes('no box label'))).toBe(
      true
    );
  });

  it('lists a shipment that has box labels but no receipts at all', () => {
    // "You shipped this and Amazon has recorded nothing" is the most urgent
    // state, so it must not be omitted for having no rows to group.
    const [ghost] = reconcileShipments({
      receipts: [],
      shipped: [
        {
          shipmentId: 'FBA19NEW00001',
          sku: HONEY,
          quantity: 60,
          complete: true,
        },
      ],
    });
    expect(ghost.shipmentId).toBe('FBA19NEW00001');
    expect(ghost.lines[0].receivedNet).toBe(0);
    expect(ghost.lines[0].status).toBe('short');
  });
});
