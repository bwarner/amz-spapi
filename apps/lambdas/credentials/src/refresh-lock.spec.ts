import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Single-flight token refresh (#55, step 4).
 *
 * The property under test is not "a lock exists" but the specific failure it
 * prevents: two concurrent exchanges racing to write, where the second write
 * can store a refresh token the first exchange already superseded. That leaves
 * a connection permanently broken, which is why a loser that cannot get the
 * lock FAILS rather than proceeding.
 */

const insertDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock('@amz-spapi/couchbase-utils', () => ({
  insertDocument: (...args: unknown[]) => insertDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

const { singleFlight, refreshLockKey } = await import('./refresh-lock.js');

const KEY = 'REFRESH::SP_API::auth0|abc::sp-1';

/** Fake time, so an 8-second budget does not take 8 seconds to test. */
let clock = 0;
const now = () => clock;
const sleep = async (ms: number) => {
  clock += ms;
};

beforeEach(() => {
  clock = 0;
  insertDocument.mockReset().mockResolvedValue(true);
  deleteDocument.mockReset().mockResolvedValue(true);
});

describe('the winner does the work once', () => {
  it('runs the critical section and releases the lock', async () => {
    const work = vi.fn().mockResolvedValue('token');

    const result = await singleFlight(KEY, {
      read: async () => null,
      work,
      now,
      sleep,
    });

    expect(result).toEqual({ ok: true, value: 'token', waited: false });
    expect(work).toHaveBeenCalledTimes(1);
    expect(deleteDocument).toHaveBeenCalledWith('credentials', 'locks', KEY);
  });

  it('takes the lock with an expiry', async () => {
    // Without a TTL a holder that crashes mid-exchange leaves the connection
    // un-refreshable until somebody deletes a document by hand.
    await singleFlight(KEY, {
      read: async () => null,
      work: async () => 'x',
      now,
      sleep,
    });

    const [, , , , expirySeconds] = insertDocument.mock.calls[0];
    expect(expirySeconds).toBeGreaterThan(0);
  });

  it('releases the lock even when the work throws', async () => {
    const boom = new Error('LWA said no');

    await expect(
      singleFlight(KEY, {
        read: async () => null,
        work: async () => {
          throw boom;
        },
        now,
        sleep,
      })
    ).rejects.toBe(boom);

    expect(deleteDocument).toHaveBeenCalledTimes(1);
  });

  it('does not fail the request when releasing fails', async () => {
    // The TTL already guarantees release. Turning a successful refresh into a
    // failure over a cleanup would be strictly worse.
    deleteDocument.mockRejectedValue(new Error('couchbase blip'));

    await expect(
      singleFlight(KEY, {
        read: async () => null,
        work: async () => 'token',
        now,
        sleep,
      })
    ).resolves.toMatchObject({ ok: true, value: 'token' });
  });
});

describe('double-checking under the lock', () => {
  it('skips the work when the previous holder already produced a value', async () => {
    // A lock does not help if the winner redoes the work the holder before it
    // just finished. This is the case where a loser waited, the holder expired
    // or released, and then this caller won.
    const work = vi.fn();

    const result = await singleFlight(KEY, {
      read: async () => 'already-fresh',
      work,
      now,
      sleep,
    });

    expect(result).toMatchObject({ ok: true, value: 'already-fresh' });
    expect(work).not.toHaveBeenCalled();
  });
});

describe('the loser waits rather than racing', () => {
  it('returns what the winner wrote, without doing its own work', async () => {
    insertDocument.mockResolvedValue(false); // somebody else holds it
    const work = vi.fn();
    let polls = 0;

    const result = await singleFlight(KEY, {
      read: async () => (++polls >= 2 ? 'winners-token' : null),
      work,
      now,
      sleep,
    });

    expect(result).toEqual({ ok: true, value: 'winners-token', waited: true });
    expect(work).not.toHaveBeenCalled();
  });

  it('gives up with a retryable 503 rather than exchanging anyway', async () => {
    // The whole point. Falling through here would reinstate the race and trade
    // a recoverable 503 for a permanently broken connection.
    insertDocument.mockResolvedValue(false);
    const work = vi.fn();

    const result = await singleFlight(KEY, {
      read: async () => null,
      work,
      now,
      sleep,
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { status: 503, error: 'RefreshInProgress' },
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('does not release a lock it never held', async () => {
    // Deleting another holder's lock would let a third caller in beside it.
    insertDocument.mockResolvedValue(false);

    await singleFlight(KEY, {
      read: async () => null,
      work: async () => 'x',
      now,
      sleep,
    });

    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('backs off instead of polling in a hot loop', async () => {
    insertDocument.mockResolvedValue(false);
    const delays: number[] = [];

    await singleFlight(KEY, {
      read: async () => null,
      work: async () => 'x',
      now,
      sleep: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
    });

    expect(delays[0]).toBeLessThan(delays[delays.length - 1]);
    // Bounded, so a long wait is not one enormous sleep past the deadline.
    expect(Math.max(...delays)).toBeLessThanOrEqual(1000);
  });

  it('takes over once the holder’s lock expires', async () => {
    // The TTL is what makes a crashed holder recoverable without intervention.
    let held = true;
    insertDocument.mockImplementation(async () => {
      if (held) {
        held = false; // the lock expired between attempts
        return false;
      }
      return true;
    });
    const work = vi.fn().mockResolvedValue('mine');

    const result = await singleFlight(KEY, {
      read: async () => null,
      work,
      now,
      sleep,
    });

    expect(result).toMatchObject({ ok: true, value: 'mine', waited: true });
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('the lock is scoped to one connection', () => {
  it('keys on user, api and profile together', () => {
    // Anything coarser would serialise refreshes with no reason to wait for
    // each other — a chat turn touching several connections would do them one
    // at a time.
    expect(refreshLockKey('auth0|abc', 'SP_API', 'sp-1')).toBe(
      'REFRESH::SP_API::auth0|abc::sp-1'
    );
    expect(refreshLockKey('auth0|abc', 'ADS_API', 'sp-1')).not.toBe(
      refreshLockKey('auth0|abc', 'SP_API', 'sp-1')
    );
    expect(refreshLockKey('auth0|other', 'SP_API', 'sp-1')).not.toBe(
      refreshLockKey('auth0|abc', 'SP_API', 'sp-1')
    );
  });

  it('writes locks to their own collection, not beside the profiles', async () => {
    await singleFlight(KEY, {
      read: async () => null,
      work: async () => 'x',
      now,
      sleep,
    });

    const [domain, collection] = insertDocument.mock.calls[0];
    expect(domain).toBe('credentials');
    expect(collection).toBe('locks');
  });
});
