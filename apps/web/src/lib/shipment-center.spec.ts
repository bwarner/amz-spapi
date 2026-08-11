import { describe, expect, it } from 'vitest';
import { buildShipmentView, type ShipmentViewInput } from './shipment-center';
import type {
  ShipmentReconciliation,
  StoredBoxLabel,
  StoredDocument,
  StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';

/**
 * The six-slot assembly. Every failure here is a wrong claim on screen: a slot
 * shown present that nothing evidences, a shipment dropped because only one
 * source knew it, a PO total presented as what the goods cost.
 */

const USER = 'auth0|seller';

function label(
  shipmentId: string,
  box: number,
  overrides: Partial<StoredBoxLabel> = {}
): StoredBoxLabel {
  return {
    labelId: `A1::${shipmentId}::box-${box}`,
    sellerId: 'A1',
    shipmentId,
    boxNumber: box,
    sku: 'TX-TOWEL-NV-4',
    quantity: 10,
    singleSku: true,
    identityIsContentHash: false,
    warnings: [],
    storedAt: 1_000,
    ...overrides,
  };
}

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
      documentDate: '2026-05-12',
      currency: 'USD',
      total: 9880,
      lines: [],
    } as StoredDocument['extracted'],
    issues: [],
    needsReview: false,
    storedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function recon(
  shipmentId: string,
  overrides: Partial<ShipmentReconciliation> = {}
): ShipmentReconciliation {
  return {
    shipmentId,
    firstReceiptDate: '2026-06-19',
    lastReceiptDate: '2026-06-24',
    lines: [
      {
        sku: 'TX-TOWEL-NV-4',
        shipped: 40,
        shippedIsFloor: false,
        receivedGross: 40,
        reversed: 0,
        receivedNet: 40,
        discrepancy: 0,
        status: 'balanced',
        fulfillmentCenters: ['GDL2'],
        reversalEvents: 0,
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function view(input: Partial<ShipmentViewInput>) {
  return buildShipmentView({
    boxLabels: [],
    reconciliations: [],
    documents: [],
    ...input,
  });
}

function nativePo(
  poNumber: string,
  overrides: Partial<StoredPurchaseOrder> = {}
): StoredPurchaseOrder {
  return {
    key: `${USER}::${poNumber}`,
    userId: USER,
    order: {
      poNumber,
      issueDate: '2026-08-11',
      revision: 1,
      status: 'open',
      vendorId: 'panama-select',
      currency: 'USD',
      lines: [
        {
          description: 'Honey Process Geisha 250g',
          quantity: 80,
          unitPrice: 20,
        },
      ],
    } as StoredPurchaseOrder['order'],
    renders: [],
    storedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('buildShipmentView', () => {
  it('fills the PO slot from an order the app itself issued', () => {
    // The gap this pins: a PO created in Sellavant never passes through the
    // import pipeline, so it used to be invisible to the checklist — the
    // seller who made an order could not point a shipment at it.
    const [entry] = view({
      boxLabels: [label('FBA19LGH61WZ', 1)],
      purchaseOrders: [
        nativePo('PO-2026-0003', { shipmentIds: ['FBA19LGH61WZ'] }),
      ],
    });

    const po = entry.slots.find((slot) => slot.key === 'po');
    expect(po?.present).toBe(true);
    expect(po?.poNumber).toBe('PO-2026-0003');
    // Value derived from the order's own lines — 80 × $20 — because the store
    // refuses to persist a total, and stated as the PO's, not an invoice's.
    expect(entry.value).toBe(1600);
    expect(entry.valueSource).toBe('po');
    expect(entry.vendorName).toBe('Panama Select');
  });

  it('does not surface a cancelled order, and an unlinked one claims nothing', () => {
    const entries = view({
      boxLabels: [label('FBA17K', 1)],
      purchaseOrders: [
        nativePo('PO-2026-0009'), // no shipmentIds — never attached
        nativePo('PO-2026-0010', {
          shipmentIds: ['FBA17K'],
          order: {
            ...nativePo('PO-2026-0010').order,
            status: 'cancelled',
          } as StoredPurchaseOrder['order'],
        }),
      ],
    });

    expect(entries).toHaveLength(1);
    const po = entries[0].slots.find((slot) => slot.key === 'po');
    expect(po?.present).toBe(false);
  });

  it('derives the box and ledger slots, and only those', () => {
    const [entry] = view({
      boxLabels: [label('FBA17K', 1), label('FBA17K', 2)],
      reconciliations: [recon('FBA17K')],
    });

    const bySlot = Object.fromEntries(entry.slots.map((s) => [s.key, s]));
    expect(bySlot['box'].present).toBe(true);
    expect(bySlot['ledger'].present).toBe(true);
    // Nothing was confirmed by a human, so nothing else may claim presence.
    expect(bySlot['po'].present).toBe(false);
    expect(bySlot['invoice'].present).toBe(false);
    expect(bySlot['pod'].present).toBe(false);
    expect(entry.presentCount).toBe(2);
  });

  it('fills document slots only from documents linked to THIS shipment', () => {
    const linked = document({ assetId: 'a1', shipmentIds: ['FBA17K'] });
    const unlinked = document({ assetId: 'a2', role: 'proof-of-delivery' });

    const [entry] = view({
      boxLabels: [label('FBA17K', 1)],
      documents: [linked, unlinked],
    });

    const bySlot = Object.fromEntries(entry.slots.map((s) => [s.key, s]));
    expect(bySlot['invoice'].present).toBe(true);
    expect(bySlot['invoice'].assetId).toBe('a1');
    // The POD exists in the library but was never attached — showing it would
    // be the assembly guessing, which is the one thing it must not do.
    expect(bySlot['pod'].present).toBe(false);
  });

  it('lists a shipment every source knows, once, from the union', () => {
    const entries = view({
      boxLabels: [label('FBA-LABELS-ONLY', 1)],
      reconciliations: [recon('FBA-LEDGER-ONLY')],
      documents: [document({ assetId: 'a1', shipmentIds: ['FBA-DOCS-ONLY'] })],
    });

    expect(entries.map((entry) => entry.shipmentId).sort()).toEqual([
      'FBA-DOCS-ONLY',
      'FBA-LABELS-ONLY',
      'FBA-LEDGER-ONLY',
    ]);
  });

  it('values a shipment from the invoice, and says when only the PO answered', () => {
    const po = document({
      assetId: 'a1',
      role: 'purchase-order',
      shipmentIds: ['FBA17K'],
      extracted: {
        vendorName: 'Yiwu Textile Co',
        currency: 'USD',
        total: 9000,
        lines: [],
      } as StoredDocument['extracted'],
    });
    const invoice = document({ assetId: 'a2', shipmentIds: ['FBA17K'] });

    const [withBoth] = view({ documents: [po, invoice] });
    // The invoice is the cost authority; the PO is what was ORDERED.
    expect(withBoth.value).toBe(9880);
    expect(withBoth.valueSource).toBe('invoice');

    const [poOnly] = view({ documents: [po] });
    expect(poOnly.value).toBe(9000);
    expect(poOnly.valueSource).toBe('po');
  });

  it('leads with a disputed invoice over everything else', () => {
    const disputed = document({
      assetId: 'a1',
      shipmentIds: ['FBA17K'],
      issues: [
        {
          code: 'lines-vs-subtotal',
          severity: 'blocker',
          message: 'off by 90',
        },
      ],
    });

    const [entry] = view({
      boxLabels: [label('FBA17K', 1)],
      reconciliations: [
        recon('FBA17K', {
          lines: [
            {
              sku: 'TX-TOWEL-NV-4',
              shipped: 40,
              shippedIsFloor: false,
              receivedGross: 35,
              reversed: 0,
              receivedNet: 35,
              discrepancy: 5,
              status: 'short',
              fulfillmentCenters: ['GDL2'],
              reversalEvents: 0,
            },
          ],
        }),
      ],
      documents: [disputed],
    });

    expect(entry.headline).toBe('Invoice arithmetic disputed');
    const invoiceSlot = entry.slots.find((slot) => slot.key === 'invoice');
    expect(invoiceSlot?.disputed).toBe(true);
    // The discrepancy is still counted, just not the headline.
    expect(entry.discrepancies).toBe(1);
  });

  it('names what is missing, and sorts newest first', () => {
    // Ordering is recency, NOT completeness. The first cut ranked
    // least-complete first, which pushed a shipment down the page the moment
    // the seller attached something to it — progress read as demotion, and
    // today's shipment sat under months of stale backlog.
    const complete = 'FBA-FULL';
    const entries = view({
      boxLabels: [
        label(complete, 1, { createdAt: '2026-06-01' }),
        label('FBA-THIN', 1, { createdAt: '2026-05-01' }),
      ],
      reconciliations: [recon(complete)],
      documents: (
        [
          ['purchase-order', 'a1'],
          ['commercial-invoice', 'a2'],
          ['packing-list', 'a3'],
          ['proof-of-delivery', 'a4'],
        ] as const
      ).map(([role, assetId]) =>
        document({ assetId, role, shipmentIds: [complete] })
      ),
    });

    // FBA-FULL is complete AND newer — it leads because it is newer.
    expect(entries[0].shipmentId).toBe(complete);
    expect(entries[0].presentCount).toBe(6);
    // A fully documented shipment has earned silence.
    expect(entries[0].headline).toBeUndefined();
    expect(entries[1].shipmentId).toBe('FBA-THIN');
    expect(entries[1].headline).toMatch(/^Missing purchase order, invoice/);
  });

  it('sorts a shipment with no dated evidence as newest of all', () => {
    // Documents-only, just linked by hand: being worked on right now.
    const entries = view({
      boxLabels: [label('FBA-DATED', 1, { createdAt: '2026-06-01' })],
      documents: [document({ assetId: 'a1', shipmentIds: ['FBA-NEW'] })],
    });
    expect(entries[0].shipmentId).toBe('FBA-NEW');
  });
});
