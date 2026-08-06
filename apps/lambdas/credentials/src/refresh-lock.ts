import { deleteDocument, insertDocument } from '@amz-spapi/couchbase-utils';
import { CREDENTIALS_DOMAIN, type AmazonApiType } from '@farvisionllc/models';
import type { ServiceFailure } from './lwa.js';

/**
 * One refresh at a time per connection (#55, step 4).
 *
 * The race, as the issue states it: two concurrent requests both find the
 * access token expired, both exchange, and Amazon may invalidate the loser.
 *
 * ## Why this is worth a lock rather than a shrug
 *
 * A duplicated *access* token would be harmless — the loser's copy simply is
 * not the one stored, and a 401 sends the caller back for another. The danger
 * is the REFRESH token. Amazon may rotate it on exchange, and when it does the
 * previous one stops working. Two concurrent exchanges then race to write, and
 * the write that lands second can store a refresh token that the other exchange
 * already superseded. The connection is then permanently broken and the seller
 * has to reconnect — a failure no retry recovers, produced by ordinary
 * concurrency.
 *
 * That asymmetry is also why a loser that cannot get the lock **waits and then
 * fails**, rather than going ahead on its own. Falling through would reinstate
 * exactly the race this exists to close, and trade a recoverable 503 for an
 * unrecoverable broken connection.
 *
 * ## The primitive
 *
 * `insertDocument` is a create-only `POST`: it answers 409 for the second
 * writer instead of overwriting (#44). That is a compare-and-set, which is all
 * a mutex needs — and it needs no new infrastructure, no Redis, and no
 * coordination service for what is a sub-second critical section.
 *
 * The lock document carries an expiry, and that is the property that keeps this
 * from being a liability. A holder that crashes, times out, or is killed
 * mid-exchange never releases; without a TTL that connection would be
 * un-refreshable until somebody noticed and deleted a document by hand.
 */

const LOCK_COLLECTION = 'locks';

/**
 * How long a lock survives unreleased.
 *
 * Matched to the function's own timeout: the longest a holder can possibly
 * hold this is until Lambda kills it, so anything longer leaves a dead lock
 * standing and anything shorter can expire under a holder that is still
 * working — which would let a second exchange start, the thing being prevented.
 */
const LOCK_TTL_SECONDS = 30;

/**
 * How long a loser waits before giving up.
 *
 * Deliberately much shorter than the TTL. A normal exchange is well under a
 * second, so eight is already generous slack; past that the holder is stuck on
 * an LWA call that will itself time out, and making a user's request wait for
 * that is worse than telling them to retry. The caller gets a 503 and the next
 * attempt finds either a fresh token or an expired lock.
 */
const WAIT_BUDGET_MS = 8_000;

/** First poll delay. Backs off to `MAX_POLL_MS` so a long wait is not a hot loop. */
const FIRST_POLL_MS = 100;
const MAX_POLL_MS = 1_000;

/**
 * The lock for one connection.
 *
 * Scoped to exactly what is being refreshed. A coarser lock — per user, per API
 * — would serialise refreshes that have no reason to wait for each other, and a
 * chat turn touching several connections would then do them one at a time.
 */
export function refreshLockKey(
  userId: string,
  apiType: AmazonApiType,
  profileName: string
): string {
  return `REFRESH::${apiType}::${userId}::${profileName}`;
}

export type SingleFlightResult<T> =
  | { ok: true; value: T; waited: boolean }
  | { ok: false; failure: ServiceFailure };

export type SingleFlightOptions<T> = {
  /**
   * Re-read shared state and return a usable value if another caller has
   * already produced one. Must be cheap: it runs on every poll.
   */
  read: () => Promise<T | null>;
  /** The critical section. Runs only under the lock. */
  work: () => Promise<T>;
  /** Injected in tests; `setTimeout` otherwise. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests. */
  now?: () => number;
};

/**
 * Run `work` once across all concurrent callers for this key.
 *
 * Double-checked: after taking the lock it calls `read` again before doing
 * anything. Between deciding a refresh was needed and winning the lock, the
 * previous holder may have finished and written exactly what this caller wants
 * — and a lock does not help if the winner then redoes the work anyway.
 */
export async function singleFlight<T>(
  key: string,
  options: SingleFlightOptions<T>
): Promise<SingleFlightResult<T>> {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const deadline = now() + WAIT_BUDGET_MS;
  let waited = false;
  let delay = FIRST_POLL_MS;

  for (;;) {
    if (await acquire(key)) {
      try {
        // Double-check. The holder before us may have written what we need.
        const existing = await options.read();
        if (existing !== null) return { ok: true, value: existing, waited };

        return { ok: true, value: await options.work(), waited };
      } finally {
        // Best effort. A failed release is not an error the caller can act on
        // and must not mask the result — the TTL is what guarantees the lock
        // goes away, and this only makes it go away sooner.
        await release(key);
      }
    }

    // Somebody else is refreshing this connection.
    waited = true;
    if (now() >= deadline) {
      return {
        ok: false,
        failure: {
          // Retryable and honest about it. Not 500: nothing is broken, and not
          // 409: the caller did nothing wrong.
          status: 503,
          error: 'RefreshInProgress',
          detail:
            'Another request is already refreshing this connection and did ' +
            'not finish in time. Retry.',
        },
      };
    }

    await sleep(delay);
    delay = Math.min(delay * 2, MAX_POLL_MS);

    const fresh = await options.read();
    if (fresh !== null) return { ok: true, value: fresh, waited: true };
  }
}

async function acquire(key: string): Promise<boolean> {
  return insertDocument(
    CREDENTIALS_DOMAIN,
    LOCK_COLLECTION,
    key,
    // Contents are for a human reading the collection during an incident. The
    // lock is the document's EXISTENCE; nothing reads these fields, and
    // nothing may — a lock whose correctness depends on its contents is a lock
    // with a read-modify-write inside it.
    { acquiredAt: new Date().toISOString(), holder: 'credentials' },
    LOCK_TTL_SECONDS
  );
}

async function release(key: string): Promise<void> {
  try {
    await deleteDocument(CREDENTIALS_DOMAIN, LOCK_COLLECTION, key);
  } catch {
    // Swallowed on purpose, and this is the one place in this function where
    // that is right: the TTL already guarantees release. Rethrowing would turn
    // a successful refresh into a failed request over a cleanup that does not
    // affect the answer.
  }
}
