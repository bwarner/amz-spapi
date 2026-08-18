import { describe, expect, it } from 'vitest';
import {
  FunnelSchema,
  GraduationPolicySchema,
  WASTE_BY_OBJECTIVE,
  acosOf,
  defaultObjectiveForRole,
  graduationId,
  normalizeSearchTerm,
  termFamilyKey,
} from './ads-funnel.js';

/**
 * The judgement here: a term and its close variants share ONE key, so the same
 * query cannot graduate twice, and the folding is narrow enough that two
 * genuinely different queries never collapse into one decision.
 */

describe('normalizeSearchTerm', () => {
  it('folds case and runs of whitespace, which vary row to row', () => {
    expect(normalizeSearchTerm('  French   PRESS ')).toBe('french press');
  });
});

describe('termFamilyKey', () => {
  it('folds a trailing plural so exact does not get two keywords', () => {
    expect(termFamilyKey('french presses')).toBe(termFamilyKey('french press'));
    expect(termFamilyKey('teapots')).toBe(termFamilyKey('teapot'));
  });

  it('only folds the LAST word, so the qualifier still separates queries', () => {
    expect(termFamilyKey('glass teapot')).not.toBe(termFamilyKey('teapot'));
  });

  it('leaves short words alone rather than inventing a stem', () => {
    // "gas" -> "ga" would merge unrelated queries; the stem length guard is
    // what stops the fold being cleverer than it can justify.
    expect(termFamilyKey('gas')).toBe('gas');
    expect(termFamilyKey('glass')).toBe('glass');
  });
});

describe('graduationId', () => {
  it('is stable across close variants, so a retry proposes nothing new', () => {
    const base = { funnelId: 'f1', fromNodeId: 'auto', toNodeId: 'exact' };
    expect(graduationId({ ...base, term: 'French Presses' })).toBe(
      graduationId({ ...base, term: 'french press' })
    );
  });

  it('separates the same term on different edges', () => {
    const term = 'french press';
    expect(
      graduationId({
        funnelId: 'f1',
        fromNodeId: 'auto',
        toNodeId: 'exact',
        term,
      })
    ).not.toBe(
      graduationId({
        funnelId: 'f1',
        fromNodeId: 'broad',
        toNodeId: 'exact',
        term,
      })
    );
  });
});

describe('acosOf', () => {
  it('is undefined with no sales, never 0', () => {
    // 0 would rank pure waste as perfectly efficient.
    expect(acosOf(12, 0)).toBeUndefined();
    expect(acosOf(10, 40)).toBeCloseTo(0.25);
  });
});

describe('objectives', () => {
  it('treats phrase as discovery — it exists to gather data', () => {
    expect(defaultObjectiveForRole('auto')).toBe('discovery');
    expect(defaultObjectiveForRole('broad')).toBe('discovery');
    expect(defaultObjectiveForRole('phrase')).toBe('discovery');
    expect(defaultObjectiveForRole('exact')).toBe('profit');
  });

  it('switches the waste rule OFF for launch and defensive', () => {
    expect(WASTE_BY_OBJECTIVE.launch).toBeNull();
    expect(WASTE_BY_OBJECTIVE.defensive).toBeNull();
    // Discovery is patient relative to profit, not merely different.
    expect(WASTE_BY_OBJECTIVE.discovery?.minClicks).toBeGreaterThan(
      WASTE_BY_OBJECTIVE.profit?.minClicks as number
    );
  });
});

describe('GraduationPolicySchema', () => {
  it('defaults every threshold, so a policy is never half-specified', () => {
    const policy = GraduationPolicySchema.parse({});
    expect(policy.overlapDays).toBe(14);
    expect(policy.productScope).toBe('exact');
    expect(policy.bidUplift).toBeGreaterThan(1);
    // Undefined rather than 0: "do not judge efficiency" is a real setting.
    expect(policy.maxAcos).toBeUndefined();
  });
});

describe('FunnelSchema', () => {
  it('accepts a funnel with no edges — adoption maps nodes first', () => {
    const funnel = FunnelSchema.parse({
      funnelId: 'f1',
      profileId: 'p1',
      name: 'Gran del Val',
      nodes: [
        {
          nodeId: 'auto',
          campaignId: 'c1',
          adGroupId: 'a1',
          role: 'auto',
          advertisedProductIds: ['B01'],
        },
      ],
    });
    expect(funnel.edges).toEqual([]);
  });
});
