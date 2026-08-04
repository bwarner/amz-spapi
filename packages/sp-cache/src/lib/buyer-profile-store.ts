/**
 * Persist the seller's buyer identity — the "From" block on purchase orders.
 *
 * One document per user, merged on save for the same reason the vendor store
 * merges: profile details arrive piecemeal (a name in one chat, a DUNS number
 * weeks later when a vendor asks for it), and a sparse update must not blank
 * out what was already known.
 */

import {
  getDocument as getCouchbaseDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import { BuyerSchema, type Buyer } from '@farvisionllc/models';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const buyerProfileStorage = {
  upsertDocument,
  getDocument: getCouchbaseDocument,
};

const SCOPE = 'purchases';
const COLLECTION = 'buyer-profiles';

export class BuyerProfileError extends Error {}

export type StoredBuyerProfile = {
  userId: string;
  buyer: Buyer;
  storedAt: number;
  updatedAt: number;
};

/** Merge semantics: present fields win, absent fields keep stored values. */
export async function saveBuyerProfile(params: {
  userId: string;
  buyer: Buyer;
}): Promise<StoredBuyerProfile> {
  const { userId } = params;
  if (!userId) throw new BuyerProfileError('A buyer profile needs an owner.');

  const existing = await buyerProfileStorage.getDocument<StoredBuyerProfile>(
    SCOPE,
    COLLECTION,
    userId
  );
  const merged = BuyerSchema.parse({
    ...existing?.buyer,
    ...Object.fromEntries(
      Object.entries(params.buyer).filter(([, v]) => v !== undefined)
    ),
  });

  const now = Date.now();
  const record: StoredBuyerProfile = {
    userId,
    buyer: merged,
    storedAt: existing?.storedAt ?? now,
    updatedAt: now,
  };
  await buyerProfileStorage.upsertDocument(SCOPE, COLLECTION, userId, record);
  return record;
}

export async function getBuyerProfile(
  userId: string
): Promise<StoredBuyerProfile | null> {
  if (!userId) throw new BuyerProfileError('A buyer profile needs an owner.');
  const record = await buyerProfileStorage.getDocument<StoredBuyerProfile>(
    SCOPE,
    COLLECTION,
    userId
  );
  if (!record || record.userId !== userId) return null;
  return record;
}
