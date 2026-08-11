import {
  listBoxLabels,
  listDocuments,
  listPurchaseOrders,
  queryReceiptAggregates,
  reconcileShipments,
  type ShipmentReconciliation,
  type StoredBoxLabel,
  type StoredDocument,
  type StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';
import { purchaseOrderTotals, summariseBoxLabels } from '@farvisionllc/models';
import { issuedOrderFor, resolveSellerContext } from './document-center';

/**
 * Every inbound shipment, and which of its six documents exist.
 *
 * The design's claim is that a shipment WANTS six documents — PO, invoice,
 * packing list, box labels, proof of delivery, ledger receipts — and that the
 * useful screen is the one that says which are missing, because a
 * reimbursement claim is exactly as strong as its thinnest document.
 *
 * ## Where each slot's answer comes from
 *
 * Two slots are derived, four are confirmed. Box labels carry the shipment id
 * on their face, and the ledger's `referenceId` joins receipts to shipments —
 * those two fill themselves. A supplier's invoice does not mention Amazon's
 * shipment id anywhere, so PO, invoice, packing list and POD are attached by a
 * human (`setDocumentShipment`) and the answer survives re-import. Nothing
 * here guesses: a slot with no evidence reads as missing, not as probably-fine.
 *
 * Assembled rather than stored, from the same reasoning as the document
 * center: each piece already lives in the right collection, and a fifth copy
 * would only drift.
 */

export type SlotKey =
  | 'po'
  | 'invoice'
  | 'packingList'
  | 'box'
  | 'pod'
  | 'ledger';

export type Slot = {
  key: SlotKey;
  label: string;
  present: boolean;
  /** Set for document-backed slots, so the UI can link to the detail view. */
  assetId?: string;
  /** Set when the slot is answered by an order the app itself issued. */
  poNumber?: string;
  fileName?: string;
  /** Present, but carrying a blocker — shown as disputed rather than done. */
  disputed?: boolean;
  /** For the derived slots: what the evidence actually is. */
  note?: string;
};

export type ShipmentEntry = {
  shipmentId: string;
  /** From linked documents; a shipment with none linked has no vendor to name. */
  vendorName?: string;
  destinationFc?: string;
  /** Earliest and latest signals seen — label print, receipt dates. */
  from?: string;
  to?: string;
  slots: Slot[];
  presentCount: number;
  /** The single most useful sentence about what is wrong, or undefined. */
  headline?: string;
  /**
   * The money this shipment moved, from the cost authority: the linked
   * invoice's total, else the PO's. Which one answered is stated, because a PO
   * total is what was ORDERED and routinely differs from what was billed.
   */
  value?: number;
  valueCurrency?: string;
  valueSource?: 'invoice' | 'po';
  /** Lines that did not balance, from the ledger reconciliation. */
  discrepancies: number;
};

const SLOT_LABELS: Record<SlotKey, string> = {
  po: 'PO',
  invoice: 'INV',
  packingList: 'PL',
  box: 'BOX',
  pod: 'POD',
  ledger: 'LDG',
};

/** Which document role answers which slot. */
const SLOT_FOR_ROLE: Partial<Record<string, SlotKey>> = {
  'purchase-order': 'po',
  'commercial-invoice': 'invoice',
  'packing-list': 'packingList',
  'proof-of-delivery': 'pod',
};

export type ShipmentViewInput = {
  boxLabels: StoredBoxLabel[];
  reconciliations: ShipmentReconciliation[];
  documents: StoredDocument[];
  /**
   * Orders the app itself issued. A PO created in Sellavant never passes
   * through the import pipeline, so without these the PO slot could only ever
   * be filled by printing the order and re-uploading it — which is how the gap
   * was found: a seller made an order and the picker could not see it.
   */
  purchaseOrders?: StoredPurchaseOrder[];
};

export function buildShipmentView(input: ShipmentViewInput): ShipmentEntry[] {
  const labelsByShipment = new Map<string, StoredBoxLabel[]>();
  for (const label of input.boxLabels) {
    const list = labelsByShipment.get(label.shipmentId) ?? [];
    list.push(label);
    labelsByShipment.set(label.shipmentId, list);
  }

  const reconByShipment = new Map(
    input.reconciliations.map((entry) => [entry.shipmentId, entry])
  );

  const documentsByShipment = new Map<string, StoredDocument[]>();
  for (const document of input.documents) {
    for (const shipmentId of document.shipmentIds ?? []) {
      const list = documentsByShipment.get(shipmentId) ?? [];
      list.push(document);
      documentsByShipment.set(shipmentId, list);
    }
  }

  const allOrderNumbers = new Map<string, string>();
  for (const po of input.purchaseOrders ?? []) {
    allOrderNumbers.set(
      po.order.poNumber.trim().toUpperCase().replace(/\s+/g, ''),
      po.order.poNumber
    );
  }

  const ordersByShipment = new Map<string, StoredPurchaseOrder[]>();
  for (const po of input.purchaseOrders ?? []) {
    if (po.order.status === 'cancelled') continue;
    for (const shipmentId of po.shipmentIds ?? []) {
      const list = ordersByShipment.get(shipmentId) ?? [];
      list.push(po);
      ordersByShipment.set(shipmentId, list);
    }
  }

  // The union, not any one source: a shipment whose labels were never uploaded
  // still received units, and one that never received anything still shipped.
  const shipmentIds = new Set<string>([
    ...labelsByShipment.keys(),
    ...reconByShipment.keys(),
    ...documentsByShipment.keys(),
    ...ordersByShipment.keys(),
  ]);

  const entries = [...shipmentIds].map((shipmentId) =>
    buildEntry(
      shipmentId,
      labelsByShipment.get(shipmentId) ?? [],
      reconByShipment.get(shipmentId),
      documentsByShipment.get(shipmentId) ?? [],
      ordersByShipment.get(shipmentId) ?? [],
      allOrderNumbers
    )
  );

  // Newest first. The first cut sorted least-complete first, which buried the
  // shipment a seller was actively working on at the bottom the moment they
  // attached anything to it — completeness RANKING punished progress. What is
  // missing is already carried by the count badge and the Incomplete tab; the
  // order's job is "what am I working on", and that is recency. A shipment
  // with no dated evidence yet (documents only, just linked by hand) is being
  // worked on right now, so it sorts as newest of all.
  return entries.sort(
    (a, b) =>
      (b.to ?? '9999').localeCompare(a.to ?? '9999') ||
      a.presentCount - b.presentCount
  );
}

function buildEntry(
  shipmentId: string,
  labels: StoredBoxLabel[],
  recon: ShipmentReconciliation | undefined,
  documents: StoredDocument[],
  orders: StoredPurchaseOrder[],
  allOrderNumbers: Map<string, string>
): ShipmentEntry {
  const slots: Slot[] = [];

  // The app's own order outranks an uploaded copy of one: it is the record the
  // PDF was printed FROM, so where both exist the original answers.
  const nativePo = orders[0];
  const uploadedPoSlot = documentSlot('po', documents);
  if (!nativePo && uploadedPoSlot.present) {
    // An uploaded document that IS one of our orders is named as such, so the
    // card reads the same whichever record answered the slot.
    const linkedPoDocument = documents.find(
      (document) => document.role === 'purchase-order'
    );
    const copyOf = linkedPoDocument
      ? issuedOrderFor(linkedPoDocument, allOrderNumbers)
      : undefined;
    if (copyOf) uploadedPoSlot.note = `copy of ${copyOf}`;
  }
  slots.push(
    nativePo
      ? {
          key: 'po',
          label: SLOT_LABELS.po,
          present: true,
          poNumber: nativePo.order.poNumber,
          fileName: nativePo.order.poNumber,
          note: 'issued in Sellavant',
        }
      : uploadedPoSlot
  );
  for (const key of ['invoice', 'packingList'] as const) {
    slots.push(documentSlot(key, documents));
  }

  const summaries = summariseBoxLabels(labels);
  const boxSummary = summaries[0];
  slots.push({
    key: 'box',
    label: SLOT_LABELS.box,
    present: labels.length > 0,
    note: boxSummary
      ? `${boxSummary.boxesSeen}${
          boxSummary.boxesDeclared ? ` of ${boxSummary.boxesDeclared}` : ''
        } boxes · ${boxSummary.totalUnits} units`
      : undefined,
  });

  slots.push(documentSlot('pod', documents));

  const received = recon?.lines.some((line) => line.receivedGross > 0) ?? false;
  slots.push({
    key: 'ledger',
    label: SLOT_LABELS.ledger,
    present: received,
    note: recon?.firstReceiptDate
      ? `received ${recon.firstReceiptDate}${
          recon.lastReceiptDate &&
          recon.lastReceiptDate !== recon.firstReceiptDate
            ? ` → ${recon.lastReceiptDate}`
            : ''
        }`
      : undefined,
  });

  const presentCount = slots.filter((slot) => slot.present).length;

  const discrepancies =
    recon?.lines.filter(
      (line) => line.status === 'short' || line.status === 'over-received'
    ).length ?? 0;

  const invoice = documents.find(
    (document) => document.role === 'commercial-invoice'
  );
  const poDocument = documents.find(
    (document) => document.role === 'purchase-order'
  );

  // Value: invoice first (the cost authority), then the issued order, then an
  // uploaded PO document. Totals on a native order are DERIVED — the store
  // refuses to persist one — so they are computed here the same way the
  // printed PDF computes them.
  const nativeTotals = nativePo
    ? purchaseOrderTotals(nativePo.order)
    : undefined;
  const value =
    invoice?.extracted.total ??
    nativeTotals?.total ??
    poDocument?.extracted.total;
  const valueCurrency =
    invoice?.extracted.currency ??
    (nativePo ? nativePo.order.currency : undefined) ??
    poDocument?.extracted.currency;
  const valueSource: ShipmentEntry['valueSource'] = invoice
    ? 'invoice'
    : nativePo || poDocument
    ? 'po'
    : undefined;

  const vendorName =
    documents.map((document) => document.extracted.vendorName).find(Boolean) ??
    (nativePo ? vendorNameFromId(nativePo.order.vendorId) : undefined);

  const dates = [
    ...labels.map((label) => label.createdAt).filter(Boolean),
    recon?.firstReceiptDate,
    recon?.lastReceiptDate,
  ].filter((value): value is string => Boolean(value));
  dates.sort();

  return {
    shipmentId,
    vendorName,
    destinationFc: labels.find((label) => label.destinationFc)?.destinationFc,
    from: dates[0],
    to: dates[dates.length - 1],
    slots,
    presentCount,
    headline: headline(slots, discrepancies, invoice),
    value,
    valueCurrency,
    valueSource: value !== undefined ? valueSource : undefined,
    discrepancies,
  };
}

/**
 * "panama-select" → "Panama Select". The order stores the vendor as a slug;
 * the vendor record holds the display name, but a listing should not need a
 * per-shipment vendor lookup to say who a PO was issued to.
 */
function vendorNameFromId(vendorId: string): string {
  return vendorId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function documentSlot(key: SlotKey, documents: StoredDocument[]): Slot {
  const match = documents.find(
    (document) => SLOT_FOR_ROLE[document.role] === key
  );
  return {
    key,
    label: SLOT_LABELS[key],
    present: Boolean(match),
    assetId: match?.assetId,
    fileName: match?.fileName,
    disputed: match?.issues.some((issue) => issue.severity === 'blocker'),
  };
}

/**
 * The one sentence worth leading with.
 *
 * Ordered by what costs money soonest: a disputed invoice blocks the cost
 * basis today; a ledger discrepancy is a claim with a deadline; a missing
 * document is a weaker claim later. "Complete" earns silence.
 */
function headline(
  slots: Slot[],
  discrepancies: number,
  invoice: StoredDocument | undefined
): string | undefined {
  if (invoice?.issues.some((issue) => issue.severity === 'blocker')) {
    return 'Invoice arithmetic disputed';
  }
  if (discrepancies > 0) {
    return `${discrepancies} SKU${
      discrepancies === 1 ? '' : 's'
    } did not reconcile`;
  }
  const missing = slots.filter((slot) => !slot.present);
  if (missing.length) {
    const NAMES: Record<SlotKey, string> = {
      po: 'purchase order',
      invoice: 'invoice',
      packingList: 'packing list',
      box: 'box labels',
      pod: 'proof of delivery',
      ledger: 'ledger receipts',
    };
    if (missing.length === 1) return `Missing ${NAMES[missing[0].key]}`;
    return `Missing ${missing.map((slot) => NAMES[slot.key]).join(', ')}`;
  }
  return undefined;
}

export type PoCandidate = {
  poNumber: string;
  vendorName: string;
  issueDate: string;
  total: number;
  currency: string;
  shipmentIds: string[];
};

export type ShipmentCenter = {
  shipments: ShipmentEntry[];
  sellerStatus: 'connected' | 'not-connected' | 'unavailable';
  /** Orders the app issued — the native half of the PO attach picker. */
  orders: PoCandidate[];
};

export async function loadShipmentCenter(params: {
  userId: string;
}): Promise<ShipmentCenter> {
  const { userId } = params;
  const { sellerId, status: sellerStatus } = await resolveSellerContext(userId);

  const [documents, boxLabels, receipts, purchaseOrders] = await Promise.all([
    listDocuments({ userId, limit: 500 }),
    sellerId ? listBoxLabels({ sellerId }) : Promise.resolve([]),
    sellerId ? queryReceiptAggregates({ sellerId }) : Promise.resolve([]),
    listPurchaseOrders({ userId }),
  ]);

  const reconciliations = reconcileShipments({
    receipts,
    shipped: shippedLines(boxLabels),
  });

  return {
    shipments: buildShipmentView({
      boxLabels,
      reconciliations,
      documents,
      purchaseOrders,
    }),
    sellerStatus,
    // The attach picker's native half: every open order, whether or not it is
    // linked to anything yet.
    orders: purchaseOrders
      .filter((po) => po.order.status !== 'cancelled')
      .map((po) => {
        const totals = purchaseOrderTotals(po.order);
        return {
          poNumber: po.order.poNumber,
          vendorName: vendorNameFromId(po.order.vendorId),
          issueDate: po.order.issueDate,
          total: totals.total,
          currency: po.order.currency,
          shipmentIds: po.shipmentIds ?? [],
        };
      }),
  };
}

/** Box labels → the shipped side, the same reduction the reconcile route does. */
function shippedLines(labels: StoredBoxLabel[]) {
  return summariseBoxLabels(labels).flatMap((summary) =>
    summary.units.map((unit) => ({
      shipmentId: summary.shipmentId,
      sku: unit.sku,
      quantity: unit.quantity,
      complete: summary.complete,
      boxesSeen: summary.boxesSeen,
      boxesDeclared: summary.boxesDeclared,
    }))
  );
}
