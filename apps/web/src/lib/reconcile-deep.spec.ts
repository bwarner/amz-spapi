import { describe, expect, it } from 'vitest';
import { buildDeepView } from './reconcile-deep';
import type { PacketInput } from './evidence-packet';
import type {
  ReceiptAggregate,
  ShipmentReconciliation,
  StoredBoxLabel,
  StoredDocument,
  StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';

/**
 * The deep view's job is attribution: which of the four relationships broke,
 * and whose problem it is. Every failure here misdirects a dispute — a
 * supplier under-shipment blamed on Amazon, five discrepancies manufactured
 * from one missing invoice, an exposure figure that disagrees with the packet.
 */

const USER = 'auth0|seller';
const SHIPMENT = 'FBA17K9QZ2X';

function document(
  overrides: Partial<StoredDocument> & { assetId: string }
): StoredDocument {
  return {
    documentId: `${USER}::${overrides.assetId}`,
    userId: USER,
    role: 'commercial-invoice',
    roleSource: 'recognised',
    recognition: {
      kind: 'commercial-invoice',
      confidence: 0.9,
      needsUserChoice: false,
      alternatives: [],
      signals: [],
    },
    extracted: {
      vendorName: 'Yiwu Textile Co',
      currency: 'USD',
      total: 9880,
      lines: [],
    } as StoredDocument['extracted'],
    issues: [],
    needsReview: false,
    shipmentIds: [SHIPMENT],
    storedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function po(
  lines: StoredPurchaseOrder['order']['lines'],
  extra: Partial<StoredPurchaseOrder> = {}
): StoredPurchaseOrder {
  return {
    key: `${USER}::PO-1043`,
    userId: USER,
    order: {
      poNumber: 'PO-1043',
      issueDate: '2026-05-12',
      revision: 1,
      status: 'open',
      vendorId: 'yiwu-textile-co',
      currency: 'USD',
      lines,
    } as StoredPurchaseOrder['order'],
    renders: [{ format: 'pdf', assetId: 'render-1', renderedAt: 1 }],
    shipmentIds: [SHIPMENT],
    storedAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function orderLine(
  sku: string,
  quantity: number,
  unitPrice = 4.77
): StoredPurchaseOrder['order']['lines'][number] {
  return { sku, description: `${sku} description`, quantity, unitPrice };
}

function label(sku: string, quantity: number, box: number): StoredBoxLabel {
  return {
    labelId: `A1::${SHIPMENT}::box-${box}`,
    sellerId: 'A1',
    shipmentId: SHIPMENT,
    boxNumber: box,
    sku,
    quantity,
    singleSku: true,
    identityIsContentHash: false,
    assetId: 'labels-1',
    warnings: [],
    storedAt: 1,
  };
}

function receipt(sku: string, receivedGross: number): ReceiptAggregate {
  return {
    shipmentId: SHIPMENT,
    sku,
    receivedGross,
    reversed: 0,
    firstReceipt: '2026-06-19',
    lastReceipt: '2026-06-24',
    reversalEvents: 0,
    fulfillmentCenters: ['GDL2'],
  };
}

function reconLine(
  sku: string,
  shipped: number | undefined,
  receivedNet: number,
  status: ShipmentReconciliation['lines'][number]['status'],
  extra: Partial<ShipmentReconciliation['lines'][number]> = {}
): ShipmentReconciliation['lines'][number] {
  return {
    sku,
    shipped,
    shippedIsFloor: false,
    receivedGross: receivedNet,
    reversed: 0,
    receivedNet,
    discrepancy:
      shipped !== undefined && shipped !== receivedNet
        ? shipped - receivedNet
        : undefined,
    status,
    fulfillmentCenters: ['GDL2'],
    reversalEvents: 0,
    ...extra,
  };
}

function recon(lines: ShipmentReconciliation['lines']): ShipmentReconciliation {
  return {
    shipmentId: SHIPMENT,
    firstReceiptDate: '2026-06-19',
    lastReceiptDate: '2026-06-24',
    lines,
    warnings: [],
  };
}

function input(overrides: Partial<PacketInput> = {}): PacketInput {
  return {
    shipmentId: SHIPMENT,
    documents: [],
    orders: [],
    boxLabels: [],
    receipts: [],
    ...overrides,
  };
}

describe('buildDeepView', () => {
  it('joins all four sides by SKU and attributes each break to its relationship', () => {
    // The design's own worked example: one short (Amazon), one over-invoiced
    // (supplier), one SKU the invoice never mentions, two balanced.
    const invoice = document({
      assetId: 'inv-1',
      extracted: {
        vendorName: 'Yiwu Textile Co',
        currency: 'USD',
        total: 9880,
        invoiceNumber: 'INV-8802',
        documentDate: '2026-06-02',
        lines: [
          {
            description: 'Towel grey TX-TOWEL-GY-4',
            quantity: 600,
            amount: 2860,
          },
          {
            description: 'Towel navy TX-TOWEL-NV-4',
            quantity: 600,
            amount: 2860,
          },
          { description: 'Robe medium TX-ROBE-M', quantity: 420, amount: 2100 },
          { description: 'Robe large TX-ROBE-L', quantity: 400, amount: 2060 },
        ],
      } as StoredDocument['extracted'],
    });
    const view = buildDeepView(
      input({
        documents: [invoice],
        orders: [
          po([
            orderLine('TX-TOWEL-GY-4', 600),
            orderLine('TX-TOWEL-NV-4', 600),
            orderLine('TX-ROBE-M', 400, 5.0),
            orderLine('TX-ROBE-L', 400, 5.15),
            orderLine('TX-MAT-BATH', 400, 3.2),
          ]),
        ],
        boxLabels: [
          label('TX-TOWEL-GY-4', 600, 1),
          label('TX-TOWEL-NV-4', 600, 2),
          label('TX-ROBE-M', 420, 3),
          label('TX-ROBE-L', 400, 4),
          label('TX-MAT-BATH', 400, 5),
        ],
        receipts: [
          receipt('TX-TOWEL-GY-4', 600),
          receipt('TX-TOWEL-NV-4', 555),
          receipt('TX-ROBE-M', 420),
          receipt('TX-ROBE-L', 400),
          receipt('TX-MAT-BATH', 400),
        ],
        reconciliation: recon([
          reconLine('TX-TOWEL-GY-4', 600, 600, 'balanced'),
          reconLine('TX-TOWEL-NV-4', 600, 555, 'short'),
          reconLine('TX-ROBE-M', 420, 420, 'balanced'),
          reconLine('TX-ROBE-L', 400, 400, 'balanced'),
          reconLine('TX-MAT-BATH', 400, 400, 'balanced'),
        ]),
      })
    );

    const bySku = new Map(view.lines.map((line) => [line.sku, line]));

    const short = bySku.get('TX-TOWEL-NV-4');
    expect(short?.findings).toEqual([
      // Priced from the PO line: 45 × 4.77 — the same figure the packet signs.
      { kind: 'short', text: 'Short 45 — claimable', amount: 214.65 },
    ]);

    const overInvoiced = bySku.get('TX-ROBE-M');
    expect(overInvoiced?.ordered).toBe(400);
    expect(overInvoiced?.invoiced).toBe(420);
    expect(overInvoiced?.findings).toEqual([
      { kind: 'shipped-vs-order', text: 'Shipped 20 over the order' },
      { kind: 'invoice-vs-order', text: 'Invoiced 20 over the PO' },
    ]);

    const noInvoiceLine = bySku.get('TX-MAT-BATH');
    expect(noInvoiceLine?.invoiced).toBeUndefined();
    expect(noInvoiceLine?.findings).toEqual([
      { kind: 'no-invoice-line', text: 'No invoice line matched this SKU' },
    ]);

    expect(bySku.get('TX-TOWEL-GY-4')?.findings).toEqual([]);
    expect(view.discrepancies).toBe(3);
    expect(view.exposure).toBe(214.65);
    expect(view.canBuildPacket).toBe(true);
    // The unmatched-invoice-lines note must NOT fire — every line tied.
    expect(view.notes).toEqual([]);
  });

  it('declares a missing side once in notes instead of once per row', () => {
    // No invoice at all: rows must not each claim "no invoice line matched".
    const view = buildDeepView(
      input({
        orders: [po([orderLine('TX-TOWEL-NV-4', 600)])],
        boxLabels: [label('TX-TOWEL-NV-4', 600, 1)],
        receipts: [receipt('TX-TOWEL-NV-4', 600)],
        reconciliation: recon([
          reconLine('TX-TOWEL-NV-4', 600, 600, 'balanced'),
        ]),
      })
    );

    expect(view.lines[0].findings).toEqual([]);
    expect(view.discrepancies).toBe(0);
    expect(
      view.notes.some((note) => note.includes('No invoice is attached'))
    ).toBe(true);
  });

  it('does not call a row balanced when only one side of shipped/received exists', () => {
    const view = buildDeepView(
      input({
        receipts: [receipt('TX-TOWEL-NV-4', 555)],
        reconciliation: recon([
          reconLine('TX-TOWEL-NV-4', undefined, 555, 'shipped-unknown'),
        ]),
      })
    );

    const [line] = view.lines;
    expect(line.compared).toBe(false);
    expect(line.findings).toEqual([]);
    expect(view.notes.some((note) => note.includes('No box labels'))).toBe(
      true
    );
  });

  it('separates a supplier under-shipment from an Amazon short receipt', () => {
    // Supplier sent 550 of 600 ordered; Amazon received all 550. Nothing is
    // claimable from Amazon — the finding must point at the order, not the FC.
    const view = buildDeepView(
      input({
        orders: [po([orderLine('TX-TOWEL-NV-4', 600)])],
        boxLabels: [label('TX-TOWEL-NV-4', 550, 1)],
        receipts: [receipt('TX-TOWEL-NV-4', 550)],
        reconciliation: recon([
          reconLine('TX-TOWEL-NV-4', 550, 550, 'balanced'),
        ]),
      })
    );

    expect(view.lines[0].findings).toEqual([
      { kind: 'shipped-vs-order', text: 'Shipped 50 under the order' },
    ]);
    expect(view.exposure).toBeUndefined();
  });

  it('stays silent on shipped-vs-order when shipped is only a floor', () => {
    // 550 counted from an incomplete label set is not evidence that 600 were
    // not sent — a floor below the order proves nothing about the supplier.
    const view = buildDeepView(
      input({
        orders: [po([orderLine('TX-TOWEL-NV-4', 600)])],
        boxLabels: [label('TX-TOWEL-NV-4', 550, 1)],
        receipts: [receipt('TX-TOWEL-NV-4', 550)],
        reconciliation: recon([
          reconLine('TX-TOWEL-NV-4', 550, 550, 'balanced', {
            shippedIsFloor: true,
          }),
        ]),
      })
    );

    expect(view.lines[0].findings).toEqual([]);
    expect(view.lines[0].shippedIsFloor).toBe(true);
  });

  it('names invoice lines that tie to no SKU, excluding freight', () => {
    const invoice = document({
      assetId: 'inv-1',
      extracted: {
        vendorName: 'Yiwu Textile Co',
        currency: 'USD',
        total: 3000,
        lines: [
          {
            description: 'Towel navy TX-TOWEL-NV-4',
            quantity: 600,
            amount: 2400,
          },
          { description: 'Mystery surcharge', amount: 300 },
          { description: 'Sea freight', amount: 300, kind: 'freight' },
        ],
      } as StoredDocument['extracted'],
    });
    const view = buildDeepView(
      input({
        documents: [invoice],
        boxLabels: [label('TX-TOWEL-NV-4', 600, 1)],
        receipts: [receipt('TX-TOWEL-NV-4', 600)],
        reconciliation: recon([
          reconLine('TX-TOWEL-NV-4', 600, 600, 'balanced'),
        ]),
      })
    );

    const note = view.notes.find((entry) =>
      entry.includes('could not be tied')
    );
    expect(note).toContain('"Mystery surcharge"');
    expect(note).not.toContain('Sea freight');
  });

  it('describes the three sources with the issued order preferred', () => {
    const view = buildDeepView(
      input({
        orders: [
          po([orderLine('TX-TOWEL-NV-4', 600), orderLine('TX-ROBE-M', 400)]),
        ],
        documents: [
          document({
            assetId: 'inv-1',
            extracted: {
              vendorName: 'Yiwu Textile Co',
              currency: 'USD',
              total: 9880,
              invoiceNumber: 'INV-8802',
              documentDate: '2026-06-02',
              lines: [],
            } as StoredDocument['extracted'],
          }),
        ],
        boxLabels: [label('TX-TOWEL-NV-4', 600, 1)],
        receipts: [receipt('TX-TOWEL-NV-4', 600)],
        reconciliation: recon([
          reconLine('TX-TOWEL-NV-4', 600, 600, 'balanced'),
        ]),
      })
    );

    expect(view.sources.map((source) => source.key)).toEqual([
      'po',
      'invoice',
      'ledger',
    ]);
    expect(view.sources[0].title).toBe('PO-1043');
    expect(view.sources[0].detail).toBe('issued 2026-05-12 · 1000 units');
    // The uploaded invoice is openable; the native order has no page yet.
    expect(view.sources[0].href).toBeUndefined();
    expect(view.sources[1].href).toBe('/documents/inv-1');
    expect(view.orderedDate).toBe('2026-05-12');
  });
});
