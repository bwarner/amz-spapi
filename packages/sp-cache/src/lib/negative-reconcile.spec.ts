import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileDueNegatives } from './negative-reconcile.js';
import * as store from './funnel-store.js';

/**
 * The sweep that notices a negative nobody is watching for (#147).
 *
 * Everything worth testing here is a way the sweep could be silently useless: a
 * source cut while the destination is dead, a blocked obligation that leaves no
 * trace, or evidence gathered from the campaign that is still serving the term
 * we are about to cut.
 */

const USER = 'auth0|seller';
const NOW = Date.parse('2026-08-19T00:00:00Z');

function graduation(over: Record<string, unknown> = {}) {
  return {
    key: `${USER}::g1`,
    userId: USER,
    storedAt: 0,
    updatedAt: 0,
    graduation: {
      graduationId: 'g1',
      funnelId: 'f1',
      term: 'french press',
      keywordId: 'K-dest',
      fromCampaignId: 'C-auto',
      fromAdGroupId: 'AG-auto',
      toCampaignId: 'C-exact',
      toAdGroupId: 'AG-exact',
      state: 'applied',
      bid: 1.1,
      sourceCpc: 0.9,
      negatives: [
        {
          campaignId: 'C-auto',
          adGroupId: 'AG-auto',
          matchType: 'negativeExact',
          negativeKeywordId: null,
          state: 'scheduled',
          dueAt: NOW - 1000,
        },
      ],
      ...over,
    },
  } as never;
}

const ROW = (over: Record<string, unknown> = {}) => ({
  campaignId: 'C-exact',
  adGroupId: 'AG-exact',
  searchTerm: 'french press',
  impressions: 500,
  clicks: 9,
  ...over,
});

const spySettle = () =>
  vi.spyOn(store, 'settleGraduation').mockResolvedValue({} as never);

let settle: ReturnType<typeof spySettle>;

beforeEach(() => {
  vi.restoreAllMocks();
  settle = spySettle();
});

describe('reconcileDueNegatives', () => {
  it('does nothing at all when nothing is due', async () => {
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([]);
    const readRows = vi.fn();

    const summary = await reconcileDueNegatives({
      userId: USER,
      readRows,
      now: NOW,
    });

    expect(summary).toEqual({
      due: 0,
      ready: 0,
      blocked: 0,
      blockedDetail: [],
    });
    // Not merely wasteful: an unnarrowed row query for a seller with no due
    // negatives would scan a fortnight of every campaign they own.
    expect(readRows).not.toHaveBeenCalled();
  });

  it('reads rows ONLY from destination campaigns', async () => {
    // The source is still serving this term — that is what the overlap is for.
    // Fetching it would let a term match credit the source's impressions to the
    // destination, and the gate would wave through the cut it exists to hold.
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);
    const readRows = vi.fn().mockResolvedValue([]);

    await reconcileDueNegatives({ userId: USER, readRows, now: NOW });

    expect(readRows).toHaveBeenCalledWith({
      campaignIds: ['C-exact'],
      from: '2026-08-05',
      to: '2026-08-19',
    });
  });

  it('counts a delivering destination as ready, and writes nothing', async () => {
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);

    const summary = await reconcileDueNegatives({
      userId: USER,
      readRows: async () => [ROW()],
      now: NOW,
    });

    expect(summary.due).toBe(1);
    expect(summary.ready).toBe(1);
    expect(summary.blocked).toBe(0);
    // Ready is not applied. Detection is scheduled; application is approved.
    expect(settle).not.toHaveBeenCalled();
  });

  it('blocks when the destination has served nothing, and says why', async () => {
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);

    const summary = await reconcileDueNegatives({
      userId: USER,
      readRows: async () => [ROW({ impressions: 0, clicks: 0 })],
      now: NOW,
    });

    expect(summary.blocked).toBe(1);
    expect(summary.ready).toBe(0);
    expect(summary.blockedDetail[0]).toMatchObject({
      graduationId: 'g1',
      term: 'french press',
    });
    // A remedy is what makes it actionable rather than an accusation.
    expect(summary.blockedDetail[0].remedy.length).toBeGreaterThan(0);
  });

  it('records the blocking reason on the graduation', async () => {
    // Without this the funnel stops halfway and leaves nothing behind to
    // explain it. Silence is the failure being fixed.
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);

    await reconcileDueNegatives({
      userId: USER,
      readRows: async () => [ROW({ impressions: 0 })],
      now: NOW,
    });

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, graduationId: 'g1' })
    );
    const note = (settle.mock.calls[0][0] as { note: string }).note;
    expect(note).toContain('0 impressions');
  });

  it('does not rewrite a note that already says the same thing', async () => {
    // This runs on every sync. Rewriting an identical document would bury the
    // real transitions under a daily churn of no-op updates.
    const first = await (async () => {
      vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);
      await reconcileDueNegatives({
        userId: USER,
        readRows: async () => [ROW({ impressions: 0 })],
        now: NOW,
      });
      return (settle.mock.calls[0][0] as { note: string }).note;
    })();

    settle.mockClear();
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([
      graduation({ note: first }),
    ]);

    await reconcileDueNegatives({
      userId: USER,
      readRows: async () => [ROW({ impressions: 0 })],
      now: NOW,
    });

    expect(settle).not.toHaveBeenCalled();
  });

  it('blocks when no rows cover the destination at all', async () => {
    // Absent is not zero. "We cannot tell yet" and "measured and dead" get
    // different remedies, and neither is safe to cut on.
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);

    const summary = await reconcileDueNegatives({
      userId: USER,
      readRows: async () => [],
      now: NOW,
    });

    expect(summary.blocked).toBe(1);
    expect(summary.blockedDetail[0].reason).toContain('unknown');
  });

  it('treats source-campaign rows as no evidence', async () => {
    // The whole bug in one test: rows exist for this term, but in the campaign
    // being cut rather than the one being proved.
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([graduation()]);

    const summary = await reconcileDueNegatives({
      userId: USER,
      readRows: async () => [
        ROW({ campaignId: 'C-auto', adGroupId: 'AG-auto', impressions: 9000 }),
      ],
      now: NOW,
    });

    expect(summary.ready).toBe(0);
    expect(summary.blocked).toBe(1);
  });
});
