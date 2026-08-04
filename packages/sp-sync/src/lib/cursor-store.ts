import { getDocument, upsertDocument } from '@amz-spapi/couchbase-utils';

/**
 * High-water marks per user × domain (#34).
 *
 * Every sync job answers the same question first: where did the last run stop?
 * The answer has to survive a crash, a redeploy and a duplicate delivery, which
 * is why it is a stored document rather than anything derived from the data
 * itself. Deriving it — "the newest row we hold" — is tempting and wrong: a
 * window that legitimately contained nothing is indistinguishable from one that
 * failed, so the gap is silently skipped forever.
 */

const SCOPE = 'sync';
const COLLECTION = 'cursors';

/** The domains that advance independently. */
export type SyncDomain =
  | 'finances'
  | 'settlements'
  | 'inbound-shipments'
  | 'inventory-snapshot';

export type SyncCursor = {
  userId: string;
  sellerId: string;
  domain: SyncDomain;
  /**
   * Everything up to this instant is synced. ISO-8601.
   *
   * Absent on a first run, which is what triggers the backfill rather than a
   * one-window increment.
   */
  syncedThrough?: string;
  /** When the last successful run finished, for observability rather than logic. */
  lastRunAt?: string;
  /** Set when the last attempt failed, cleared on success. */
  lastError?: string;
  /** Consecutive failures, so a permanently broken seller can be shed. */
  consecutiveFailures?: number;
};

/**
 * Identity is user + seller + domain.
 *
 * The seller id is in the key rather than only the body because one user may
 * hold several Amazon accounts, and their finances advance independently — a
 * cursor keyed on the user alone would let a fast-moving account drag a
 * quiet one past its own unsynced windows.
 */
export function cursorKey(
  userId: string,
  sellerId: string,
  domain: SyncDomain
): string {
  return `${userId}::${sellerId}::${domain}`;
}

export async function readCursor(
  userId: string,
  sellerId: string,
  domain: SyncDomain
): Promise<SyncCursor | null> {
  return getDocument<SyncCursor>(
    SCOPE,
    COLLECTION,
    cursorKey(userId, sellerId, domain)
  );
}

/**
 * Advance a cursor after a successful window.
 *
 * Only ever moves forward. A retry that re-runs an older window must not pull
 * the mark backwards, or the windows in between are re-fetched on the next run
 * — which for the Finances API means spending rate-limit budget re-reading
 * events already stored.
 */
export async function advanceCursor(params: {
  userId: string;
  sellerId: string;
  domain: SyncDomain;
  syncedThrough: string;
  now?: string;
}): Promise<SyncCursor> {
  const existing = await readCursor(
    params.userId,
    params.sellerId,
    params.domain
  );

  const furthest =
    existing?.syncedThrough &&
    new Date(existing.syncedThrough) > new Date(params.syncedThrough)
      ? existing.syncedThrough
      : params.syncedThrough;

  const cursor: SyncCursor = {
    userId: params.userId,
    sellerId: params.sellerId,
    domain: params.domain,
    syncedThrough: furthest,
    lastRunAt: params.now ?? new Date().toISOString(),
    // Cleared, not decremented: the seller is demonstrably working again.
    consecutiveFailures: 0,
  };

  await upsertDocument(
    SCOPE,
    COLLECTION,
    cursorKey(params.userId, params.sellerId, params.domain),
    cursor
  );
  return cursor;
}

/**
 * Record a failure WITHOUT moving the mark.
 *
 * The cursor stays where it was so the next run retries the same window. That
 * is the entire safety property: a failure that advanced the cursor would leave
 * a permanent hole, and nothing downstream can tell a hole from a quiet period.
 */
export async function recordFailure(params: {
  userId: string;
  sellerId: string;
  domain: SyncDomain;
  error: string;
  now?: string;
}): Promise<SyncCursor> {
  const existing = await readCursor(
    params.userId,
    params.sellerId,
    params.domain
  );

  const cursor: SyncCursor = {
    ...(existing ?? {
      userId: params.userId,
      sellerId: params.sellerId,
      domain: params.domain,
    }),
    lastRunAt: params.now ?? new Date().toISOString(),
    lastError: params.error,
    consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
  };

  await upsertDocument(
    SCOPE,
    COLLECTION,
    cursorKey(params.userId, params.sellerId, params.domain),
    cursor
  );
  return cursor;
}
