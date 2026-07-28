/**
 * Persist FBA box labels as structured records.
 *
 * A box label is the only evidence a seller holds of what they actually SENT.
 * Kept as its own collection rather than as report rows: it is not an Amazon
 * report, it has a natural identity, and reconciliation reads it as the shipped
 * side of a comparison whose other side is the ledger.
 *
 * Identity is (seller, shipment, box). Uploading the same label twice, or
 * printing two copies of it and scanning both, upserts the same document — so
 * the shipped quantity cannot be inflated by handling. Labels that carry no box
 * number fall back to a content hash, which dedupes identical files but cannot
 * tell two genuinely different unnumbered boxes apart; that is recorded on the
 * record rather than hidden.
 */

import { createHash } from 'node:crypto';
import { executeQuery, upsertDocument } from '@amz-spapi/couchbase-utils';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const boxLabelStorage = { executeQuery, upsertDocument };

const SCOPE = 'reports';
const COLLECTION = 'box_labels';

/** What a stored label holds. Mirrors the parser's output plus provenance. */
export type StoredBoxLabel = {
  labelId: string;
  sellerId: string;
  shipmentId: string;
  boxNumber?: number;
  boxCount?: number;
  destinationFc?: string;
  sku?: string;
  quantity?: number;
  expiresOn?: string;
  weightLb?: number;
  singleSku: boolean;
  /** True when identity fell back to a content hash. */
  identityIsContentHash: boolean;
  /** Asset the label was read from, so a figure can be traced to its PDF. */
  assetId?: string;
  fileName?: string;
  warnings: string[];
  /** When Amazon printed the label, as printed on it. */
  createdAt?: string;
  /** When we stored the record. Distinct from the label's own print time. */
  storedAt: number;
};

export type BoxLabelInput = {
  shipmentId?: string;
  boxNumber?: number;
  boxCount?: number;
  destinationFc?: string;
  sku?: string;
  quantity?: number;
  expiresOn?: string;
  weightLb?: number;
  singleSku: boolean;
  createdAt?: string;
  warnings: string[];
};

export class BoxLabelError extends Error {}

export async function storeBoxLabel(params: {
  sellerId: string;
  label: BoxLabelInput;
  assetId?: string;
  fileName?: string;
  /** Raw label text, used only when there is no box number to key on. */
  text?: string;
}): Promise<StoredBoxLabel> {
  const { sellerId, label } = params;
  if (!label.shipmentId) {
    // Without a shipment id the label cannot be joined to anything, and storing
    // it would put an uncountable row into a count.
    throw new BoxLabelError(
      'Box label carries no FBA shipment id, so it cannot be reconciled.'
    );
  }

  const identityIsContentHash = label.boxNumber == null;
  const suffix = identityIsContentHash
    ? `sha-${createHash('sha256')
        .update(params.text ?? params.fileName ?? '')
        .digest('hex')
        .slice(0, 16)}`
    : `box-${String(label.boxNumber).padStart(6, '0')}`;

  const record: StoredBoxLabel = {
    labelId: `${sellerId}::${label.shipmentId}::${suffix}`,
    sellerId,
    shipmentId: label.shipmentId,
    boxNumber: label.boxNumber,
    boxCount: label.boxCount,
    destinationFc: label.destinationFc,
    sku: label.sku,
    quantity: label.quantity,
    expiresOn: label.expiresOn,
    weightLb: label.weightLb,
    singleSku: label.singleSku,
    identityIsContentHash,
    assetId: params.assetId,
    fileName: params.fileName,
    warnings: label.warnings,
    createdAt: label.createdAt,
    storedAt: Date.now(),
  };

  await boxLabelStorage.upsertDocument(
    SCOPE,
    COLLECTION,
    `boxlabel::${record.labelId}`,
    record
  );
  return record;
}

/** Every stored label for a seller, optionally for one shipment. */
export async function listBoxLabels(params: {
  sellerId: string;
  shipmentId?: string;
}): Promise<StoredBoxLabel[]> {
  const conditions = ['d.sellerId = $sellerId'];
  const parameters: Record<string, unknown> = { sellerId: params.sellerId };
  if (params.shipmentId) {
    conditions.push('d.shipmentId = $shipmentId');
    parameters['shipmentId'] = params.shipmentId;
  }

  const { rows } = await boxLabelStorage.executeQuery<StoredBoxLabel>(
    SCOPE,
    `SELECT RAW d FROM \`${COLLECTION}\` AS d
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.shipmentId, d.boxNumber`,
    { parameters, readonly: true }
  );
  return rows;
}
