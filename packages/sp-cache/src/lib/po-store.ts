/**
 * Persist purchase orders the seller issues.
 *
 * The structured order is the record; any rendered file (PDF today, XLSX
 * later) is a projection kept alongside it so re-downloading does not
 * re-render. Totals are never stored — they are derived from the lines by
 * `purchaseOrderTotals`, so a stored figure can never disagree with the lines
 * it summarises.
 *
 * PO numbers are sequential per seller per year ("PO-2026-0007") via a
 * Couchbase counter. Sequential matters: vendors and bookkeepers refer to
 * orders by number, and a gap or repeat reads as a missing or forged order.
 */

import {
  collectionName,
  executeQuery,
  getDocument as getCouchbaseDocument,
  incrementCounter,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  PurchaseOrderSchema,
  formatPoNumber,
  type PurchaseOrder,
} from '@farvisionllc/models';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const poStorage = {
  executeQuery,
  upsertDocument,
  getDocument: getCouchbaseDocument,
  incrementCounter,
};

const SCOPE = 'purchases';
const COLLECTION = 'purchase-orders';

export class PoStoreError extends Error {}

/** A rendered projection of the order, addressable for download. */
export type RenderedPo = {
  format: 'pdf' | 'xlsx';
  assetId: string;
  renderedAt: number;
};

export type StoredPurchaseOrder = {
  /** `${userId}::${poNumber}` — the Couchbase key, ownership included. */
  key: string;
  userId: string;
  order: PurchaseOrder;
  /** Latest render per format; re-rendering replaces, never accumulates. */
  renders: RenderedPo[];
  /**
   * FBA shipments this order's goods went out as, confirmed by a human.
   *
   * The same fact `StoredDocument.shipmentIds` records for uploaded paperwork,
   * kept here for orders the app itself issued — a PO created in Sellavant
   * never passes through the import pipeline, so without this it could not
   * fill a shipment's PO slot at all. A list: one order routinely becomes
   * several shipments.
   */
  shipmentIds?: string[];
  storedAt: number;
  updatedAt: number;
};

function poKey(userId: string, poNumber: string): string {
  return `${userId}::${poNumber}`;
}

/**
 * Claim the next PO number for this seller. The counter is the authority;
 * numbers are handed out once and never reused, even for orders that are
 * abandoned before storage.
 */
export async function nextPoNumber(
  userId: string,
  year: number
): Promise<string> {
  if (!userId) throw new PoStoreError('A PO number needs an owner.');
  const sequence = await poStorage.incrementCounter(
    SCOPE,
    COLLECTION,
    `${userId}::po-counter::${year}`,
    1
  );
  return formatPoNumber(year, sequence);
}

/**
 * Store an order under its assigned number, or update the one already there.
 * The order is validated on the way in — the store is the last gate before
 * something unprintable becomes a business record.
 */
export async function storePurchaseOrder(params: {
  userId: string;
  order: PurchaseOrder;
}): Promise<StoredPurchaseOrder> {
  const { userId } = params;
  if (!userId) throw new PoStoreError('A purchase order needs an owner.');

  const order = PurchaseOrderSchema.parse(params.order);
  const key = poKey(userId, order.poNumber);
  const existing = await poStorage.getDocument<StoredPurchaseOrder>(
    SCOPE,
    COLLECTION,
    key
  );

  const now = Date.now();
  const record: StoredPurchaseOrder = {
    key,
    userId,
    order,
    // Content changed ⇒ every existing render shows stale figures. Drop them
    // so a download can never serve a PDF that disagrees with the order.
    renders:
      existing && contentChanged(existing.order, order)
        ? []
        : existing?.renders ?? [],
    // A human's shipment links survive edits, like every other human answer.
    shipmentIds: existing?.shipmentIds,
    storedAt: existing?.storedAt ?? now,
    updatedAt: now,
  };
  await poStorage.upsertDocument(SCOPE, COLLECTION, key, record);
  return record;
}

/**
 * Attach an issued order to a shipment, or detach it. Mirrors
 * `setDocumentShipment`: sorted, deduplicated, and the field is removed rather
 * than left `[]` — an empty list would claim "belongs to no shipment", which
 * is a different statement from "never asked".
 */
export async function setPurchaseOrderShipment(params: {
  userId: string;
  poNumber: string;
  shipmentId: string;
  attached: boolean;
}): Promise<StoredPurchaseOrder> {
  const existing = await getPurchaseOrder(params.userId, params.poNumber);
  if (!existing) throw new PoStoreError(`No order ${params.poNumber}.`);
  if (!params.shipmentId.trim()) {
    throw new PoStoreError('A shipment link needs a shipment id.');
  }

  const shipments = new Set(existing.shipmentIds ?? []);
  if (params.attached) shipments.add(params.shipmentId);
  else shipments.delete(params.shipmentId);

  const record: StoredPurchaseOrder = {
    ...existing,
    shipmentIds: shipments.size ? [...shipments].sort() : undefined,
    updatedAt: Date.now(),
  };
  await poStorage.upsertDocument(SCOPE, COLLECTION, existing.key, record);
  return record;
}

function contentChanged(a: PurchaseOrder, b: PurchaseOrder): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** The fields a revision may change — identity and system fields may not. */
export type PurchaseOrderChanges = Omit<
  PurchaseOrder,
  | 'poNumber'
  | 'issueDate'
  | 'vendorId'
  | 'revision'
  | 'revisedDate'
  | 'status'
  | 'cancellationReason'
>;

/**
 * Revise an order in place: same number, same vendor, revision + 1.
 *
 * Takes the COMPLETE corrected content, not a delta — a delta would make the
 * stored order depend on the sequence of edits that produced it, and a missed
 * one would silently keep a figure both sides think was corrected. Renders are
 * invalidated by the content change, so a download after a revision can only
 * ever serve the revised document.
 */
export async function revisePurchaseOrder(params: {
  userId: string;
  poNumber: string;
  changes: PurchaseOrderChanges;
  revisionNote?: string;
  revisedDate: string;
}): Promise<StoredPurchaseOrder> {
  const existing = await getPurchaseOrder(params.userId, params.poNumber);
  if (!existing)
    throw new PoStoreError(`No purchase order ${params.poNumber}.`);
  if (existing.order.status === 'cancelled') {
    throw new PoStoreError(
      `${params.poNumber} is cancelled — create a new order instead of revising it.`
    );
  }

  const order = PurchaseOrderSchema.parse({
    ...params.changes,
    poNumber: existing.order.poNumber,
    issueDate: existing.order.issueDate,
    vendorId: existing.order.vendorId,
    revision: existing.order.revision + 1,
    revisedDate: params.revisedDate,
    revisionNote: params.revisionNote,
    status: 'open',
  });
  return storePurchaseOrder({ userId: params.userId, order });
}

/**
 * Mark an order cancelled. It stays on the record — a deleted number reads as
 * missing or forged — and its renders are dropped, so nothing downloadable
 * still looks like a live order.
 */
export async function cancelPurchaseOrder(params: {
  userId: string;
  poNumber: string;
  reason?: string;
}): Promise<StoredPurchaseOrder> {
  const existing = await getPurchaseOrder(params.userId, params.poNumber);
  if (!existing)
    throw new PoStoreError(`No purchase order ${params.poNumber}.`);

  const order = PurchaseOrderSchema.parse({
    ...existing.order,
    status: 'cancelled',
    cancellationReason: params.reason,
  });
  return storePurchaseOrder({ userId: params.userId, order });
}

export async function getPurchaseOrder(
  userId: string,
  poNumber: string
): Promise<StoredPurchaseOrder | null> {
  const record = await poStorage.getDocument<StoredPurchaseOrder>(
    SCOPE,
    COLLECTION,
    poKey(userId, poNumber)
  );
  // Ownership is checked here rather than trusted from the key, so a guessed
  // number cannot read another seller's order.
  if (!record || record.userId !== userId) return null;
  return record;
}

/** Record a fresh render, replacing any previous one of the same format. */
export async function recordRenderedPo(params: {
  userId: string;
  poNumber: string;
  render: RenderedPo;
}): Promise<StoredPurchaseOrder> {
  const existing = await getPurchaseOrder(params.userId, params.poNumber);
  if (!existing) {
    throw new PoStoreError(`No purchase order ${params.poNumber}.`);
  }
  const record: StoredPurchaseOrder = {
    ...existing,
    renders: [
      ...existing.renders.filter((r) => r.format !== params.render.format),
      params.render,
    ],
    updatedAt: Date.now(),
  };
  await poStorage.upsertDocument(SCOPE, COLLECTION, record.key, record);
  return record;
}

export type ListPurchaseOrdersFilters = {
  userId: string;
  vendorId?: string;
  /** ISO date, inclusive, on the order's issue date. */
  from?: string;
  to?: string;
  limit?: number;
};

/** One seller's orders, newest first by issue date. */
export async function listPurchaseOrders(
  filters: ListPurchaseOrdersFilters
): Promise<StoredPurchaseOrder[]> {
  const { userId } = filters;
  if (!userId) throw new PoStoreError('A PO listing needs a user.');

  const conditions = ['p.`userId` = $userId'];
  const parameters: Record<string, unknown> = { userId };

  if (filters.vendorId) {
    conditions.push('p.`order`.`vendorId` = $vendorId');
    parameters['vendorId'] = filters.vendorId;
  }
  if (filters.from) {
    conditions.push('p.`order`.`issueDate` >= $from');
    parameters['from'] = filters.from;
  }
  if (filters.to) {
    conditions.push('p.`order`.`issueDate` <= $to');
    parameters['to'] = filters.to;
  }

  const { rows } = await poStorage.executeQuery<StoredPurchaseOrder>(
    SCOPE,
    `SELECT RAW p FROM \`${collectionName(SCOPE, COLLECTION)}\` p
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.\`order\`.\`issueDate\` DESC, p.\`order\`.\`poNumber\` DESC
     LIMIT $limit`,
    { parameters: { ...parameters, limit: filters.limit ?? 100 } }
  );
  return rows;
}
