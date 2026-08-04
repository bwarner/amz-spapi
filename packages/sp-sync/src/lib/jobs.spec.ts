/**
 * Job unit behaviour (#34).
 *
 * The cursor is the only record of what has been synced, so every test here is
 * really about one question: can a crash, a retry or a duplicate delivery leave
 * the cursor claiming data that was never stored? A gap behind the cursor is
 * invisible — nothing downstream can tell it from a period with no activity —
 * and for finances the window it names is gone within 180 days.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const documents = new Map<string, unknown>();
const upsertDocument = vi.fn(
  async (scope: string, collection: string, key: string, value: unknown) => {
    documents.set(`${scope}/${collection}/${key}`, value);
  }
);
const getDocument = vi.fn(
  async (scope: string, collection: string, key: string) =>
    documents.get(`${scope}/${collection}/${key}`) ?? null
);

vi.mock('@amz-spapi/couchbase-utils', () => ({
  upsertDocument: (
    scope: string,
    collection: string,
    key: string,
    value: unknown
  ) => upsertDocument(scope, collection, key, value),
  getDocument: (scope: string, collection: string, key: string) =>
    getDocument(scope, collection, key),
}));

const { syncFinancialEvents, snapshotInventory } = await import('./jobs.js');
const { readCursor } = await import('./cursor-store.js');

const NOW = new Date('2026-08-03T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function contextWith(client: Record<string, unknown>, overrides = {}) {
  return {
    userId: 'auth0|1',
    sellerId: 'A2HXBWIE3KMLKV',
    marketplaceId: 'ATVPDKIKX0DER',
    client: client as never,
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  documents.clear();
  upsertDocument.mockClear();
  getDocument.mockClear();
});

describe('the cursor after a failure', () => {
  it('does not advance, so the same window is retried', async () => {
    // The entire safety property. Advancing past a failure leaves a hole that
    // nothing can detect afterwards.
    const listFinancialEvents = vi
      .fn()
      .mockRejectedValue(new Error('SP-API 503'));

    await expect(
      syncFinancialEvents(contextWith({ listFinancialEvents }))
    ).rejects.toThrow('503');

    const cursor = await readCursor('auth0|1', 'A2HXBWIE3KMLKV', 'finances');
    expect(cursor?.syncedThrough).toBeUndefined();
    expect(cursor?.lastError).toContain('503');
    expect(cursor?.consecutiveFailures).toBe(1);
  });

  it('keeps a cursor earned by earlier windows when a later one fails', async () => {
    // Partial progress must survive. Rolling back to the start would re-fetch
    // windows already stored, spending rate-limit budget for nothing.
    let call = 0;
    const listFinancialEvents = vi.fn(async () => {
      call += 1;
      if (call === 1) return { payload: { FinancialEvents: {} } };
      throw new Error('rate limited');
    });

    await expect(
      syncFinancialEvents(contextWith({ listFinancialEvents }))
    ).rejects.toThrow('rate limited');

    const cursor = await readCursor('auth0|1', 'A2HXBWIE3KMLKV', 'finances');
    expect(cursor?.syncedThrough).toBeDefined();
  });
});

describe('the cursor on success', () => {
  it('advances per window rather than once at the end', async () => {
    // Per-window means an interruption costs one window, not all of them.
    const listFinancialEvents = vi
      .fn()
      .mockResolvedValue({ payload: { FinancialEvents: {} } });

    const result = await syncFinancialEvents(
      contextWith({ listFinancialEvents }, { maxWindows: 2 })
    );

    expect(result.windowsProcessed).toBe(2);
    const cursor = await readCursor('auth0|1', 'A2HXBWIE3KMLKV', 'finances');
    expect(cursor?.syncedThrough).toBe(result.syncedThrough);
  });

  it('never moves the cursor backwards on a replayed message', async () => {
    // SQS delivers at least once. A redelivered older window must not undo
    // progress, or every window between is re-fetched on the next run.
    const listFinancialEvents = vi
      .fn()
      .mockResolvedValue({ payload: { FinancialEvents: {} } });
    const ctx = contextWith({ listFinancialEvents }, { maxWindows: 2 });

    const first = await syncFinancialEvents(ctx);
    // Replay the same invocation: the cursor is already ahead of these windows.
    await syncFinancialEvents(ctx);

    const cursor = await readCursor('auth0|1', 'A2HXBWIE3KMLKV', 'finances');
    expect(new Date(cursor!.syncedThrough!).getTime()).toBeGreaterThanOrEqual(
      new Date(first.syncedThrough!).getTime()
    );
  });

  it('clears the failure count once the seller works again', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      syncFinancialEvents(contextWith({ listFinancialEvents: failing }))
    ).rejects.toThrow();

    const ok = vi.fn().mockResolvedValue({ payload: { FinancialEvents: {} } });
    await syncFinancialEvents(
      contextWith({ listFinancialEvents: ok }, { maxWindows: 1 })
    );

    const cursor = await readCursor('auth0|1', 'A2HXBWIE3KMLKV', 'finances');
    expect(cursor?.consecutiveFailures).toBe(0);
  });
});

describe('work remaining', () => {
  it('reports `more` so the caller re-enqueues instead of blocking', async () => {
    // A first run has ~6 windows of backfill and processes 3. Draining them in
    // one invocation would hold a worker for minutes against a rate-limited API.
    const listFinancialEvents = vi
      .fn()
      .mockResolvedValue({ payload: { FinancialEvents: {} } });

    const result = await syncFinancialEvents(
      contextWith({ listFinancialEvents }, { maxWindows: 1 })
    );

    expect(result.more).toBe(true);
  });

  it('reports no more work once caught up', async () => {
    documents.set('sync/cursors/auth0|1::A2HXBWIE3KMLKV::finances', {
      userId: 'auth0|1',
      sellerId: 'A2HXBWIE3KMLKV',
      domain: 'finances',
      syncedThrough: new Date(NOW.getTime() - DAY_MS).toISOString(),
    });
    const listFinancialEvents = vi
      .fn()
      .mockResolvedValue({ payload: { FinancialEvents: {} } });

    const result = await syncFinancialEvents(
      contextWith({ listFinancialEvents })
    );

    expect(result.more).toBe(false);
  });
});

describe('inventory snapshot', () => {
  it('reads the unwrapped payload, not an envelope', async () => {
    // getInventorySummaries returns `response.data.payload || response.data` —
    // already unwrapped, unlike every other method used here. Reading `.payload`
    // off it yields undefined and stores an EMPTY snapshot: a day where every
    // SKU reads as zero stock, indistinguishable from a real stock-out, and
    // uncorrectable because Amazon keeps no history to re-derive it from.
    const getInventorySummaries = vi.fn().mockResolvedValue({
      inventorySummaries: [{ sellerSku: 'SKU-1', totalQuantity: 42 }],
    });

    const result = await snapshotInventory(
      contextWith({ getInventorySummaries })
    );

    expect(result.recordsWritten).toBe(1);
  });

  it('follows pagination, because a partial snapshot reads as missing stock', async () => {
    let call = 0;
    const getInventorySummaries = vi.fn(async () => {
      call += 1;
      return call === 1
        ? {
            inventorySummaries: [{ sellerSku: 'A' }],
            pagination: { nextToken: 'p2' },
          }
        : { inventorySummaries: [{ sellerSku: 'B' }] };
    });

    const result = await snapshotInventory(
      contextWith({ getInventorySummaries })
    );

    expect(getInventorySummaries).toHaveBeenCalledTimes(2);
    expect(result.recordsWritten).toBe(2);
  });

  it('keys by day, so a second run corrects rather than duplicates', async () => {
    // Two snapshots for one day would double every level in a series built
    // from them.
    const getInventorySummaries = vi
      .fn()
      .mockResolvedValue({ inventorySummaries: [{ sellerSku: 'A' }] });
    const ctx = contextWith({ getInventorySummaries });

    await snapshotInventory(ctx);
    await snapshotInventory(ctx);

    const keys = [...documents.keys()].filter((k) =>
      k.includes('inventory_snapshots')
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('2026-08-03');
  });

  it('records the failure without claiming the day was captured', async () => {
    const getInventorySummaries = vi
      .fn()
      .mockRejectedValue(new Error('throttled'));

    await expect(
      snapshotInventory(contextWith({ getInventorySummaries }))
    ).rejects.toThrow('throttled');

    const cursor = await readCursor(
      'auth0|1',
      'A2HXBWIE3KMLKV',
      'inventory-snapshot'
    );
    expect(cursor?.syncedThrough).toBeUndefined();
    expect(cursor?.lastError).toContain('throttled');
  });
});
