import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Funnel, Graduation } from '@farvisionllc/models';
import {
  FunnelStoreError,
  funnelStorage,
  getFunnel,
  listDueNegatives,
  recordGraduation,
  settleGraduation,
  storeFunnel,
} from './funnel-store.js';

/**
 * The judgement here: the graduation id IS the idempotency key, so a retry can
 * never create a second keyword for a term that already graduated — and
 * `keywordId`, once written, is never quietly replaced. Couchbase is a seam.
 */

const stored = new Map<string, unknown>();

beforeEach(() => {
  stored.clear();
  vi.spyOn(funnelStorage, 'upsertDocument').mockImplementation(
    async (_scope, _collection, key, value) => {
      stored.set(key as string, value);
      return true as never;
    }
  );
  vi.spyOn(funnelStorage, 'getDocument').mockImplementation(
    async (_scope, _collection, key) =>
      (stored.get(key as string) ?? null) as never
  );
  vi.spyOn(funnelStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: [...stored.values()] } as never)
  );
});

function funnel(overrides: Partial<Funnel> = {}): Funnel {
  return {
    funnelId: 'f1',
    profileId: 'p1',
    name: 'Gran del Val',
    nodes: [
      {
        nodeId: 'auto',
        campaignId: 'c1',
        adGroupId: 'a1',
        role: 'auto',
        advertisedProductIds: ['B0TEAPOT'],
      },
      {
        nodeId: 'exact',
        campaignId: 'c2',
        adGroupId: 'a2',
        role: 'exact',
        advertisedProductIds: ['B0TEAPOT'],
      },
    ],
    edges: [],
    ...overrides,
  } as Funnel;
}

function graduation(overrides: Partial<Graduation> = {}): Graduation {
  return {
    graduationId: 'f1::auto::exact::glass teapot',
    funnelId: 'f1',
    profileId: 'p1',
    term: 'glass teapot',
    variants: ['glass teapot'],
    fromNodeId: 'auto',
    toNodeId: 'exact',
    fromCampaignId: 'c1',
    fromAdGroupId: 'a1',
    toCampaignId: 'c2',
    toAdGroupId: 'a2',
    fromRole: 'auto',
    toRole: 'exact',
    matchType: 'exact',
    keywordId: null,
    bid: 0.88,
    sourceCpc: 0.8,
    evidence: {
      impressions: 900,
      clicks: 30,
      orders: 4,
      spend: 24,
      sales: 120,
      acos: 0.2,
      from: '2026-06-06',
      to: '2026-08-04',
      attributionDays: 14,
      rows: 1,
    },
    productScopeChecked: true,
    negatives: [],
    state: 'proposed',
    proposedAt: 1_760_000_000_000,
    ...overrides,
  } as Graduation;
}

describe('storeFunnel', () => {
  it('round-trips a funnel for its owner', async () => {
    await storeFunnel({ userId: 'auth0|seller', funnel: funnel() });
    const found = await getFunnel('auth0|seller', 'f1');
    expect(found?.funnel.name).toBe('Gran del Val');
  });

  it('does not hand a funnel to another user who guessed the id', async () => {
    await storeFunnel({ userId: 'auth0|seller', funnel: funnel() });
    expect(await getFunnel('auth0|intruder', 'f1')).toBeNull();
  });

  it('refuses an edge pointing at a node that does not exist', async () => {
    // Otherwise this surfaces days later, inside a harvest, somewhere else.
    await expect(
      storeFunnel({
        userId: 'auth0|seller',
        funnel: funnel({
          edges: [{ from: 'auto', to: 'ghost', policy: {} }] as Funnel['edges'],
        }),
      })
    ).rejects.toThrow(FunnelStoreError);
  });

  it('refuses a node that feeds itself', async () => {
    // A self-edge would create a keyword and schedule a negative for the same
    // term in the same ad group, in one run.
    await expect(
      storeFunnel({
        userId: 'auth0|seller',
        funnel: funnel({
          edges: [{ from: 'auto', to: 'auto', policy: {} }] as Funnel['edges'],
        }),
      })
    ).rejects.toThrow(/feeds itself/);
  });

  it('keeps the original storedAt when a funnel is edited', async () => {
    const first = await storeFunnel({ userId: 'u', funnel: funnel() });
    const second = await storeFunnel({
      userId: 'u',
      funnel: funnel({ name: 'Renamed' }),
    });
    expect(second.storedAt).toBe(first.storedAt);
  });
});

describe('recordGraduation', () => {
  it('stores the first one', async () => {
    const result = await recordGraduation({
      userId: 'u',
      graduation: graduation(),
    });
    expect(result.stored).toBe(true);
  });

  it('refuses the second, returning what is already on record', async () => {
    // A retried run must not create a second keyword for the same term, and
    // must not overwrite the evidence the first decision was made on.
    await recordGraduation({ userId: 'u', graduation: graduation() });
    const again = await recordGraduation({
      userId: 'u',
      graduation: graduation({ bid: 9.99 }),
    });
    expect(again.stored).toBe(false);
    if (again.stored) return;
    expect(again.existing.graduation.bid).toBe(0.88);
  });
});

describe('settleGraduation', () => {
  it('records the created keyword and stamps appliedAt', async () => {
    await recordGraduation({ userId: 'u', graduation: graduation() });
    const settled = await settleGraduation({
      userId: 'u',
      graduationId: 'f1::auto::exact::glass teapot',
      keywordId: 'kw-1',
      state: 'applied',
    });
    expect(settled.graduation.keywordId).toBe('kw-1');
    expect(settled.graduation.appliedAt).toBeGreaterThan(0);
  });

  it('refuses to replace a keywordId that is already set', async () => {
    // Two keywords for one graduation is a duplicate downstream — something to
    // investigate, not a value to overwrite.
    await recordGraduation({ userId: 'u', graduation: graduation() });
    await settleGraduation({
      userId: 'u',
      graduationId: 'f1::auto::exact::glass teapot',
      keywordId: 'kw-1',
      state: 'applied',
    });
    await expect(
      settleGraduation({
        userId: 'u',
        graduationId: 'f1::auto::exact::glass teapot',
        keywordId: 'kw-2',
      })
    ).rejects.toThrow(/already created keyword kw-1/);
  });

  it('is idempotent when the same keywordId is settled twice', async () => {
    await recordGraduation({ userId: 'u', graduation: graduation() });
    const params = {
      userId: 'u',
      graduationId: 'f1::auto::exact::glass teapot',
      keywordId: 'kw-1',
      state: 'applied' as const,
    };
    const first = await settleGraduation(params);
    const second = await settleGraduation(params);
    // A retry must not move the applied timestamp, which is when it happened.
    expect(second.graduation.appliedAt).toBe(first.graduation.appliedAt);
  });

  it('refuses to settle a graduation nobody recorded', async () => {
    await expect(
      settleGraduation({ userId: 'u', graduationId: 'nope' })
    ).rejects.toThrow(FunnelStoreError);
  });
});

describe('listDueNegatives', () => {
  it('asks only for applied graduations with a scheduled, due negative', async () => {
    // The query itself is the self-competition detector, so its shape is the
    // thing under test: the seam returns everything and the WHERE clause is
    // what has to be right.
    await listDueNegatives({ userId: 'u', now: 1_770_000_000_000 });
    const [, statement, options] = vi.mocked(funnelStorage.executeQuery).mock
      .calls[0];
    expect(statement).toContain("g.`graduation`.`state` = 'applied'");
    expect(statement).toContain("n.`state` = 'scheduled'");
    expect(statement).toContain('n.`dueAt` <= $now');
    expect(
      (options as { parameters: Record<string, unknown> }).parameters['now']
    ).toBe(1_770_000_000_000);
  });
});
