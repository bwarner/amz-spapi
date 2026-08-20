import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The host half of keyword harvest funnels (#147).
 *
 * The engine is tested in sp-cache. What is tested here is the wiring, and its
 * failures are the quiet ones: a default window that includes days still being
 * attributed proposes winners as waste, and a delivery map filled with zeros
 * makes a keyword that never served indistinguishable from one measured and
 * found dead — which is the check standing between a graduation and lost sales.
 */

const planHarvest = vi.fn(() => ({ graduations: [], negatives: [] }));
const queryHarvestRows = vi.fn(async () => []);
const getCoverage = vi.fn(async () => ({ covered: [], gaps: [] }));
const listGraduations = vi.fn(async () => []);
const dueNegativeDecisions = vi.fn(async () => []);
// Stubbed, because the scoping it performs is tested directly in sp-cache
// (`deliveryFromRows`). What matters here is the wiring around it: that the
// rows handed to it were queried from the DESTINATION campaigns rather than
// every node in the funnel.
const deliveryFromRows = vi.fn(() => new Map());
const getFunnel = vi.fn(async () => ({
  userId: 'auth0|1',
  funnel: {
    funnelId: 'f1',
    profileId: 'P1',
    nodes: [
      { campaignId: 'C1', adGroupId: 'G1', role: 'auto' },
      { campaignId: 'C2', adGroupId: 'G2', role: 'exact' },
    ],
    edges: [],
  },
}));

vi.mock('@amz-spapi/sp-cache', () => ({
  planHarvest: (...a: unknown[]) => planHarvest(...(a as [])),
  queryHarvestRows: (...a: unknown[]) => queryHarvestRows(...(a as [])),
  getCoverage: (...a: unknown[]) => getCoverage(...(a as [])),
  listGraduations: (...a: unknown[]) => listGraduations(...(a as [])),
  dueNegativeDecisions: (...a: unknown[]) => dueNegativeDecisions(...(a as [])),
  deliveryFromRows: (...a: unknown[]) => deliveryFromRows(...(a as [])),
  getFunnel: (...a: unknown[]) => getFunnel(...(a as [])),
  listFunnels: vi.fn(async () => []),
  storeFunnel: vi.fn(async () => ({
    funnel: { funnelId: 'f1', nodes: [], edges: [] },
  })),
  inferFunnelTopology: vi.fn(() => ({
    funnel: { nodes: [] },
    skipped: [],
    mixed: [],
  })),
  applyGraduation: vi.fn(async () => ({ applied: true })),
  applyBackwardNegative: vi.fn(async () => ({ applied: true })),
}));

const noop = () => undefined;
vi.mock('./logger', () => ({
  loggerFor: () => ({ info: noop, warn: noop, error: noop }),
}));

const { createHarvestOps } = await import('./harvest-ops');

/** 2026-08-18T00:00:00Z */
const NOW = Date.UTC(2026, 7, 18);

function ops(overrides: Partial<Parameters<typeof createHarvestOps>[0]> = {}) {
  return createHarvestOps({
    userId: 'auth0|1',
    sellerId: 'A1',
    now: () => NOW,
    resolveAds: async () => ({
      client: {
        getCampaignBudgetUsage: vi.fn(async () => []),
      } as never,
      profileId: 'P1',
    }),
    ...overrides,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('planHarvest window defaults', () => {
  it('ends the window where attribution closes, not today', async () => {
    // "7 Day Total Orders" means the last seven days are still filling in.
    // Defaulting to today would make every unqualified call a refusal, and the
    // refusal reads as "your data is bad" rather than "I asked for days that
    // are still counting".
    await ops().planHarvest({ funnelId: 'f1' });

    const [call] = planHarvest.mock.calls as unknown as [
      [
        {
          window: { from: string; to: string };
          attributionDays: number;
          today: string;
        }
      ]
    ];
    expect(call[0].window.to).toBe('2026-08-11');
    expect(call[0].today).toBe('2026-08-18');
    expect(call[0].attributionDays).toBe(7);
  });

  it('reads evidence only from the funnel campaigns', async () => {
    // Not the whole account: another campaign's terms are not this funnel's
    // evidence, and graduating on them would move a term between structures
    // that have nothing to do with each other.
    await ops().planHarvest({ funnelId: 'f1' });

    const [rowCall] = queryHarvestRows.mock.calls as unknown as [
      [{ campaignIds: string[]; sellerId: string }]
    ];
    expect(rowCall[0].campaignIds.sort()).toEqual(['C1', 'C2']);
    expect(rowCall[0].sellerId).toBe('A1');
  });

  it('survives a budget-usage 403 rather than failing the whole plan', async () => {
    // Amazon requires an EDIT scope for budget usage. Losing the saturation
    // signal is a degraded plan; losing the plan is no plan at all.
    const failing = ops({
      resolveAds: async () => ({
        client: {
          getCampaignBudgetUsage: vi.fn(async () => {
            throw new Error('403 Forbidden');
          }),
        } as never,
        profileId: 'P1',
      }),
    });

    const result = await failing.planHarvest({ funnelId: 'f1' });
    expect(result).toBeDefined();
    expect(planHarvest).toHaveBeenCalled();
  });

  it('refuses a funnel that is not the caller’s', async () => {
    getFunnel.mockResolvedValueOnce(null as never);
    const result = (await ops().planHarvest({ funnelId: 'nope' })) as {
      refused?: boolean;
    };
    expect(result.refused).toBe(true);
  });
});

describe('due negatives', () => {
  it('queries only the DESTINATION campaigns, not every funnel node', async () => {
    // The narrowing is a correctness gate, not an optimisation. During the
    // overlap the source is still serving the graduated term — by design — so
    // rows fetched across the whole funnel let a term-match credit the source's
    // impressions to the destination, and the gate waves through a negative
    // that cuts a live source in favour of a keyword that never served.
    listGraduations.mockResolvedValueOnce([
      {
        graduation: {
          term: 'french press',
          keywordId: 'K1',
          toCampaignId: 'C2',
        },
      },
      {
        graduation: { term: 'cafetiere', keywordId: 'K2', toCampaignId: 'C2' },
      },
    ] as never);

    await ops().dueNegatives({ funnelId: 'f1' });

    const [rowCall] = queryHarvestRows.mock.calls as unknown as [
      [{ campaignIds: string[] }]
    ];
    // C1 is the auto node in this funnel — a source, and never evidence that
    // the destination is delivering.
    expect(rowCall[0].campaignIds).toEqual(['C2']);
  });

  it('hands the graduations and rows to the scoping function', async () => {
    listGraduations.mockResolvedValueOnce([
      {
        graduation: {
          term: 'french press',
          keywordId: 'K1',
          toCampaignId: 'C2',
        },
      },
    ] as never);

    await ops().dueNegatives({ funnelId: 'f1' });

    const [call] = deliveryFromRows.mock.calls as unknown as [
      [{ graduations: Array<{ keywordId: string }> }]
    ];
    expect(call[0].graduations).toEqual([
      { term: 'french press', keywordId: 'K1', toCampaignId: 'C2' },
    ]);
  });

  it('skips the row query entirely when nothing has graduated', async () => {
    // An unnarrowed query with no campaign filter would scan the seller's whole
    // window for a funnel that has never graduated anything.
    await ops().dueNegatives({ funnelId: 'f1' });
    expect(queryHarvestRows).not.toHaveBeenCalled();
  });

  it('reads delivery over a SHORT window, not the harvest window', async () => {
    // The question is whether the destination is serving now. Sixty days would
    // let a keyword that died three weeks ago still look alive.
    listGraduations.mockResolvedValueOnce([
      {
        graduation: {
          term: 'french press',
          keywordId: 'K1',
          toCampaignId: 'C2',
        },
      },
    ] as never);

    await ops().dueNegatives({ funnelId: 'f1' });

    const [rowCall] = queryHarvestRows.mock.calls as unknown as [
      [{ from: string; to: string }]
    ];
    expect(rowCall[0].to).toBe('2026-08-18');
    expect(rowCall[0].from).toBe('2026-08-04');
  });
});
