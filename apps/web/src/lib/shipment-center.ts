import {
  listBoxLabels,
  listDocuments,
  queryReceiptAggregates,
  reconcileShipments,
  type ShipmentReconciliation,
  type StoredBoxLabel,
  type StoredDocument,
} from '@amz-spapi/sp-cache';
import { summariseBoxLabels } from '@farvisionllc/models';
import { resolveSellerContext } from './document-center';

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

  // The union, not any one source: a shipment whose labels were never uploaded
  // still received units, and one that never received anything still shipped.
  const shipmentIds = new Set<string>([
    ...labelsByShipment.keys(),
    ...reconByShipment.keys(),
    ...documentsByShipment.keys(),
  ]);

  const entries = [...shipmentIds].map((shipmentId) =>
    buildEntry(
      shipmentId,
      labelsByShipment.get(shipmentId) ?? [],
      reconByShipment.get(shipmentId),
      documentsByShipment.get(shipmentId) ?? []
    )
  );

  // Least complete first: the screen exists to surface what is missing, and a
  // fully documented shipment needs nothing from anyone.
  return entries.sort(
    (a, b) =>
      a.presentCount - b.presentCount || (b.to ?? '').localeCompare(a.to ?? '')
  );
}

function buildEntry(
  shipmentId: string,
  labels: StoredBoxLabel[],
  recon: ShipmentReconciliation | undefined,
  documents: StoredDocument[]
): ShipmentEntry {
  const slots: Slot[] = [];

  for (const key of ['po', 'invoice', 'packingList'] as const) {
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
  const po = documents.find((document) => document.role === 'purchase-order');
  const costDocument = invoice ?? po;

  const vendorName = documents
    .map((document) => document.extracted.vendorName)
    .find(Boolean);

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
    value: costDocument?.extracted.total,
    valueCurrency: costDocument?.extracted.currency,
    valueSource: costDocument ? (invoice ? 'invoice' : 'po') : undefined,
    discrepancies,
  };
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

export type ShipmentCenter = {
  shipments: ShipmentEntry[];
  sellerStatus: 'connected' | 'not-connected' | 'unavailable';
};

export async function loadShipmentCenter(params: {
  userId: string;
}): Promise<ShipmentCenter> {
  const { userId } = params;
  const { sellerId, status: sellerStatus } = await resolveSellerContext(userId);

  const [documents, boxLabels, receipts] = await Promise.all([
    listDocuments({ userId, limit: 500 }),
    sellerId ? listBoxLabels({ sellerId }) : Promise.resolve([]),
    sellerId ? queryReceiptAggregates({ sellerId }) : Promise.resolve([]),
  ]);

  const reconciliations = reconcileShipments({
    receipts,
    shipped: shippedLines(boxLabels),
  });

  return {
    shipments: buildShipmentView({ boxLabels, reconciliations, documents }),
    sellerStatus,
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
