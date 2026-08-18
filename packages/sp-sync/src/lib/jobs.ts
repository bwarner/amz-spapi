import type { SpApiClient } from '@farvisionllc/sp-client';
import { upsertDocument } from '@amz-spapi/couchbase-utils';
import { retentionSeconds } from '@amz-spapi/data-rights';
import {
  advanceCursor,
  readCursor,
  recordFailure,
  type SyncDomain,
} from './cursor-store.js';
import { hasLostHistory, windowsToSync, type SyncWindow } from './windows.js';

/**
 * Sync job units (#34).
 *
 * Framework-free on purpose: `async (context) => result`, with no knowledge of
 * how it was invoked. That is what lets the same unit run under a Lambda
 * consuming SQS (#36, ADR-0009), under a test, or under a script, without a
 * second implementation drifting away from the first.
 *
 * Nothing here reaches for a clock, an environment variable or a queue. The
 * caller supplies `now`, which is also what makes the windowing testable.
 */

const SCOPE = 'sync';

export type SyncJobContext = {
  userId: string;
  sellerId: string;
  marketplaceId: string;
  client: SpApiClient;
  /** Injected so tests and replays control it. */
  now: Date;
  /** Cap on windows per invocation, so one very stale seller cannot monopolise a worker. */
  maxWindows?: number;
};

export type SyncJobResult = {
  domain: SyncDomain;
  windowsProcessed: number;
  recordsWritten: number;
  /** True when windows remain — the caller should re-enqueue rather than wait. */
  more: boolean;
  syncedThrough?: string;
  /** Set when the cursor had fallen outside Amazon's retention. */
  historyLost?: boolean;
};

/** Default per invocation. Small: SP-API rate limits bite long before Lambda time does. */
const DEFAULT_MAX_WINDOWS = 3;

/**
 * The shared spine every domain follows.
 *
 * Extracted because the ordering is the part that must not vary: fetch a
 * window, WRITE IT, then advance the cursor. Advancing first — or advancing
 * across several windows at the end — means a crash in between reports data as
 * synced that was never stored, and the gap is undetectable afterwards.
 */
async function runWindowed(params: {
  context: SyncJobContext;
  domain: SyncDomain;
  maxLookbackDays?: number;
  windowDays?: number;
  fetchAndStore: (window: SyncWindow) => Promise<number>;
}): Promise<SyncJobResult> {
  const { context, domain } = params;
  const cursor = await readCursor(context.userId, context.sellerId, domain);

  const historyLost = hasLostHistory({
    syncedThrough: cursor?.syncedThrough,
    now: context.now,
    maxLookbackDays: params.maxLookbackDays,
  });

  const all = windowsToSync({
    syncedThrough: cursor?.syncedThrough,
    now: context.now,
    maxLookbackDays: params.maxLookbackDays,
    windowDays: params.windowDays,
  });
  const limit = context.maxWindows ?? DEFAULT_MAX_WINDOWS;
  const windows = all.slice(0, limit);

  let recordsWritten = 0;
  let processed = 0;

  for (const window of windows) {
    try {
      recordsWritten += await params.fetchAndStore(window);
    } catch (error) {
      // The cursor is deliberately NOT advanced. The next run retries this same
      // window; advancing past a failure leaves a hole nothing can distinguish
      // from a period with no activity.
      await recordFailure({
        userId: context.userId,
        sellerId: context.sellerId,
        domain,
        error: error instanceof Error ? error.message : String(error),
        now: context.now.toISOString(),
      });
      throw error;
    }

    // Per window, not once at the end: an interruption then costs one window
    // rather than every window this invocation had processed.
    await advanceCursor({
      userId: context.userId,
      sellerId: context.sellerId,
      domain,
      syncedThrough: window.to,
      now: context.now.toISOString(),
    });
    processed += 1;
  }

  return {
    domain,
    windowsProcessed: processed,
    recordsWritten,
    more: all.length > windows.length,
    syncedThrough: windows[windows.length - 1]?.to ?? cursor?.syncedThrough,
    ...(historyLost ? { historyLost: true } : {}),
  };
}

/**
 * Financial events — the fee and settlement detail behind every payout.
 *
 * Amazon holds roughly 180 days and the API refuses a wider range, so unsynced
 * history is unrecoverable rather than late. That is the whole reason this runs
 * on a schedule instead of on demand.
 */
export async function syncFinancialEvents(
  context: SyncJobContext
): Promise<SyncJobResult> {
  return runWindowed({
    context,
    domain: 'finances',
    fetchAndStore: async (window) => {
      let nextToken: string | undefined;
      let written = 0;

      do {
        const page = await context.client.listFinancialEvents({
          postedAfter: window.from,
          postedBefore: window.to,
          nextToken,
        });
        const events = page?.payload?.FinancialEvents ?? {};

        // Keyed by window rather than by event: the API returns events grouped
        // by type with no per-event id, so there is nothing stable to key on.
        // The window is stable, which makes a re-run overwrite rather than
        // duplicate.
        await upsertDocument(
          SCOPE,
          'finance_events',
          `${context.sellerId}::${window.from}::${written}`,
          {
            sellerId: context.sellerId,
            userId: context.userId,
            windowFrom: window.from,
            windowTo: window.to,
            events,
            fetchedAt: context.now.toISOString(),
          },
          // Amazon Information — the 18-month Data Protection Policy ceiling.
          retentionSeconds()
        );
        written += 1;
        nextToken = page?.payload?.NextToken;
      } while (nextToken);

      return written;
    },
  });
}

/**
 * Settlement groups — the payouts themselves, as opposed to their line items.
 */
export async function syncSettlementGroups(
  context: SyncJobContext
): Promise<SyncJobResult> {
  return runWindowed({
    context,
    domain: 'settlements',
    fetchAndStore: async (window) => {
      let nextToken: string | undefined;
      let count = 0;

      do {
        const page = await context.client.listFinancialEventGroups({
          startedAfter: window.from,
          startedBefore: window.to,
          nextToken,
        });
        const groups = page?.payload?.FinancialEventGroupList ?? [];
        nextToken = page?.payload?.NextToken;
        count += groups.length;

        for (const group of groups) {
          const id = (group as { FinancialEventGroupId?: string })
            .FinancialEventGroupId;
          if (!id) continue;
          // Amazon's own id, so a re-run of an overlapping window overwrites the
          // same document instead of creating a second copy of one payout.
          await upsertDocument(
            SCOPE,
            'settlement_groups',
            `${context.sellerId}::${id}`,
            {
              sellerId: context.sellerId,
              userId: context.userId,
              group,
              fetchedAt: context.now.toISOString(),
            },
            // Amazon Information — the 18-month Data Protection Policy ceiling.
            retentionSeconds()
          );
        }
      } while (nextToken);

      return count;
    },
  });
}

/**
 * Inbound shipments — stock in transit to Amazon.
 *
 * Forgiving compared with finances: Amazon retains these far longer. Synced
 * anyway because reconciliation joins on them, and a shipment that only appears
 * once it has arrived cannot explain a discrepancy while it was in transit.
 */
export async function syncInboundShipments(
  context: SyncJobContext
): Promise<SyncJobResult> {
  return runWindowed({
    context,
    domain: 'inbound-shipments',
    // Wider windows: the endpoint is not rate-limited as tightly as finances
    // and the data is far less dense.
    windowDays: 90,
    maxLookbackDays: 365,
    fetchAndStore: async (window) => {
      let nextToken: string | undefined;
      let count = 0;

      do {
        const page = await context.client.getInboundShipments({
          lastUpdatedAfter: window.from,
          lastUpdatedBefore: window.to,
          nextToken,
        });
        const payload = page?.payload as {
          ShipmentData?: unknown[];
          NextToken?: string;
        };
        const shipments = payload?.ShipmentData ?? [];
        nextToken = payload?.NextToken;
        count += shipments.length;

        for (const shipment of shipments) {
          const id = (shipment as { ShipmentId?: string }).ShipmentId;
          if (!id) continue;
          await upsertDocument(
            SCOPE,
            'inbound_shipments',
            `${context.sellerId}::${id}`,
            {
              sellerId: context.sellerId,
              userId: context.userId,
              shipment,
              fetchedAt: context.now.toISOString(),
            },
            // Amazon Information — the 18-month Data Protection Policy ceiling.
            retentionSeconds()
          );
        }
      } while (nextToken);

      return count;
    },
  });
}

/**
 * Inventory levels, snapshotted.
 *
 * `getInventorySummaries` is a point-in-time reading with NO history — Amazon
 * keeps none. Levels-over-time exist only if we record them, which makes this
 * the one job where a missed run is unrecoverable in a way no backfill can fix.
 * There is nothing to page through and no window to walk: today either has a
 * snapshot or it does not.
 */
export async function snapshotInventory(
  context: SyncJobContext
): Promise<SyncJobResult> {
  const domain: SyncDomain = 'inventory-snapshot';
  const day = context.now.toISOString().slice(0, 10);

  try {
    // `getInventorySummaries` returns `response.data.payload || response.data`
    // — already unwrapped, unlike every other method here, which return the
    // envelope. Reading `.payload` off it yields undefined and records an EMPTY
    // snapshot: a day where every SKU reads as zero stock, indistinguishable
    // from a genuine stock-out and impossible to correct later, since Amazon
    // keeps no history to re-derive it from.
    const rows: unknown[] = [];
    let nextToken: string | undefined;

    do {
      const page = await context.client.getInventorySummaries({
        // Marketplace granularity: totals per SKU for this marketplace. The
        // alternative is per-FC, which is a different question and many times
        // the rows.
        granularityType: 'Marketplace',
        granularityId: context.marketplaceId,
        marketplaceIds: [context.marketplaceId],
        nextToken,
      });
      rows.push(...((page?.inventorySummaries as unknown[]) ?? []));
      nextToken = page?.pagination?.nextToken;
    } while (nextToken);

    // Keyed by day, so a second run on the same day corrects that day rather
    // than recording it twice — which would double every level in a series.
    await upsertDocument(
      SCOPE,
      'inventory_snapshots',
      `${context.sellerId}::${day}`,
      {
        sellerId: context.sellerId,
        userId: context.userId,
        day,
        summaries: rows,
        capturedAt: context.now.toISOString(),
      },
      // Amazon Information — the 18-month Data Protection Policy ceiling.
      retentionSeconds()
    );

    await advanceCursor({
      userId: context.userId,
      sellerId: context.sellerId,
      domain,
      syncedThrough: context.now.toISOString(),
      now: context.now.toISOString(),
    });

    return {
      domain,
      windowsProcessed: 1,
      recordsWritten: rows.length,
      more: false,
      syncedThrough: context.now.toISOString(),
    };
  } catch (error) {
    await recordFailure({
      userId: context.userId,
      sellerId: context.sellerId,
      domain,
      error: error instanceof Error ? error.message : String(error),
      now: context.now.toISOString(),
    });
    throw error;
  }
}

/** Every job unit, by the domain a queue message names. */
export const SYNC_JOBS: Record<
  SyncDomain,
  (context: SyncJobContext) => Promise<SyncJobResult>
> = {
  finances: syncFinancialEvents,
  settlements: syncSettlementGroups,
  'inbound-shipments': syncInboundShipments,
  'inventory-snapshot': snapshotInventory,
};
