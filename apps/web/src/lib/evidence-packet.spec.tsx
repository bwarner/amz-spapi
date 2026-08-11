import { describe, expect, it } from 'vitest';
import { planPacket, type PacketInput } from './evidence-packet';
import type {
  ReceiptAggregate,
  ShipmentReconciliation,
  StoredBoxLabel,
  StoredDocument,
  StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';

/**
 * The packet plan. What goes in, what is named as missing, and what is
 * claimed — every failure here signs the seller's name to a wrong or weaker
 * claim: a silent gap, an invented unit cost, an over-receipt claimed as if
 * Amazon owed for it.
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
  overrides: Partial<StoredPurchaseOrder['order']> = {},
  extra: Partial<StoredPurchaseOrder> = {}
): StoredPurchaseOrder {
  return {
    key: `${USER}::PO-1`,
    userId: USER,
    order: {
      poNumber: 'PO-1',
      issueDate: '2026-05-12',
      revision: 1,
      status: 'open',
      vendorId: 'yiwu-textile-co',
      currency: 'USD',
      lines: [
        {
          sku: 'TX-TOWEL-NV-4',
          description: 'towels',
          quantity: 600,
          unitPrice: 4.77,
        },
      ],
      ...overrides,
    } as StoredPurchaseOrder['order'],
    renders: [{ format: 'pdf', assetId: 'render-1', renderedAt: 1 }],
    shipmentIds: [SHIPMENT],
    storedAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function label(box: number): StoredBoxLabel {
  return {
    labelId: `A1::${SHIPMENT}::box-${box}`,
    sellerId: 'A1',
    shipmentId: SHIPMENT,
    boxNumber: box,
    sku: 'TX-TOWEL-NV-4',
    quantity: 25,
    singleSku: true,
    identityIsContentHash: false,
    assetId: 'labels-1',
    warnings: [],
    storedAt: 1,
  };
}

function receipt(overrides: Partial<ReceiptAggregate> = {}): ReceiptAggregate {
  return {
    shipmentId: SHIPMENT,
    sku: 'TX-TOWEL-NV-4',
    receivedGross: 555,
    reversed: 0,
    firstReceipt: '2026-06-19',
    lastReceipt: '2026-06-24',
    reversalEvents: 0,
    fulfillmentCenters: ['GDL2'],
    ...overrides,
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

const SHORT_LINE = {
  sku: 'TX-TOWEL-NV-4',
  shipped: 600,
  shippedIsFloor: false,
  receivedGross: 555,
  reversed: 0,
  receivedNet: 555,
  discrepancy: 45,
  status: 'short' as const,
  fulfillmentCenters: ['GDL2'],
  reversalEvents: 0,
};

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

describe('planPacket', () => {
  it('assembles the full packet in reading order', () => {
    const plan = planPacket(
      input({
        documents: [document({ assetId: 'inv-1' })],
        orders: [po()],
        boxLabels: [label(1), label(2)],
        receipts: [receipt()],
        reconciliation: recon([SHORT_LINE]),
      })
    );

    expect(plan.items.map((item) => item.key)).toEqual([
      'po',
      'commercial-invoice',
      'box-labels',
      'ledger',
    ]);
    // The issued order's RENDER is what goes in — the printed record.
    expect(plan.items[0].assetIds).toEqual(['render-1']);
    // POD is a claim-bearing document, so its absence is a named gap.
    expect(plan.gaps.map((gap) => gap.name)).toContain('Proof of delivery');
  });

  it('prices the claim from the issued order and says so', () => {
    const plan = planPacket(
      input({
        orders: [po()],
        boxLabels: [label(1)],
        receipts: [receipt()],
        reconciliation: recon([SHORT_LINE]),
      })
    );

    expect(plan.claim.lines).toEqual([
      expect.objectContaining({
        sku: 'TX-TOWEL-NV-4',
        units: 45,
        unitCost: 4.77,
        unitCostSource: 'purchase order',
        amount: 214.65,
      }),
    ]);
    expect(plan.claim.total).toBe(214.65);
  });

  it('falls back to the invoice line only when it ties to the SKU', () => {
    const invoice = document({
      assetId: 'inv-1',
      extracted: {
        vendorName: 'Yiwu Textile Co',
        currency: 'USD',
        total: 2860,
        lines: [
          {
            description: 'Waffle towel set navy',
            supplierRef: 'TX-TOWEL-NV-4',
            quantity: 600,
            amount: 2860,
          },
        ],
      } as StoredDocument['extracted'],
    });

    const plan = planPacket(
      input({
        documents: [invoice],
        reconciliation: recon([SHORT_LINE]),
      })
    );

    const [line] = plan.claim.lines;
    expect(line.unitCostSource).toBe('invoice');
    // 2860 / 600 = 4.766… → rounded once to cents, THEN multiplied — the
    // same figure a reviewer recomputes from the invoice.
    expect(line.unitCost).toBe(4.77);
    expect(line.amount).toBe(214.65);
  });

  it('claims units only when no price ties to the SKU, and says why', () => {
    const plan = planPacket(
      input({
        // Invoice with no line that mentions the SKU anywhere.
        documents: [document({ assetId: 'inv-1' })],
        reconciliation: recon([SHORT_LINE]),
      })
    );

    const [line] = plan.claim.lines;
    expect(line.units).toBe(45);
    expect(line.amount).toBeUndefined();
    expect(plan.claim.total).toBeUndefined();
    expect(plan.claim.unpriced).toMatch(/TX-TOWEL-NV-4/);
    expect(plan.claim.unpriced).toMatch(/units only/);
  });

  it('says "no comparison was possible", not "reconciles", when a side is missing', () => {
    // Seen live: a shipment with only a PO attached produced a cover claiming
    // shipped and received "reconcile" — a comparison that never ran. The two
    // sentences make different promises to a reviewer.
    const bare = planPacket(input({ orders: [po()] }));
    expect(bare.claim.compared).toBe(false);

    const full = planPacket(
      input({
        orders: [po()],
        boxLabels: [label(1)],
        receipts: [receipt()],
        reconciliation: recon([
          { ...SHORT_LINE, status: 'balanced', discrepancy: 0 },
        ]),
      })
    );
    expect(full.claim.compared).toBe(true);
  });

  it('does not claim an over-receipt', () => {
    const plan = planPacket(
      input({
        orders: [po()],
        reconciliation: recon([
          { ...SHORT_LINE, status: 'over-received', discrepancy: -5 },
        ]),
      })
    );
    expect(plan.claim.lines).toEqual([]);
  });

  it('names an unrendered issued order as a gap rather than skipping the PO silently', () => {
    const plan = planPacket(input({ orders: [po({}, { renders: [] })] }));

    expect(plan.items.find((item) => item.key === 'po')).toBeUndefined();
    const gap = plan.gaps.find((entry) => entry.name.includes('PO-1'));
    expect(gap?.reason).toMatch(/never rendered/);
  });

  it('says when seller data was unreadable, which is not the same as missing', () => {
    const plan = planPacket(input({ sellerUnavailable: true }));

    const boxGap = plan.gaps.find((gap) => gap.name === 'Box labels');
    expect(boxGap?.reason).toMatch(/unreadable/);
    // An honest reason for genuinely-absent data names the remedy instead.
    const podGap = planPacket(input()).gaps.find(
      (gap) => gap.name === 'Box labels'
    );
    expect(podGap?.reason).toMatch(/never uploaded/);
  });
});
