import { describe, expect, it } from 'vitest';
import {
  GraduationPolicySchema,
  graduationId,
  type Funnel,
  type FunnelNode,
  type Graduation,
} from '@farvisionllc/models';
import {
  planHarvest,
  type HarvestPlan,
  type HarvestRow,
  type PlanHarvestParams,
} from './keyword-harvest.js';

/**
 * The judgement here is about what the harvest REFUSES to do.
 *
 * Proposing a good keyword is the easy half and the cheap half to get wrong —
 * a seller reads it and says no. The expensive failures are silent: harvesting
 * immature data and calling a winner waste, harvesting a window with a hole in
 * it, cutting a source whose destination advertises a different product. Each
 * of those gets a test that fails loudly if the gate is ever relaxed.
 */

const TODAY = '2026-08-18';
// Mature through 2026-08-04 at a 14-day attribution window.
const WINDOW = { from: '2026-06-06', to: '2026-08-04' };
const COVERED = [{ from: '2026-06-01', to: '2026-08-04' }];

function node(overrides: Partial<FunnelNode> & { nodeId: string }): FunnelNode {
  return {
    campaignId: `camp-${overrides.nodeId}`,
    adGroupId: `ag-${overrides.nodeId}`,
    role: 'exact',
    advertisedProductIds: ['B0TEAPOT'],
    ...overrides,
  } as FunnelNode;
}

function funnel(overrides: Partial<Funnel> = {}): Funnel {
  return {
    funnelId: 'f1',
    profileId: 'p1',
    name: 'Gran del Val',
    nodes: [
      node({ nodeId: 'auto', role: 'auto' }),
      node({ nodeId: 'phrase', role: 'phrase' }),
      node({ nodeId: 'exact', role: 'exact' }),
    ],
    edges: [
      { from: 'auto', to: 'exact', policy: GraduationPolicySchema.parse({}) },
    ],
    ...overrides,
  };
}

function row(overrides: Partial<HarvestRow> = {}): HarvestRow {
  return {
    campaignId: 'camp-auto',
    adGroupId: 'ag-auto',
    searchTerm: 'glass teapot',
    impressions: 900,
    clicks: 30,
    spend: 24,
    sales: 120,
    orders: 4,
    ...overrides,
  };
}

function plan(overrides: Partial<PlanHarvestParams> = {}): HarvestPlan {
  const outcome = planHarvest({
    funnel: funnel(),
    rows: [row()],
    window: WINDOW,
    today: TODAY,
    attributionDays: 14,
    covered: COVERED,
    graduations: [],
    ...overrides,
  });
  if (outcome.refused) {
    throw new Error(`Expected a plan, got a refusal: ${outcome.reason}`);
  }
  return outcome;
}

describe('the attribution gate', () => {
  it('refuses a window that runs into the immature tail', () => {
    // Yesterday's orders have not finished attributing. Harvesting here would
    // under-count them and the waste rule would read that as proof of waste.
    const outcome = planHarvest({
      funnel: funnel(),
      rows: [row()],
      window: { from: '2026-06-06', to: '2026-08-17' },
      today: TODAY,
      attributionDays: 14,
      covered: [{ from: '2026-06-01', to: '2026-08-17' }],
      graduations: [],
    });
    expect(outcome.refused).toBe(true);
    if (!outcome.refused) return;
    expect(outcome.reason).toContain('2026-08-04');
  });

  it('derives the cutoff from the window given, not a fixed 7 days', () => {
    // The console export reports 7-day totals; the API path defaults to 14.
    // A hardcoded 7 would wave through a week of half-attributed orders.
    const outcome = planHarvest({
      funnel: funnel(),
      rows: [row()],
      window: { from: '2026-06-06', to: '2026-08-10' },
      today: TODAY,
      attributionDays: 7,
      covered: [{ from: '2026-06-01', to: '2026-08-10' }],
      graduations: [],
    });
    expect(outcome.refused).toBe(false);
  });
});

describe('the coverage gate', () => {
  it('refuses a window with an un-ingested hole', () => {
    const outcome = planHarvest({
      funnel: funnel(),
      rows: [row()],
      window: WINDOW,
      today: TODAY,
      attributionDays: 14,
      covered: [
        { from: '2026-06-01', to: '2026-07-01' },
        { from: '2026-07-20', to: '2026-08-04' },
      ],
      graduations: [],
    });
    expect(outcome.refused).toBe(true);
    if (!outcome.refused) return;
    // The hole itself is named, so the answer says what to re-import.
    expect(outcome.reason).toContain('2026-07-02');
  });

  it('accepts a window covered by several adjoining imports', () => {
    const outcome = planHarvest({
      funnel: funnel(),
      rows: [row()],
      window: WINDOW,
      today: TODAY,
      attributionDays: 14,
      covered: [
        { from: '2026-06-01', to: '2026-07-05' },
        { from: '2026-07-06', to: '2026-08-04' },
      ],
      graduations: [],
    });
    expect(outcome.refused).toBe(false);
  });
});

describe('graduation', () => {
  it('proposes the term and carries the observed CPC into the bid', () => {
    const result = plan();
    expect(result.graduations).toHaveLength(1);
    const [proposal] = result.graduations;
    expect(proposal.term).toBe('glass teapot');
    expect(proposal.to.nodeId).toBe('exact');
    expect(proposal.matchType).toBe('exact');
    // 24 spend / 30 clicks = 0.80 CPC, uplifted 1.1x for exact.
    expect(proposal.sourceCpc).toBeCloseTo(0.8);
    expect(proposal.bid).toBeCloseTo(0.88);
    // The evidence travels with the decision, window and all.
    expect(proposal.evidence.orders).toBe(4);
    expect(proposal.evidence.attributionDays).toBe(14);
    expect(proposal.evidence.from).toBe(WINDOW.from);
  });

  it('sends a proven term straight to exact, not through phrase', () => {
    // Both edges qualify; a fixed ladder would send a 4-order term on a detour
    // through phrase to re-learn what the evidence already says.
    const result = plan({
      funnel: funnel({
        edges: [
          {
            from: 'auto',
            to: 'phrase',
            policy: GraduationPolicySchema.parse({ minOrders: 1 }),
          },
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({ minOrders: 3 }),
          },
        ],
      }),
    });
    expect(result.graduations.map((g) => g.to.nodeId)).toEqual(['exact']);
  });

  it('routes a promising-but-unproven term to phrase instead', () => {
    const result = plan({
      rows: [row({ orders: 1, sales: 30, spend: 18, clicks: 22 })],
      funnel: funnel({
        edges: [
          {
            from: 'auto',
            to: 'phrase',
            policy: GraduationPolicySchema.parse({ minOrders: 1 }),
          },
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({ minOrders: 3 }),
          },
        ],
      }),
    });
    expect(result.graduations.map((g) => g.to.nodeId)).toEqual(['phrase']);
  });

  it('folds close variants into one decision with summed evidence', () => {
    // Exact already covers plurals, so two keywords would only split the data.
    const result = plan({
      rows: [
        row({
          searchTerm: 'glass teapot',
          clicks: 20,
          orders: 3,
          spend: 16,
          sales: 90,
        }),
        row({
          searchTerm: 'Glass Teapots',
          clicks: 10,
          orders: 1,
          spend: 8,
          sales: 30,
        }),
      ],
    });
    expect(result.graduations).toHaveLength(1);
    const [proposal] = result.graduations;
    expect(proposal.evidence.orders).toBe(4);
    expect(proposal.evidence.clicks).toBe(30);
    expect(proposal.variants).toEqual(['glass teapot', 'glass teapots']);
  });

  it('cannot pass an ACOS ceiling with no sales at all', () => {
    // An undefined ACOS treated as 0 would let the worst rows through the
    // efficiency gate as though they were the most efficient.
    const result = plan({
      rows: [row({ orders: 0, sales: 0 })],
      funnel: funnel({
        edges: [
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({
              minOrders: 0,
              maxAcos: 0.5,
            }),
          },
        ],
      }),
    });
    expect(result.graduations).toHaveLength(0);
  });

  it('refuses to create a keyword in an auto ad group', () => {
    const result = plan({
      funnel: funnel({
        edges: [
          {
            from: 'phrase',
            to: 'auto',
            policy: GraduationPolicySchema.parse({}),
          },
        ],
      }),
      rows: [row({ campaignId: 'camp-phrase', adGroupId: 'ag-phrase' })],
    });
    expect(result.graduations).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('auto ad group');
  });
});

describe('idempotency', () => {
  it('proposes nothing for a term that already graduated on this edge', () => {
    const existing = {
      graduationId: graduationId({
        funnelId: 'f1',
        fromNodeId: 'auto',
        toNodeId: 'exact',
        term: 'glass teapot',
      }),
    } as Graduation;
    const result = plan({ graduations: [existing] });
    expect(result.graduations).toHaveLength(0);
  });

  it('matches a close variant against the existing graduation too', () => {
    // Otherwise "glass teapots" graduates a second keyword next week for a
    // term "glass teapot" already covers.
    const existing = {
      graduationId: graduationId({
        funnelId: 'f1',
        fromNodeId: 'auto',
        toNodeId: 'exact',
        term: 'glass teapots',
      }),
    } as Graduation;
    const result = plan({ graduations: [existing] });
    expect(result.graduations).toHaveLength(0);
  });

  it('skips a keyword that already exists downstream', () => {
    const result = plan({
      existingKeywords: [
        { adGroupId: 'ag-exact', keyword: 'Glass Teapot', matchType: 'EXACT' },
      ],
    });
    expect(result.graduations).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('Already a exact keyword');
  });
});

describe('the product-scope gate', () => {
  it('refuses a destination advertising a product the evidence never saw', () => {
    const result = plan({
      funnel: funnel({
        nodes: [
          node({
            nodeId: 'auto',
            role: 'auto',
            advertisedProductIds: ['B0TEAPOT'],
          }),
          node({
            nodeId: 'exact',
            role: 'exact',
            advertisedProductIds: ['B0TEAPOT', 'B0KETTLE'],
          }),
        ],
      }),
    });
    expect(result.graduations).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('B0KETTLE');
  });

  it('refuses when either side has no product list — unverified is not allowed', () => {
    const result = plan({
      funnel: funnel({
        nodes: [
          node({ nodeId: 'auto', role: 'auto', advertisedProductIds: [] }),
          node({ nodeId: 'exact', role: 'exact' }),
        ],
      }),
    });
    expect(result.graduations).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('Product scope unknown');
  });

  it('allows a narrower destination when the edge asks for subset', () => {
    const result = plan({
      funnel: funnel({
        nodes: [
          node({
            nodeId: 'auto',
            role: 'auto',
            advertisedProductIds: ['B0TEAPOT', 'B0KETTLE'],
          }),
          node({
            nodeId: 'exact',
            role: 'exact',
            advertisedProductIds: ['B0TEAPOT'],
          }),
        ],
        edges: [
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({ productScope: 'subset' }),
          },
        ],
      }),
    });
    expect(result.graduations).toHaveLength(1);
    expect(result.graduations[0].productScopeChecked).toBe(true);
  });

  it('records that the check was skipped when an edge ignores scope', () => {
    const result = plan({
      funnel: funnel({
        nodes: [
          node({ nodeId: 'auto', role: 'auto', advertisedProductIds: [] }),
          node({ nodeId: 'exact', role: 'exact', advertisedProductIds: [] }),
        ],
        edges: [
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({ productScope: 'ignore' }),
          },
        ],
      }),
    });
    expect(result.graduations).toHaveLength(1);
    // Visible later that this term was promoted with no product evidence.
    expect(result.graduations[0].productScopeChecked).toBe(false);
  });
});

describe('the saturation gate', () => {
  it('refuses a destination already spending its daily budget', () => {
    const result = plan({
      budgets: [{ campaignId: 'camp-exact', dailyBudget: 50, dailySpend: 49 }],
    });
    expect(result.graduations).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('Raise the budget');
  });

  it('graduates when the destination still has headroom', () => {
    const result = plan({
      budgets: [{ campaignId: 'camp-exact', dailyBudget: 50, dailySpend: 20 }],
    });
    expect(result.graduations).toHaveLength(1);
  });

  it('does not treat a missing budget signal as saturation', () => {
    // Budget usage is a separate API call the caller may not have made.
    expect(plan({ budgets: [] }).graduations).toHaveLength(1);
  });
});

describe('the per-run cap', () => {
  it('takes the strongest evidence first and reports what it held back', () => {
    const rows = [4, 3, 2].map((orders, index) =>
      row({ searchTerm: `term ${index}`, orders, sales: orders * 30 })
    );
    const result = plan({
      rows,
      funnel: funnel({
        edges: [
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({ maxPerRun: 2 }),
          },
        ],
      }),
    });
    expect(result.graduations.map((g) => g.evidence.orders)).toEqual([4, 3]);
    expect(result.skipped.some((s) => s.reason.includes('2-per-run cap'))).toBe(
      true
    );
  });
});

describe('the waste rule', () => {
  it('proposes a negative exact for a term that only ever cost money', () => {
    const result = plan({
      rows: [
        row({
          searchTerm: 'free teapot',
          clicks: 25,
          spend: 20,
          orders: 0,
          sales: 0,
        }),
      ],
    });
    expect(result.negatives).toHaveLength(1);
    // Negative exact, not phrase: phrase blocks a whole family and can starve
    // the discovery the funnel runs on.
    expect(result.negatives[0].matchType).toBe('negativeExact');
    expect(result.negatives[0].node.nodeId).toBe('auto');
  });

  it('is patient in discovery — a handful of clicks is not yet evidence', () => {
    const result = plan({
      rows: [
        row({
          searchTerm: 'free teapot',
          clicks: 12,
          spend: 9,
          orders: 0,
          sales: 0,
        }),
      ],
    });
    expect(result.negatives).toHaveLength(0);
  });

  it('is off entirely during a launch', () => {
    // Negating here would shut down the discovery a launch depends on.
    const result = plan({
      funnel: funnel({
        nodes: [
          node({ nodeId: 'auto', role: 'auto', objective: 'launch' }),
          node({ nodeId: 'exact', role: 'exact' }),
        ],
      }),
      rows: [
        row({
          searchTerm: 'free teapot',
          clicks: 80,
          spend: 60,
          orders: 0,
          sales: 0,
        }),
      ],
    });
    expect(result.negatives).toHaveLength(0);
  });

  it('never negates a term that already graduated, however quiet it has gone', () => {
    // The real collision. A term graduated last month shows 0 orders in the
    // source this month — precisely because its traffic moved downstream. The
    // waste rule would read that as waste and propose a negative that the
    // graduation has ALREADY scheduled as a backward obligation, so the term
    // would be cut twice, once on a timetable and once by surprise.
    const existing = {
      graduationId: graduationId({
        funnelId: 'f1',
        fromNodeId: 'auto',
        toNodeId: 'exact',
        term: 'glass teapot',
      }),
    } as Graduation;
    const result = plan({
      graduations: [existing],
      rows: [row({ clicks: 40, spend: 32, orders: 0, sales: 0 })],
    });
    expect(result.graduations).toHaveLength(0);
    expect(result.negatives).toHaveLength(0);
  });

  it('still negates a term held back only by the per-run cap next to it', () => {
    // The cap defers a graduation; it must not silently convert the deferred
    // term into a negative, which would cut it instead of promoting it.
    const result = plan({
      rows: [
        row({ searchTerm: 'term a', orders: 4, sales: 120 }),
        row({ searchTerm: 'term b', orders: 3, sales: 90 }),
        row({
          searchTerm: 'free teapot',
          clicks: 25,
          spend: 20,
          orders: 0,
          sales: 0,
        }),
      ],
      funnel: funnel({
        edges: [
          {
            from: 'auto',
            to: 'exact',
            policy: GraduationPolicySchema.parse({ maxPerRun: 1 }),
          },
        ],
      }),
    });
    expect(result.graduations.map((g) => g.term)).toEqual(['term a']);
    // Only the genuine waste term, never the deferred "term b".
    expect(result.negatives.map((n) => n.term)).toEqual(['free teapot']);
  });
});

describe('attributing rows to nodes', () => {
  it('joins by id when the row carries one', () => {
    expect(plan().graduations[0].from.nodeId).toBe('auto');
  });

  it('falls back to names for console exports, which have no id column', () => {
    const result = plan({
      funnel: funnel({
        nodes: [
          node({
            nodeId: 'auto',
            role: 'auto',
            campaignName: 'Auto - Catch all',
            adGroupName: 'Ad Group 1',
          }),
          node({ nodeId: 'exact', role: 'exact' }),
        ],
      }),
      rows: [
        row({
          campaignId: undefined,
          adGroupId: undefined,
          campaignName: 'auto - catch ALL',
          adGroupName: 'Ad Group 1',
        }),
      ],
    });
    expect(result.graduations).toHaveLength(1);
  });

  it('will not match on ad group name alone, which repeats across campaigns', () => {
    const result = plan({
      funnel: funnel({
        nodes: [
          node({
            nodeId: 'auto',
            role: 'auto',
            campaignName: 'Auto - Catch all',
            adGroupName: 'SP - Exact',
          }),
          node({ nodeId: 'exact', role: 'exact' }),
        ],
      }),
      rows: [
        row({
          campaignId: undefined,
          adGroupId: undefined,
          campaignName: 'A Different Campaign',
          adGroupName: 'SP - Exact',
        }),
      ],
    });
    expect(result.graduations).toHaveLength(0);
    // Counted rather than dropped: a rename shows up as unattributed rows, not
    // as a harvest that quietly found nothing.
    expect(result.unattributedRows).toBe(1);
  });
});
