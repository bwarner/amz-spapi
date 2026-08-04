/**
 * Splitting a sync range into windows Amazon will actually accept (#34).
 *
 * Why this is its own file with its own tests: the retention limits are the
 * reason the sync exists at all. Amazon's windows are rolling, so history not
 * captured inside them is not "late", it is gone — and an off-by-one here does
 * not fail, it silently drops a day that can never be re-fetched.
 */

/**
 * Finances refuses a range wider than 180 days, and holds roughly that much
 * history. A first run therefore has to walk backwards in chunks rather than
 * ask for everything.
 */
export const FINANCES_MAX_WINDOW_DAYS = 180;

/** Chunk size for a backfill. Under the limit, so a boundary cannot exceed it. */
export const BACKFILL_WINDOW_DAYS = 30;

export type SyncWindow = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The windows a run should fetch, oldest first.
 *
 * Oldest first so an interrupted backfill leaves a contiguous synced prefix
 * rather than islands. Islands are the worse failure: the cursor can only
 * record one boundary, so a gap behind it is invisible and never retried.
 *
 * Windows are half-open — `to` of one equals `from` of the next. Amazon treats
 * both bounds as inclusive, so overlapping them duplicates the boundary
 * instant's events; the ingest deduplicates, but paying rate-limit budget to
 * re-fetch is avoidable.
 */
export function windowsToSync(params: {
  /** Cursor value. Absent means first run: backfill from `maxLookbackDays`. */
  syncedThrough?: string;
  /** Now, injected so the caller controls the clock rather than the module. */
  now: Date;
  maxLookbackDays?: number;
  windowDays?: number;
}): SyncWindow[] {
  const windowDays = params.windowDays ?? BACKFILL_WINDOW_DAYS;
  const maxLookback = params.maxLookbackDays ?? FINANCES_MAX_WINDOW_DAYS;
  const end = params.now.getTime();

  const earliestPermitted = end - maxLookback * DAY_MS;
  const requested = params.syncedThrough
    ? new Date(params.syncedThrough).getTime()
    : earliestPermitted;

  // A cursor older than the retention limit asks for data Amazon no longer has.
  // Clamping keeps the request valid; the history between the two is already
  // unrecoverable and pretending otherwise just fails the call.
  let cursor = Math.max(requested, earliestPermitted);

  // Nothing to do, rather than a zero-width window Amazon rejects.
  if (cursor >= end) return [];

  const windows: SyncWindow[] = [];
  while (cursor < end) {
    const next = Math.min(cursor + windowDays * DAY_MS, end);
    windows.push({
      from: new Date(cursor).toISOString(),
      to: new Date(next).toISOString(),
    });
    cursor = next;
  }
  return windows;
}

/**
 * Whether a cursor has fallen behind what Amazon still retains.
 *
 * Worth surfacing rather than silently clamping: it means history was lost, and
 * the only honest thing is to say so. A seller looking at a gap deserves to
 * know it is permanent rather than assume the next run will fill it.
 */
export function hasLostHistory(params: {
  syncedThrough?: string;
  now: Date;
  maxLookbackDays?: number;
}): boolean {
  if (!params.syncedThrough) return false;
  const maxLookback = params.maxLookbackDays ?? FINANCES_MAX_WINDOW_DAYS;
  const earliestPermitted = params.now.getTime() - maxLookback * DAY_MS;
  return new Date(params.syncedThrough).getTime() < earliestPermitted;
}
