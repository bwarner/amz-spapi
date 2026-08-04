/**
 * Report polling budgets.
 *
 * A timeout only means something relative to the budget of whoever is waiting,
 * and that relationship was invisible while both were bare numbers in different
 * files. `runReport` defaulted to ten minutes; the only caller that reached it
 * was a chat tool inside a route allowed 300 seconds for an entire turn. It
 * could never have completed — only been killed by the platform, losing the
 * report id, so the retry asked Amazon to rebuild the same report.
 *
 * Nothing about that failure looked like a timeout mismatch. It looked like the
 * report being slow.
 */

import { describe, expect, it } from 'vitest';
import { REPORT_TIMEOUT_MS } from './sp-client.js';

/**
 * `apps/web/src/app/api/chat/route.ts` — the smallest route budget that reaches
 * a polling report. Restated rather than imported because the package cannot
 * depend on the app; the test below is what keeps the two honest.
 */
const CHAT_ROUTE_MAX_DURATION_MS = 300_000;

describe('report timeout budgets', () => {
  it('leaves the request-safe budget well inside the route it runs in', () => {
    // Not merely "under". A report tool that consumes most of the turn starves
    // the model and the streaming that follows it, so the failure moves rather
    // than disappearing.
    expect(REPORT_TIMEOUT_MS.requestSafe).toBeLessThanOrEqual(
      CHAT_ROUTE_MAX_DURATION_MS / 3
    );
  });

  it('keeps the worker budget out of the request path by being longer', () => {
    // Recorded as a relationship, not a number: the worker budget is allowed to
    // exceed any route precisely because nothing is waiting on it.
    expect(REPORT_TIMEOUT_MS.worker).toBeGreaterThan(
      CHAT_ROUTE_MAX_DURATION_MS
    );
  });

  it('does not use the worker budget as the default', () => {
    // The original bug in one line. A default longer than any caller's budget
    // can only ever be reached by a request that is already doomed, and it
    // reads as generous rather than broken.
    expect(REPORT_TIMEOUT_MS.requestSafe).not.toBe(REPORT_TIMEOUT_MS.worker);
    expect(REPORT_TIMEOUT_MS.requestSafe).toBeLessThan(
      REPORT_TIMEOUT_MS.worker
    );
  });
});
