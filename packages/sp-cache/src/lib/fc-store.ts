/**
 * Persist Amazon fulfillment center addresses, learned per seller.
 *
 * Amazon names inbound destinations only by FC code; the street address
 * appears on the seller's shipment plan and nowhere in the API. This store
 * captures each address the first time the seller supplies it, so a code like
 * "ONT8" resolves to a full ship-to block on every later purchase order.
 *
 * Per-seller on purpose, like every other store here: a shared table would
 * let one seller's typo (or worse) become another seller's shipping address.
 */

import {
  collectionName,
  executeQuery,
  getDocument as getCouchbaseDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import { FcAddressSchema, type FcAddress } from '@farvisionllc/models';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const fcStorage = {
  executeQuery,
  upsertDocument,
  getDocument: getCouchbaseDocument,
};

const SCOPE = 'purchases';
/**
 * NOT the original name, and that is a workaround.
 *
 * Capella's Data API wedges on certain collection names: every request against
 * them — read or write — hangs with no response, while sibling collections in
 * the same scope answer in under 300ms. Dropping and recreating does not clear
 * it; a fresh NAME works immediately. Confirmed on three collections in this
 * domain.
 *
 * Revert once Capella support clears the state. Nothing needs migrating — these
 * collections never held a document.
 */
const COLLECTION = 'fc-records';

export class FcStoreError extends Error {}

export type StoredFcAddress = {
  /** `${userId}::${fcCode}` — the Couchbase key, ownership included. */
  key: string;
  userId: string;
  fc: FcAddress;
  storedAt: number;
  updatedAt: number;
};

function fcKey(userId: string, fcCode: string): string {
  return `${userId}::${fcCode}`;
}

/** Codes arrive in whatever case the user typed; identity is uppercase. */
function normalizeCode(fcCode: string): string {
  return fcCode.trim().toUpperCase();
}

/** Save or replace an FC address. Replacement is deliberate — a moved or
 * corrected address must fully displace the old one, not merge with it. */
export async function saveFcAddress(params: {
  userId: string;
  fc: FcAddress;
}): Promise<StoredFcAddress> {
  const { userId } = params;
  if (!userId) throw new FcStoreError('An FC address needs an owner.');

  const fc = FcAddressSchema.parse({
    ...params.fc,
    fcCode: normalizeCode(params.fc.fcCode),
  });
  const key = fcKey(userId, fc.fcCode);
  const existing = await fcStorage.getDocument<StoredFcAddress>(
    SCOPE,
    COLLECTION,
    key
  );

  const now = Date.now();
  const record: StoredFcAddress = {
    key,
    userId,
    fc,
    storedAt: existing?.storedAt ?? now,
    updatedAt: now,
  };
  await fcStorage.upsertDocument(SCOPE, COLLECTION, key, record);
  return record;
}

export async function getFcAddress(
  userId: string,
  fcCode: string
): Promise<StoredFcAddress | null> {
  const record = await fcStorage.getDocument<StoredFcAddress>(
    SCOPE,
    COLLECTION,
    fcKey(userId, normalizeCode(fcCode))
  );
  // Ownership is checked here rather than trusted from the key, so a guessed
  // code cannot read another seller's address book.
  if (!record || record.userId !== userId) return null;
  return record;
}

/** Every FC this seller has shipped to, by code. */
export async function listFcAddresses(params: {
  userId: string;
  limit?: number;
}): Promise<StoredFcAddress[]> {
  if (!params.userId) throw new FcStoreError('An FC listing needs a user.');
  const { rows } = await fcStorage.executeQuery<StoredFcAddress>(
    SCOPE,
    `SELECT RAW f FROM \`${collectionName(SCOPE, COLLECTION)}\` f
     WHERE f.\`userId\` = $userId
     ORDER BY f.\`fc\`.\`fcCode\` ASC
     LIMIT $limit`,
    { parameters: { userId: params.userId, limit: params.limit ?? 200 } }
  );
  return rows;
}
