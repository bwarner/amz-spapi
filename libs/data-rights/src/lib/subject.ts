import crypto from 'node:crypto';
import {
  deleteDocument,
  executeQuery,
  getDocument,
} from '@amz-spapi/couchbase-utils';
import { OWNERSHIP, type Ownership } from './manifest.js';

/**
 * Answering a data-subject request: what we hold about someone, and destroying
 * it.
 *
 * Both walk the same classification in `manifest.ts`, which is the point — an
 * export that covers different ground from the deletion is two bugs waiting to
 * disagree.
 */

/** An object in blob storage, as `media_assets.storage` records it. */
export type ObjectRef = { bucket: string; key: string };

/**
 * Blob deletion, injected.
 *
 * The library stays free of an AWS dependency, and — more usefully — a caller
 * cannot purge without having thought about the bytes. `media_assets` rows are
 * metadata; the images are S3 objects, and dropping the rows while leaving the
 * objects is the most plausible way to ship a deletion that reports success and
 * erases nothing.
 */
export interface ObjectStore {
  deleteObjects(
    refs: ObjectRef[]
  ): Promise<{ deleted: number; failed: ObjectRef[] }>;
}

/**
 * How far back to look for spend counters.
 *
 * They carry a 40-day TTL and no queryable field, so the only way to find them
 * is to reconstruct each day's key. 45 covers the TTL with room for clock skew
 * and a late purge; a missed day leaves a linkable record behind.
 */
const COUNTER_LOOKBACK_DAYS = 45;

/** Mirrors `cost-ledger.ts` and the `users/<hash>/` prefix in S3 keys. */
export function subjectHash(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

function counterKeys(userId: string, now = Date.now()): string[] {
  const hash = subjectHash(userId);
  return Array.from({ length: COUNTER_LOOKBACK_DAYS }, (_, i) => {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    return `spend::${hash}::${day}`;
  });
}

const DOMAIN = 'identity';

/**
 * The manifest already stores the flat, joined name (`a_plus_drafts`), so this
 * only has to quote it — `collectionName()` would re-join something already
 * joined.
 */
function keyspace(collection: string): string {
  return `\`${collection}\``;
}

// ── Seller ids ──────────────────────────────────────────────────────────────

export type SellerLink = {
  sellerId: string;
  /** Auth0 subjects that hold a credential for this seller account. */
  heldBy: string[];
  /** True when only the subject under request holds it. */
  exclusive: boolean;
};

/**
 * The Amazon seller accounts this person connected, and whether anyone else
 * connected the same one.
 *
 * The distinction is the whole reason this function exists. `reports_*` and
 * `sync_*` are keyed by Amazon seller id, not by our user id, and two of our
 * users can legitimately hold credentials for the same seller account —
 * an owner and the agency they hired. Deleting by seller id alone would
 * destroy the other party's data while answering the first party's request,
 * which turns one lawful erasure into one unlawful one.
 */
export async function resolveSellerIds(userId: string): Promise<SellerLink[]> {
  const { rows } = await executeQuery<{ sellerId: string; userId: string }>(
    'credentials',
    `SELECT p.seller_id AS sellerId, p.user_id AS userId
       FROM ${keyspace('credentials_profiles')} p
      WHERE p.seller_id IS NOT MISSING`
  );

  const holders = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.sellerId || !row.userId) continue;
    const set = holders.get(row.sellerId) ?? new Set<string>();
    set.add(row.userId);
    holders.set(row.sellerId, set);
  }

  return [...holders.entries()]
    .filter(([, heldBy]) => heldBy.has(userId))
    .map(([sellerId, heldBy]) => ({
      sellerId,
      heldBy: [...heldBy],
      exclusive: heldBy.size === 1,
    }));
}

// ── Export (GDPR Art. 15 / 20) ──────────────────────────────────────────────

export type SubjectExport = {
  subject: string;
  generatedAt: string;
  sellerAccounts: SellerLink[];
  /** Collection name → the documents held for this subject. */
  records: Record<string, unknown[]>;
  /** Blob objects belonging to the subject, by reference — bytes not inlined. */
  objects: ObjectRef[];
  /** Collections deliberately excluded, and why. */
  excluded: Array<{ collection: string; because: string }>;
};

/**
 * Fields never handed back, even to their owner.
 *
 * `encrypted_secrets` is the seller's Amazon refresh token under KMS. It is
 * "their" data in the sense that it concerns them, and putting it in a file
 * that travels by email is a credential disclosure with none of the protections
 * the live system gives it. Art. 15 does not require handing over material
 * whose release would compromise security, and this is the clearest such case
 * in the database.
 */
const REDACTED_FIELDS = new Set(['encrypted_secrets']);

function redact(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = REDACTED_FIELDS.has(key) ? '[redacted — credential]' : value;
  }
  return out;
}

async function selectBy(
  collection: string,
  field: string,
  values: string[]
): Promise<unknown[]> {
  if (values.length === 0) return [];
  const { rows } = await executeQuery<unknown>(
    collection.split('_')[0],
    `SELECT d.* FROM ${keyspace(collection)} d WHERE d.\`${field}\` IN $values`,
    { parameters: { values } }
  );
  return rows;
}

/** Everything held about a subject, in a machine-readable form (Art. 20). */
export async function exportUserData(params: {
  userId: string;
  now?: number;
}): Promise<SubjectExport> {
  const { userId } = params;
  const sellerAccounts = await resolveSellerIds(userId);
  const sellerIds = sellerAccounts.map((s) => s.sellerId);

  const records: Record<string, unknown[]> = {};
  const excluded: SubjectExport['excluded'] = [];
  const objects: ObjectRef[] = [];

  for (const { collection, ownership } of OWNERSHIP) {
    switch (ownership.kind) {
      case 'user-field': {
        const rows = await selectBy(collection, ownership.field, [userId]);
        if (rows.length) records[collection] = rows.map(redact);
        break;
      }
      case 'seller-field': {
        // The subject's own trading data, so ALL of it is exported even where
        // the seller account is shared. Exclusivity constrains deletion, not
        // access — withholding someone's own order history because a colleague
        // also has access to it would be the wrong way round.
        const rows = await selectBy(collection, ownership.field, sellerIds);
        if (rows.length) records[collection] = rows.map(redact);
        break;
      }
      case 'hashed-key': {
        const found: unknown[] = [];
        for (const key of counterKeys(userId, params.now)) {
          const doc = await getDocument<unknown>(
            'ops',
            'spend_counters',
            key
          ).catch(() => null);
          if (doc !== null && doc !== undefined)
            found.push({ key, value: doc });
        }
        if (found.length) records[collection] = found;
        break;
      }
      case 'not-personal':
        excluded.push({ collection, because: ownership.because });
        break;
    }
  }

  for (const row of records['media_assets'] ?? []) {
    const storage = (row as { storage?: ObjectRef & { provider?: string } })
      .storage;
    if (storage?.bucket && storage?.key) {
      objects.push({ bucket: storage.bucket, key: storage.key });
    }
  }

  return {
    subject: userId,
    generatedAt: new Date(params.now ?? Date.now()).toISOString(),
    sellerAccounts,
    records,
    objects,
    excluded,
  };
}

// ── Purge (GDPR Art. 17) ────────────────────────────────────────────────────

export type PurgePlan = {
  subject: string;
  dryRun: boolean;
  /** Collection → documents removed, or that would be. */
  deleted: Record<string, number>;
  objectsDeleted: number;
  objectsFailed: ObjectRef[];
  /**
   * Seller accounts left alone because somebody else also holds them, with the
   * collections that were therefore not swept. Reported rather than silently
   * skipped: whoever answers the request has to know it was partial.
   */
  retainedForSharedSellers: SellerLink[];
  skippedCollections: string[];
};

async function deleteBy(
  collection: string,
  field: string,
  values: string[]
): Promise<number> {
  if (values.length === 0) return 0;
  const { rows } = await executeQuery<{ removed: number }>(
    collection.split('_')[0],
    `DELETE FROM ${keyspace(collection)} d
      WHERE d.\`${field}\` IN $values
      RETURNING 1 AS removed`,
    { parameters: { values } }
  );
  return rows.length;
}

async function countBy(
  collection: string,
  field: string,
  values: string[]
): Promise<number> {
  if (values.length === 0) return 0;
  const { rows } = await executeQuery<number>(
    collection.split('_')[0],
    `SELECT RAW COUNT(*) FROM ${keyspace(collection)} d
      WHERE d.\`${field}\` IN $values`,
    { parameters: { values } }
  );
  return rows[0] ?? 0;
}

/**
 * Erase a subject (Art. 17).
 *
 * HARD delete. A `deletedAt` flag is not erasure — the data is still there and
 * still readable by anything that forgets the filter, which is precisely the
 * failure the right exists to prevent.
 *
 * `dryRun` defaults to TRUE. This function destroys data across twenty-odd
 * collections and an object store with no undo, and the safe default for
 * something with no undo is to describe itself.
 *
 * Ordering is load-bearing in two places. Seller ids are resolved BEFORE
 * `credentials_profiles` is swept, because that collection is what links a
 * subject to their seller accounts — delete it first and the report data
 * becomes unattributable and therefore undeletable. And object references are
 * read out of `media_assets` before those rows go, for the same reason.
 */
export async function purgeUserData(params: {
  userId: string;
  objectStore: ObjectStore;
  dryRun?: boolean;
  now?: number;
}): Promise<PurgePlan> {
  const { userId, objectStore } = params;
  const dryRun = params.dryRun ?? true;

  // 1. Resolve links BEFORE deleting anything that carries them.
  const sellerAccounts = await resolveSellerIds(userId);
  const purgeableSellerIds = sellerAccounts
    .filter((s) => s.exclusive)
    .map((s) => s.sellerId);
  const retainedForSharedSellers = sellerAccounts.filter((s) => !s.exclusive);

  // 2. Read object references out while the rows still exist.
  const assetRows = await selectBy('media_assets', 'userId', [userId]);
  const objects: ObjectRef[] = [];
  for (const row of assetRows) {
    const storage = (row as { storage?: ObjectRef }).storage;
    if (storage?.bucket && storage?.key) objects.push(storage);
  }

  const deleted: Record<string, number> = {};
  const skippedCollections: string[] = [];

  for (const { collection, ownership } of OWNERSHIP) {
    const plan = await purgeCollection({
      collection,
      ownership,
      userId,
      purgeableSellerIds,
      retainedForSharedSellers,
      dryRun,
      now: params.now,
    });
    if (plan.skipped) skippedCollections.push(collection);
    if (plan.count > 0) deleted[collection] = plan.count;
  }

  // 3. The bytes. Last, because a failure here must not leave rows pointing at
  //    objects that are gone — the reverse leaves objects nothing points at,
  //    which the prefix sweep can still find.
  let objectsDeleted = 0;
  let objectsFailed: ObjectRef[] = [];
  if (objects.length > 0) {
    if (dryRun) {
      objectsDeleted = objects.length;
    } else {
      const result = await objectStore.deleteObjects(objects);
      objectsDeleted = result.deleted;
      objectsFailed = result.failed;
    }
  }

  return {
    subject: userId,
    dryRun,
    deleted,
    objectsDeleted,
    objectsFailed,
    retainedForSharedSellers,
    skippedCollections,
  };
}

async function purgeCollection(params: {
  collection: string;
  ownership: Ownership;
  userId: string;
  purgeableSellerIds: string[];
  retainedForSharedSellers: SellerLink[];
  dryRun: boolean;
  now?: number;
}): Promise<{ count: number; skipped: boolean }> {
  const { collection, ownership, userId, dryRun } = params;

  switch (ownership.kind) {
    case 'user-field':
      return {
        count: dryRun
          ? await countBy(collection, ownership.field, [userId])
          : await deleteBy(collection, ownership.field, [userId]),
        skipped: false,
      };

    case 'seller-field': {
      const ids = params.purgeableSellerIds;
      const skipped =
        ids.length === 0 && params.retainedForSharedSellers.length > 0;
      return {
        count: dryRun
          ? await countBy(collection, ownership.field, ids)
          : await deleteBy(collection, ownership.field, ids),
        skipped,
      };
    }

    case 'hashed-key': {
      let count = 0;
      for (const key of counterKeys(userId, params.now)) {
        const doc = await getDocument<unknown>(
          'ops',
          'spend_counters',
          key
        ).catch(() => null);
        if (doc === null || doc === undefined) continue;
        count += 1;
        if (!dryRun) {
          await deleteDocument('ops', 'spend_counters', key).catch(() => {
            // Already gone, most likely expired between the read and the
            // delete. Counted either way: it is not there now.
          });
        }
      }
      return { count, skipped: false };
    }

    case 'not-personal':
      return { count: 0, skipped: false };
  }
}

/**
 * Revoke any invitation addressed to this person.
 *
 * Separate from the collection sweep because invitations are keyed by EMAIL and
 * a workspace, not by subject — see the manifest. An unrevoked invitation is a
 * live grant that would re-admit them the moment they signed up again, which
 * would be a strange outcome for someone who asked to be forgotten.
 */
export async function revokeInvitationsFor(params: {
  email: string;
  dryRun?: boolean;
}): Promise<number> {
  const email = params.email.toLowerCase().trim();
  if (!email) return 0;
  const dryRun = params.dryRun ?? true;

  if (dryRun) {
    const { rows } = await executeQuery<number>(
      DOMAIN,
      `SELECT RAW COUNT(*) FROM ${keyspace('identity_invitations')} i
        WHERE i.email = $email AND i.status = 'pending'`,
      { parameters: { email } }
    );
    return rows[0] ?? 0;
  }

  const { rows } = await executeQuery<{ removed: number }>(
    DOMAIN,
    `UPDATE ${keyspace('identity_invitations')} i
        SET i.status = 'revoked'
      WHERE i.email = $email AND i.status = 'pending'
      RETURNING 1 AS removed`,
    { parameters: { email } }
  );
  return rows.length;
}
