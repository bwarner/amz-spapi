/**
 * Persist the seller's vendors.
 *
 * Sourcing search results and vendor names on invoices both evaporate with the
 * response that carried them. This is the durable directory behind both: a
 * vendor saved once can be issued purchase orders, matched against invoice
 * vendor names, and carried default terms (payment, incoterms, lead time) that
 * prefill the next order.
 *
 * Identity is (user, slugged name) — see `vendorIdForName` in models. The
 * name is the only identifier every path has, and slug identity makes saving
 * the same vendor twice an update rather than a duplicate.
 */

import {
  collectionName,
  executeQuery,
  getDocument as getCouchbaseDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  VendorSchema,
  vendorIdForName,
  type Vendor,
} from '@farvisionllc/models';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const vendorStorage = {
  executeQuery,
  upsertDocument,
  getDocument: getCouchbaseDocument,
};

const SCOPE = 'purchases';
/**
 * NOT `vendors`, and that is a workaround rather than a preference.
 *
 * `purchases_vendors` is stuck at Couchbase's Data API: a document GET against
 * it never returns — not a 404, no response at all — while every sibling
 * collection answers in under 300ms and a collection created four seconds
 * earlier answers immediately. Dropping and recreating it did not clear the
 * state, and it stayed dead across a minute of retries. The query service can
 * read the collection; only the KV path is affected.
 *
 * Since a hung request is the worst failure available, the code moved off the
 * poisoned name. Revert to `vendors` once Capella support has cleared it —
 * there is no data to migrate, the collection has never held a document.
 */
const COLLECTION = 'vendor-records';

export class VendorStoreError extends Error {}

export type StoredVendor = {
  /** `${userId}::${vendorId}` — the Couchbase key, ownership included. */
  key: string;
  userId: string;
  vendor: Vendor;
  storedAt: number;
  updatedAt: number;
};

function vendorKey(userId: string, vendorId: string): string {
  return `${userId}::${vendorId}`;
}

export type SaveVendorParams = {
  userId: string;
  /** `vendorId` is derived from the name; passing one is ignored. */
  vendor: Omit<Vendor, 'vendorId'>;
};

/**
 * Save a vendor, or update the one this name already resolves to.
 *
 * Merge semantics: fields present in the new record win; fields absent keep
 * their stored value. A save from a sourcing search that only knows the name
 * and profile URL must not blank out the contact details a human typed in.
 */
export async function saveVendor(
  params: SaveVendorParams
): Promise<StoredVendor> {
  const { userId } = params;
  if (!userId) throw new VendorStoreError('A vendor needs an owner.');

  const vendorId = vendorIdForName(params.vendor.name);
  if (!vendorId) {
    throw new VendorStoreError(
      `Vendor name "${params.vendor.name}" has no usable characters.`
    );
  }

  const key = vendorKey(userId, vendorId);
  const existing = await vendorStorage.getDocument<StoredVendor>(
    SCOPE,
    COLLECTION,
    key
  );

  const merged = VendorSchema.parse({
    ...existing?.vendor,
    // Drop undefined values so they cannot shadow stored fields in the spread.
    ...Object.fromEntries(
      Object.entries(params.vendor).filter(([, v]) => v !== undefined)
    ),
    vendorId,
  });

  const now = Date.now();
  const record: StoredVendor = {
    key,
    userId,
    vendor: merged,
    storedAt: existing?.storedAt ?? now,
    updatedAt: now,
  };
  await vendorStorage.upsertDocument(SCOPE, COLLECTION, key, record);
  return record;
}

export async function getVendor(
  userId: string,
  vendorId: string
): Promise<StoredVendor | null> {
  const record = await vendorStorage.getDocument<StoredVendor>(
    SCOPE,
    COLLECTION,
    vendorKey(userId, vendorId)
  );
  // Ownership is checked here rather than trusted from the key, so a guessed
  // id cannot read another seller's vendor.
  if (!record || record.userId !== userId) return null;
  return record;
}

/** One seller's vendors, alphabetical — a directory, not a feed. */
export async function listVendors(params: {
  userId: string;
  limit?: number;
}): Promise<StoredVendor[]> {
  if (!params.userId) {
    throw new VendorStoreError('A vendor listing needs a user.');
  }
  const { rows } = await vendorStorage.executeQuery<StoredVendor>(
    SCOPE,
    `SELECT RAW s FROM \`${collectionName(SCOPE, COLLECTION)}\` s
     WHERE s.\`userId\` = $userId
     ORDER BY s.\`vendor\`.\`name\` ASC
     LIMIT $limit`,
    { parameters: { userId: params.userId, limit: params.limit ?? 200 } }
  );
  return rows;
}
