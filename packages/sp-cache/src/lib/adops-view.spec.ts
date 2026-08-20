import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAdOpsView, summariseFreshness } from './adops-view.js';
import * as store from './funnel-store.js';

/**
 * The AdOps read model (#149).
 *
 * The failures worth testing are the ones that look like a working screen: a
 * destination reported as healthy because its budget could not be read, a
 * fortnight-old figure presented as current, or a due negative that the screen
 * and the scheduled sweep disagree about.
 */

const USER = 'auth0|seller';
const NOW = Date.parse('2026-08-19T00:00:00Z');

const FUNNEL = {
  userId: USER,
  funnel: {
    funnelId: 'f1',
    profileId: 'P1',
    name: 'Teapots',
    nodes: [
      {
        nodeId: 'n-auto',
        campaignId: 'C-auto',
        adGroupId: 'AG-auto',
        role: 'auto',
      },
      {
        nodeId: 'n-exact',
        campaignId: 'C-exact',
        adGroupId: 'AG-exact',
        role: 'exact',
      },
    ],
    edges: [{ from: 'n-auto', to: 'n-exact', rule: {} }],
  },
} as never;

const EMPTY_COVERAGE = { covered: [], gaps: [] };

function readers(over: Record<string, unknown> = {}) {
  return {
    userId: USER,
    now: NOW,
    readRows: vi.fn(async () => []),
    readCoverage: vi.fn(async () => EMPTY_COVERAGE),
    readBudgets: vi.fn(async () => new Map()),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(store, 'listFunnels').mockResolvedValue([FUNNEL]);
  vi.spyOn(store, 'listDueNegatives').mockResolvedValue([]);
  vi.spyOn(store, 'listGraduations').mockResolvedValue([]);
});

describe('destination health', () => {
  it('reads budgets for DESTINATIONS only, never sources', async () => {
    // A source's budget is not a saturation signal — nothing graduates into it.
    const readBudgets = vi.fn(async () => new Map());
    await buildAdOpsView(readers({ readBudgets }));

    expect(readBudgets).toHaveBeenCalledWith(['C-exact']);
  });

  it('computes utilisation from mean daily spend against the daily budget', async () => {
    const view = await buildAdOpsView(
      readers({
        readRows: async () => [
          {
            campaignId: 'C-exact',
            searchTerm: 't',
            impressions: 1,
            clicks: 1,
            spend: 140,
          },
        ],
        readBudgets: async () =>
          new Map([['C-exact', { dailyBudget: 20, keywordCount: 12 }]]),
      })
    );

    const destination = view.funnels[0].destinations[0];
    // 140 over a 14-day window is 10/day against a 20/day budget.
    expect(destination.spendPerDay).toBe(10);
    expect(destination.utilisation).toBe(0.5);
    expect(destination.keywordCount).toBe(12);
  });

  it('leaves utilisation ABSENT when the budget could not be read', async () => {
    // Absent, not zero. A destination whose budget is unknown is not a
    // destination with room, and graduating into it on that assumption is how
    // existing champions lose impression share to newcomers.
    const view = await buildAdOpsView(
      readers({
        readRows: async () => [
          {
            campaignId: 'C-exact',
            searchTerm: 't',
            impressions: 1,
            clicks: 1,
            spend: 140,
          },
        ],
        readBudgets: async () => new Map(),
      })
    );

    const destination = view.funnels[0].destinations[0];
    expect(destination.utilisation).toBeUndefined();
    expect(destination.spendPerDay).toBe(10);
  });
});

describe('freshness', () => {
  it('reports the latest day covered, and how stale that is', () => {
    const freshness = summariseFreshness(
      {
        covered: [
          { from: '2026-07-01', to: '2026-07-20' },
          { from: '2026-08-01', to: '2026-08-12' },
        ],
        gaps: [],
      },
      '2026-08-19'
    );

    // The latest day REACHED, not the newest import: a backfill of July says
    // nothing about whether this week exists.
    expect(freshness.through).toBe('2026-08-12');
    expect(freshness.staleDays).toBe(7);
  });

  it('says nothing rather than "fresh" when nothing is stored', async () => {
    // A page that silently shows week-old numbers is worse than one that shows
    // none; a page that shows "0 days stale" over no data is worse than both.
    const freshness = summariseFreshness(
      { covered: [], gaps: [] },
      '2026-08-19'
    );

    expect(freshness.through).toBeUndefined();
    expect(freshness.staleDays).toBeUndefined();
  });

  it('carries gaps through to the view', async () => {
    const view = await buildAdOpsView(
      readers({
        readCoverage: async () => ({
          covered: [{ from: '2026-08-01', to: '2026-08-12' }],
          gaps: [{ from: '2026-08-13', to: '2026-08-19' }],
        }),
      })
    );

    expect(view.freshness.gaps).toEqual([
      { from: '2026-08-13', to: '2026-08-19' },
    ]);
  });
});

describe('due negatives', () => {
  const GRADUATION = {
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
      proposedAt: 1,
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
    },
  } as never;

  it('shows a blocked negative WITH its reason and remedy', async () => {
    // The whole point of surfacing these: a funnel that stopped halfway should
    // explain itself rather than leaving the seller to find nothing.
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([GRADUATION]);

    const view = await buildAdOpsView(
      readers({
        readRows: async () => [
          {
            campaignId: 'C-exact',
            adGroupId: 'AG-exact',
            searchTerm: 'french press',
            impressions: 0,
            clicks: 0,
          },
        ],
      })
    );

    expect(view.dueNegatives).toHaveLength(1);
    expect(view.dueNegatives[0].ready).toBe(false);
    expect(view.dueNegatives[0].reason).toContain('0 impressions');
    expect(view.dueNegatives[0].remedy?.length).toBeGreaterThan(0);
  });

  it('does not count the source campaign as destination delivery', async () => {
    // The screen shares `deliveryFromRows` with the sweep precisely so the two
    // cannot disagree about what is blocked.
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([GRADUATION]);

    const view = await buildAdOpsView(
      readers({
        readRows: async () => [
          {
            campaignId: 'C-auto',
            adGroupId: 'AG-auto',
            searchTerm: 'french press',
            impressions: 9000,
            clicks: 40,
          },
        ],
      })
    );

    expect(view.dueNegatives[0].ready).toBe(false);
  });

  it('marks a delivering destination as ready', async () => {
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([GRADUATION]);

    const view = await buildAdOpsView(
      readers({
        readRows: async () => [
          {
            campaignId: 'C-exact',
            adGroupId: 'AG-exact',
            searchTerm: 'french press',
            impressions: 800,
            clicks: 9,
          },
        ],
      })
    );

    expect(view.dueNegatives[0].ready).toBe(true);
    expect(view.dueNegatives[0].reason).toBeUndefined();
  });

  it('writes nothing — opening a screen must not settle an obligation', async () => {
    const settle = vi.spyOn(store, 'settleGraduation');
    vi.spyOn(store, 'listDueNegatives').mockResolvedValue([GRADUATION]);

    await buildAdOpsView(readers({ readRows: async () => [] }));

    expect(settle).not.toHaveBeenCalled();
  });
});

describe('the empty account', () => {
  it('queries nothing when there are no funnels', async () => {
    vi.spyOn(store, 'listFunnels').mockResolvedValue([]);
    const readRows = vi.fn(async () => []);
    const readBudgets = vi.fn(async () => new Map());

    const view = await buildAdOpsView(readers({ readRows, readBudgets }));

    expect(readRows).not.toHaveBeenCalled();
    expect(readBudgets).not.toHaveBeenCalled();
    expect(view.funnels).toEqual([]);
  });
});
