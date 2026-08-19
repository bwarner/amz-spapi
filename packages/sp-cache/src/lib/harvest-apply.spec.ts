import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBackwardNegative,
  applyGraduation,
  deliveryFromRows,
  dueNegativeDecisions,
  type DeliveryEvidence,
  type HarvestWriteClient,
} from './harvest-apply.js';
import { funnelStorage, type StoredGraduation } from './funnel-store.js';
import type { GraduationProposal } from './keyword-harvest.js';

/**
 * Applying a harvest (#147).
 *
 * A graduation is two obligations separated in time, and every failure worth
 * testing is one of them coming apart: a keyword created twice, a keyword
 * created with no record, or a source cut while the destination sits dead.
 * The last one costs real sales and is entirely preventable from stored data.
 */

const USER = 'auth0|seller';
let store: Map<string, StoredGraduation>;

const NODE = (over: Record<string, unknown> = {}) => ({
  nodeId: 'n-auto',
  campaignId: 'C-AUTO',
  adGroupId: 'G-AUTO',
  role: 'auto' as const,
  advertisedProductIds: ['B0PRODUCT'],
  ...over,
});

const PROPOSAL: GraduationProposal = {
  kind: 'graduate',
  graduationId: 'grad-french-press-auto-exact',
  term: 'french press',
  variants: ['french presses'],
  from: NODE(),
  to: NODE({
    nodeId: 'n-exact',
    campaignId: 'C-EXACT',
    adGroupId: 'G-EXACT',
    role: 'exact',
  }),
  matchType: 'exact',
  bid: 1.35,
  sourceCpc: 1.1,
  evidence: {
    impressions: 4200,
    clicks: 61,
    orders: 5,
    spend: 67.1,
    sales: 240,
    acos: 0.28,
    from: '2026-07-01',
    to: '2026-07-31',
    // The window used, carried with the numbers. Evidence without it is an
    // unexplainable fact six weeks later.
    attributionDays: 7,
    rows: 31,
  },
  productScopeChecked: true,
  overlapDays: 14,
};

function client(over: Partial<HarvestWriteClient> = {}): HarvestWriteClient {
  return {
    createKeywords: vi.fn(async () => ({
      success: [{ keywordId: 'KW-1' }],
      error: [],
    })),
    createNegativeKeywords: vi.fn(async () => ({
      success: [{ keywordId: 'NEG-1' }],
      error: [],
    })),
    ...over,
  };
}

beforeEach(() => {
  store = new Map();
  vi.spyOn(funnelStorage, 'getDocument').mockImplementation(
    async (_s, _c, key) => (store.get(key as string) ?? null) as never
  );
  vi.spyOn(funnelStorage, 'upsertDocument').mockImplementation(
    async (_s, _c, key, value) => {
      store.set(key as string, value as StoredGraduation);
      return undefined as never;
    }
  );
  vi.spyOn(funnelStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: [...store.values()] } as never)
  );
});

describe('applyGraduation', () => {
  it('records BEFORE calling Amazon, so a crash cannot orphan a keyword', async () => {
    // The ordering is the correctness argument. Creating first would leave a
    // live keyword nothing points at, and the next run would create a second.
    const order: string[] = [];
    vi.spyOn(funnelStorage, 'upsertDocument').mockImplementation(
      async (_s, _c, key, value) => {
        order.push('record');
        store.set(key as string, value as StoredGraduation);
        return undefined as never;
      }
    );
    const c = client({
      createKeywords: vi.fn(async () => {
        order.push('amazon');
        return { success: [{ keywordId: 'KW-1' }], error: [] };
      }),
    });

    await applyGraduation({
      client: c,
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
    });

    expect(order[0]).toBe('record');
    expect(order).toContain('amazon');
  });

  it('carries the source CPC as the bid, not a default', async () => {
    // A default bid is the most common cause of "it did worse after I moved it".
    const c = client();
    await applyGraduation({
      client: c,
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
    });

    expect(c.createKeywords).toHaveBeenCalledWith([
      expect.objectContaining({
        campaignId: 'C-EXACT',
        adGroupId: 'G-EXACT',
        keywordText: 'french press',
        matchType: 'EXACT',
        bid: 1.35,
      }),
    ]);
  });

  it('schedules the backward negative rather than applying it', async () => {
    // Applying both at once switches off a proven source for an unproven
    // destination: traffic gaps rather than transfers.
    const c = client();
    const result = await applyGraduation({
      client: c,
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
      now: 1_000_000,
    });

    expect(c.createNegativeKeywords).not.toHaveBeenCalled();
    const [negative] =
      result.applied === true ? result.graduation.negatives : [];
    expect(negative.state).toBe('scheduled');
    expect(negative.matchType).toBe('negativeExact');
    expect(negative.dueAt).toBe(1_000_000 + 14 * 86_400_000);
    // Upstream, not downstream: the negative cuts the source.
    expect(negative.campaignId).toBe('C-AUTO');
  });

  it('does not create the keyword twice on a retry', async () => {
    const first = client();
    await applyGraduation({
      client: first,
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
    });

    const second = client();
    const result = await applyGraduation({
      client: second,
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
    });

    expect(result.applied).toBe('already');
    expect(second.createKeywords).not.toHaveBeenCalled();
  });

  it("records a rejected keyword as failed, with Amazon's reason", async () => {
    const c = client({
      createKeywords: vi.fn(async () => ({
        success: [],
        error: [
          {
            index: 0,
            errors: [{ errorType: 'DUPLICATE_VALUE', message: 'exists' }],
          },
        ],
      })),
    });

    const result = await applyGraduation({
      client: c,
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
    });

    expect(result.applied).toBe(false);
    expect(result.applied === false && result.reason).toContain('exists');
    expect(result.applied === false && result.graduation?.state).toBe('failed');
    // The scheduled negative survives on the failed record, so a later
    // reconciliation can see that nothing was cut for a graduation that never
    // happened.
    expect(
      result.applied === false ? result.graduation?.negatives.length : 0
    ).toBe(1);
  });
});

describe('the delivery gate', () => {
  const graduate = async (over: Record<string, unknown> = {}) => {
    const result = await applyGraduation({
      client: client(),
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
      now: 0,
      ...over,
    });
    return result;
  };

  const delivered = (over: Partial<DeliveryEvidence> = {}) =>
    new Map<string, DeliveryEvidence>([
      [
        'KW-1',
        {
          keywordId: 'KW-1',
          impressions: 900,
          clicks: 14,
          from: '2026-08-01',
          to: '2026-08-14',
          ...over,
        },
      ],
    ]);

  it('proposes the negative once the destination has delivered', async () => {
    await graduate();

    const [decision] = await dueNegativeDecisions({
      userId: USER,
      delivery: delivered(),
      now: 20 * 86_400_000,
    });

    expect(decision.propose).toBe(true);
    expect(decision.propose === true && decision.proposal.campaignId).toBe(
      'C-AUTO'
    );
  });

  it('REFUSES when the destination served nothing, and says what to do', async () => {
    // Cutting a live source while the destination sits at zero is the one
    // outcome that turns a graduation into lost sales.
    await graduate();

    const [decision] = await dueNegativeDecisions({
      userId: USER,
      delivery: delivered({ impressions: 0, clicks: 0 }),
      now: 20 * 86_400_000,
    });

    expect(decision.propose).toBe(false);
    expect(decision.propose === false && decision.reason).toMatch(
      /0 impressions/
    );
    // Never silent: a funnel that stops halfway with no reason is worse than
    // one that asks.
    expect(
      decision.propose === false && decision.remedy.length
    ).toBeGreaterThan(0);
    expect(decision.propose === false && decision.remedy.join(' ')).toMatch(
      /budget-capped|Raise the bid/
    );
  });

  it('distinguishes "not serving" from "we cannot tell"', async () => {
    // Absent rows are not zero impressions, and the remedies differ.
    await graduate();

    const [decision] = await dueNegativeDecisions({
      userId: USER,
      delivery: new Map(),
      now: 20 * 86_400_000,
    });

    expect(decision.propose).toBe(false);
    expect(decision.propose === false && decision.reason).toMatch(/unknown/);
    expect(decision.propose === false && decision.remedy.join(' ')).toMatch(
      /Sync ads reports/
    );
  });

  it('refuses when the graduation never got its keyword', async () => {
    // Nothing to move traffic to, so cutting upstream just removes it.
    await applyGraduation({
      client: client({
        createKeywords: vi.fn(async () => ({
          success: [],
          error: [{ index: 0, errors: [{ message: 'nope' }] }],
        })),
      }),
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
      now: 0,
    });

    const [decision] = await dueNegativeDecisions({
      userId: USER,
      delivery: delivered(),
      now: 20 * 86_400_000,
    });

    expect(decision.propose).toBe(false);
    expect(decision.propose === false && decision.reason).toMatch(
      /no destination keyword/
    );
  });
});

describe('applyBackwardNegative', () => {
  const graduated = async () =>
    applyGraduation({
      client: client(),
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
      now: 0,
    });

  it('cuts the source and records the negative id', async () => {
    await graduated();
    const c = client();

    const result = await applyBackwardNegative({
      client: c,
      userId: USER,
      graduationId: PROPOSAL.graduationId,
      now: 5,
    });

    expect(result.applied).toBe(true);
    expect(c.createNegativeKeywords).toHaveBeenCalledWith([
      expect.objectContaining({
        campaignId: 'C-AUTO',
        keywordText: 'french press',
        matchType: 'NEGATIVE_EXACT',
      }),
    ]);
    const [negative] = result.applied ? result.graduation.negatives : [];
    expect(negative.state).toBe('applied');
    expect(negative.negativeKeywordId).toBe('NEG-1');
  });

  it('records a failure rather than losing it — this is the dangerous partial', async () => {
    // Keyword created downstream, source never cut: the seller bids against
    // themselves and nothing says so unless this state is written down.
    await graduated();

    const result = await applyBackwardNegative({
      client: client({
        createNegativeKeywords: vi.fn(async () => ({
          success: [],
          error: [{ index: 0, errors: [{ message: 'ad group not found' }] }],
        })),
      }),
      userId: USER,
      graduationId: PROPOSAL.graduationId,
    });

    expect(result.applied).toBe(false);
    const [negative] = result.graduation ? result.graduation.negatives : [];
    expect(negative.state).toBe('failed');
    expect(negative.note).toContain('ad group not found');
  });

  it('refuses when the destination keyword was never created', async () => {
    await applyGraduation({
      client: client({
        createKeywords: vi.fn(async () => ({
          success: [],
          error: [{ index: 0, errors: [{ message: 'nope' }] }],
        })),
      }),
      userId: USER,
      funnelId: 'f-1',
      profileId: 'P1',
      proposal: PROPOSAL,
    });

    const c = client();
    const result = await applyBackwardNegative({
      client: c,
      userId: USER,
      graduationId: PROPOSAL.graduationId,
    });

    expect(result.applied).toBe(false);
    expect(c.createNegativeKeywords).not.toHaveBeenCalled();
  });
});

describe('deliveryFromRows', () => {
  const GRADUATION = {
    term: 'french press',
    keywordId: 'K-dest',
    toCampaignId: 'C-exact',
    toAdGroupId: 'AG-exact',
  };

  const ROW = (over: Record<string, unknown> = {}) => ({
    campaignId: 'C-exact',
    adGroupId: 'AG-exact',
    searchTerm: 'french press',
    impressions: 100,
    clicks: 5,
    ...over,
  });

  it('does NOT credit the source campaign for the destination', () => {
    // The bug this function exists to prevent. During the overlap the SOURCE is
    // still serving this term — that is the whole point of the overlap — so a
    // term-only match finds rows and reports the destination as delivering.
    // The negative then cuts a live source in favour of a keyword that has
    // never served: the exact outcome the gate is supposed to hold back, waved
    // through BY the gate.
    const delivery = deliveryFromRows({
      rows: [ROW({ campaignId: 'C-auto', adGroupId: 'AG-auto' })],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.has('K-dest')).toBe(false);
  });

  it('counts the destination campaign, and sums it', () => {
    const delivery = deliveryFromRows({
      rows: [ROW(), ROW({ impressions: 40, clicks: 2 })],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.get('K-dest')).toMatchObject({
      impressions: 140,
      clicks: 7,
      from: '2026-08-01',
      to: '2026-08-14',
    });
  });

  it('keeps source and destination rows apart when both are present', () => {
    // The realistic shape mid-overlap: both campaigns serving the same term.
    // Only the destination's 40 impressions may reach the gate.
    const delivery = deliveryFromRows({
      rows: [
        ROW({ campaignId: 'C-auto', adGroupId: 'AG-auto', impressions: 900 }),
        ROW({ impressions: 40 }),
      ],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.get('K-dest')?.impressions).toBe(40);
  });

  it('drops a row that cannot be attributed to a campaign', () => {
    // Console-CSV uploads carry no ids. Unattributable is not "the destination"
    // — it leaves the map empty, and the decision layer refuses with a remedy
    // rather than cutting on evidence that was never about this campaign.
    const delivery = deliveryFromRows({
      rows: [ROW({ campaignId: undefined, adGroupId: undefined })],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.has('K-dest')).toBe(false);
  });

  it('rejects the right campaign but the wrong ad group', () => {
    const delivery = deliveryFromRows({
      rows: [ROW({ adGroupId: 'AG-other' })],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.has('K-dest')).toBe(false);
  });

  it('accepts a destination row that carries no ad group', () => {
    // Weaker evidence than a matching ad group, but still this campaign's.
    // Dropping it would refuse a gate that stored data can actually answer.
    const delivery = deliveryFromRows({
      rows: [ROW({ adGroupId: undefined })],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.get('K-dest')?.impressions).toBe(100);
  });

  it('leaves a keyword with no rows ABSENT, never zero', () => {
    // "Not measured" and "measured and dead" lead to different decisions, and
    // only one of them is safe to act on.
    const delivery = deliveryFromRows({
      rows: [],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.has('K-dest')).toBe(false);
  });

  it('skips a graduation that never created a keyword', () => {
    const delivery = deliveryFromRows({
      rows: [ROW()],
      graduations: [{ ...GRADUATION, keywordId: null } as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.size).toBe(0);
  });

  it('matches the term case-insensitively', () => {
    const delivery = deliveryFromRows({
      rows: [ROW({ searchTerm: 'French Press' })],
      graduations: [GRADUATION as never],
      from: '2026-08-01',
      to: '2026-08-14',
    });

    expect(delivery.get('K-dest')?.impressions).toBe(100);
  });
});
