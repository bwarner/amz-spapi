/**
 * Window arithmetic (#34).
 *
 * These bounds are the reason the sync exists. Amazon's retention is rolling,
 * so a day not captured inside it is not late — it is gone. An off-by-one here
 * does not throw; it drops a day permanently and leaves a gap nothing
 * downstream can distinguish from a quiet period.
 */

import { describe, expect, it } from 'vitest';
import {
  windowsToSync,
  hasLostHistory,
  FINANCES_MAX_WINDOW_DAYS,
} from './windows.js';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe('first run', () => {
  it('backfills from the retention limit rather than the beginning of time', () => {
    const windows = windowsToSync({ now: NOW });

    expect(windows.length).toBeGreaterThan(1);
    const first = new Date(windows[0].from);
    expect(first.getTime()).toBeCloseTo(
      NOW.getTime() - FINANCES_MAX_WINDOW_DAYS * DAY_MS,
      -3
    );
  });

  it('produces contiguous windows with no gap between them', () => {
    // A gap here is invisible: the cursor records one boundary, so anything
    // missing behind it is never retried.
    const windows = windowsToSync({ now: NOW });

    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].from).toBe(windows[i - 1].to);
    }
  });

  it('runs oldest first, so an interrupted backfill leaves a prefix', () => {
    // Newest-first would leave islands, and an island behind the cursor cannot
    // be detected later.
    const windows = windowsToSync({ now: NOW });
    const times = windows.map((w) => new Date(w.from).getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('ends exactly at now, never past it', () => {
    // A window ending in the future asks Amazon for data that does not exist
    // and advances the cursor past reality, skipping the interval on the next
    // run.
    const windows = windowsToSync({ now: NOW });

    expect(new Date(windows[windows.length - 1].to).getTime()).toBe(
      NOW.getTime()
    );
  });

  it('keeps every window inside the 180-day limit Amazon enforces', () => {
    const windows = windowsToSync({ now: NOW });

    for (const w of windows) {
      const span = new Date(w.to).getTime() - new Date(w.from).getTime();
      expect(span).toBeLessThanOrEqual(FINANCES_MAX_WINDOW_DAYS * DAY_MS);
    }
  });
});

describe('incremental run', () => {
  it('resumes from the cursor, not from the retention limit', () => {
    const windows = windowsToSync({
      syncedThrough: daysBefore(2).toISOString(),
      now: NOW,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0].from).toBe(daysBefore(2).toISOString());
    expect(windows[0].to).toBe(NOW.toISOString());
  });

  it('returns nothing when the cursor is already current', () => {
    // Not a zero-width window: Amazon rejects those, and a rejection here would
    // look like a broken seller on every run that had nothing to do.
    const windows = windowsToSync({
      syncedThrough: NOW.toISOString(),
      now: NOW,
    });

    expect(windows).toEqual([]);
  });

  it('returns nothing for a cursor somehow ahead of now', () => {
    // Clock skew between the dispatcher and the worker is enough to produce
    // this, and a negative window is not a request worth sending.
    const windows = windowsToSync({
      syncedThrough: new Date(NOW.getTime() + DAY_MS).toISOString(),
      now: NOW,
    });

    expect(windows).toEqual([]);
  });
});

describe('a cursor older than Amazon retains', () => {
  const stale = daysBefore(400).toISOString();

  it('clamps the request to what Amazon still has', () => {
    // Asking for 400 days fails the call outright; the intervening history is
    // already unrecoverable, so failing adds nothing but an outage.
    const windows = windowsToSync({ syncedThrough: stale, now: NOW });

    const earliest = new Date(windows[0].from).getTime();
    expect(earliest).toBeGreaterThanOrEqual(
      NOW.getTime() - FINANCES_MAX_WINDOW_DAYS * DAY_MS
    );
  });

  it('reports the loss rather than clamping silently', () => {
    // The gap is permanent. A seller who sees it deserves to know the next run
    // will not fill it.
    expect(hasLostHistory({ syncedThrough: stale, now: NOW })).toBe(true);
  });

  it('does not claim loss on a first run', () => {
    expect(hasLostHistory({ now: NOW })).toBe(false);
  });

  it('does not claim loss for a healthy cursor', () => {
    expect(
      hasLostHistory({ syncedThrough: daysBefore(3).toISOString(), now: NOW })
    ).toBe(false);
  });
});
