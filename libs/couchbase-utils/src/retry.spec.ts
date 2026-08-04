import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Transient 5xx retries.
 *
 * The failure these exist for, observed live rather than theorised: creating a
 * purchase order returned
 *
 *   Couchbase Data API 500: {"code":"Internal","debug":"",
 *   "message":"An unknown memcached error occurred (status: 56)."}
 *
 * Writes to one collection failed for about a minute — every key shape tried,
 * including a plain ASCII one — while reads on that same collection kept
 * answering normally. Sixty sequential writes a minute later all succeeded.
 * Nothing about the request was wrong; the Data API could not reach the KV
 * engine, and said so with a 500.
 *
 * Without a retry a single blip inside a multi-write operation fails the whole
 * operation in front of the user, which is what happened.
 */

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), { status: 200 });
const memcached56 = () =>
  new Response(
    JSON.stringify({
      code: 'Internal',
      message: 'An unknown memcached error occurred (status: 56).',
    }),
    { status: 500 }
  );

let utils: typeof import('./couchbase-utils.js');

beforeEach(async () => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  process.env['CB_DATA_API_URL'] = 'https://example.cloud.couchbase.com';
  process.env['CB_BUCKET'] = 'test-bucket';
  process.env['CB_SCOPE'] = 'dev';
  process.env['CB_USERNAME'] = 'u';
  process.env['CB_PASSWORD'] = 'p';
  utils = await import('./couchbase-utils.js');
});

afterEach(() => {
  vi.useRealTimers();
});

/** Run a call to completion while advancing the retry backoff timers. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await vi.runAllTimersAsync();
  const outcome = (await result) as { value?: T; error?: unknown };
  if ('error' in outcome && outcome.error !== undefined) throw outcome.error;
  return outcome.value as T;
}

describe('a transient 500 is retried', () => {
  it('recovers an upsert that blipped once', async () => {
    // The exact shape of the reported failure: the write is fine, the cluster
    // was not, and the very next attempt succeeds.
    fetchMock.mockResolvedValueOnce(memcached56()).mockResolvedValueOnce(ok());

    await settle(utils.upsertDocument('purchases', 'vendor-records', 'v1', {}));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers a read', async () => {
    fetchMock
      .mockResolvedValueOnce(memcached56())
      .mockResolvedValueOnce(ok({ name: 'Panama Select' }));

    const doc = await settle(
      utils.getDocument<{ name: string }>('purchases', 'vendor-records', 'v1')
    );

    expect(doc).toEqual({ name: 'Panama Select' });
  });

  it('gives up after three attempts and reports the real error', async () => {
    // Bounded. A cluster that is genuinely down must surface, not hang.
    fetchMock.mockResolvedValue(memcached56());

    await expect(
      settle(utils.upsertDocument('purchases', 'vendor-records', 'v1', {}))
    ).rejects.toThrow(/memcached error occurred \(status: 56\)/);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('a verdict is not retried', () => {
  it('does not retry a 404', async () => {
    // 404 is an answer. Retrying it would triple the cost of every cache miss,
    // and cache misses are the common case.
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));

    await settle(utils.getDocument('purchases', 'vendor-records', 'missing'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 403', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));

    await expect(
      settle(utils.upsertDocument('purchases', 'vendor-records', 'v1', {}))
    ).rejects.toThrow(/403/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('operations that cannot be repeated safely', () => {
  it('never retries a counter increment', async () => {
    // A retry of an increment the first attempt actually applied counts twice.
    // For the PO counter that burns a number; for the spend counter it charges
    // the user for a call they did not make.
    fetchMock.mockResolvedValue(memcached56());

    await expect(
      settle(utils.incrementCounter('purchases', 'purchase-orders', 'c', 1))
    ).rejects.toThrow(/500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries an insert', async () => {
    // Insert is create-only. A repeat of one that landed answers 409, which
    // reads as "someone else got there first" — a misleading error in place of
    // a true one.
    fetchMock.mockResolvedValue(memcached56());

    await expect(
      settle(utils.insertDocument('purchases', 'vendor-records', 'v1', {}))
    ).rejects.toThrow(/500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('queries', () => {
  it('retries a SELECT', async () => {
    fetchMock
      .mockResolvedValueOnce(memcached56())
      .mockResolvedValueOnce(ok({ status: 'success', results: [] }));

    await settle(
      utils.executeQuery('purchases', 'SELECT * FROM `vendor-records`')
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a mutating statement', async () => {
    // `executeQuery` takes arbitrary N1QL. Repeating an UPDATE that already
    // applied is a second mutation, not a retry.
    fetchMock.mockResolvedValue(memcached56());

    await expect(
      settle(
        utils.executeQuery(
          'purchases',
          'UPDATE `vendor-records` SET active = true'
        )
      )
    ).rejects.toThrow(/500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
