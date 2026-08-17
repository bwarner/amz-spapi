import { describe, expect, it } from 'vitest';
import {
  createCampaignTree,
  describeItemError,
  levelResult,
  type AdCampaignTreeRequest,
  type CampaignTreeWriter,
} from './campaign-tree.js';
import type { AdsMutationResult } from './ad-client.js';

/**
 * Building a campaign tree (#146).
 *
 * No HTTP here on purpose. What is under test is the decision layer: which
 * levels get attempted, when to stop, and whether the tree that exists can
 * serve. Injecting the four creates makes each 207 shape a one-line fixture
 * instead of a mocked transport.
 *
 * Every other write in this package can be undone by a second call. None of
 * this can — Amazon has no delete that returns a campaign to not-existing — so
 * the tests are mostly about the two things that keep it safe: nothing is
 * created ENABLED, and a partial tree is never reported as success.
 */

const ok = (items: Array<Record<string, unknown>>): AdsMutationResult => ({
  success: items,
  error: [],
});
const failed = (
  index: number,
  message: string,
  errorType?: string
): AdsMutationResult => ({
  success: [],
  error: [
    { index, errors: [{ ...(errorType ? { errorType } : {}), message }] },
  ],
});

/**
 * The four creates, recording the order they were attempted in.
 *
 * `calls` is the assertion for "stopped at the right level" — an override still
 * records, so a failing level is visible in the log as attempted-and-failed
 * rather than absent.
 */
function writer(overrides: Partial<CampaignTreeWriter> = {}) {
  const calls: string[] = [];
  const defaults = {
    createCampaigns: ok([{ campaignId: 'C1' }]),
    createAdGroups: ok([{ adGroupId: 'G1' }]),
    createProductAds: ok([{ adId: 'A1' }]),
    createKeywords: ok([{ keywordId: 'K1' }]),
  } as const;

  const build = <K extends keyof CampaignTreeWriter>(key: K) =>
    (async (items: never) => {
      calls.push(key);
      return overrides[key]
        ? (overrides[key] as (i: never) => Promise<AdsMutationResult>)(items)
        : defaults[key];
    }) as CampaignTreeWriter[K];

  return {
    writer: {
      createCampaigns: build('createCampaigns'),
      createAdGroups: build('createAdGroups'),
      createProductAds: build('createProductAds'),
      createKeywords: build('createKeywords'),
    } satisfies CampaignTreeWriter,
    calls,
  };
}

const MANUAL: AdCampaignTreeRequest = {
  name: 'SP - Exact - French Press',
  targetingType: 'MANUAL',
  dailyBudget: 25,
  adGroup: { name: 'Core', defaultBid: 0.75 },
  products: [{ sku: 'FP-24OZ' }],
  keywords: [{ keywordText: 'french press', matchType: 'EXACT' }],
};

describe('a complete tree', () => {
  it('is servable, and says it is not running', async () => {
    const { writer: w, calls } = writer();
    const result = await createCampaignTree(w, MANUAL);

    expect(calls).toEqual([
      'createCampaigns',
      'createAdGroups',
      'createProductAds',
      'createKeywords',
    ]);
    expect(result.servable).toBe(true);
    expect(result.campaign.campaignId).toBe('C1');
    expect(result.adGroup.adGroupId).toBe('G1');
    // "Created" reads as "running" and must not be allowed to.
    expect(result.remediation.join(' ')).toMatch(/PAUSED and spending nothing/);
  });

  it('needs no keywords for an AUTO campaign', async () => {
    const { writer: w, calls } = writer();
    const result = await createCampaignTree(w, {
      name: 'Auto - Discovery',
      targetingType: 'AUTO',
      dailyBudget: 10,
      adGroup: { name: 'Discovery', defaultBid: 0.5 },
      products: [{ sku: 'FP-24OZ' }],
    });

    expect(result.servable).toBe(true);
    expect(calls).not.toContain('createKeywords');
  });
});

describe('stopping when a level fails', () => {
  it('attempts nothing further when the campaign fails', async () => {
    const { writer: w, calls } = writer({
      createCampaigns: async () => failed(0, 'name exists', 'DUPLICATE_VALUE'),
    });
    const result = await createCampaignTree(w, MANUAL);

    expect(calls).toEqual(['createCampaigns']);
    expect(result.campaign.created).toBe(false);
    expect(result.campaign.error).toContain('name exists');
    expect(result.campaign.error).toContain('DUPLICATE_VALUE');
    expect(result.servable).toBe(false);
    // The only clean failure: nothing exists, so nothing needs cleaning up.
    expect(result.remediation).toEqual([
      'Nothing was created. Fix the reported error and retry.',
    ]);
  });

  it('keeps the campaign id when the ad group fails, because there is no rollback', async () => {
    // Throwing would discard the id of what Amazon already created — the only
    // handle for finishing or archiving it.
    const { writer: w, calls } = writer({
      createAdGroups: async () => failed(0, 'bid below floor'),
    });
    const result = await createCampaignTree(w, MANUAL);

    expect(calls).toEqual(['createCampaigns', 'createAdGroups']);
    expect(result.campaign.created).toBe(true);
    expect(result.campaign.campaignId).toBe('C1');
    expect(result.adGroup.created).toBe(false);
    expect(result.servable).toBe(false);
    expect(result.remediation.join(' ')).toContain('C1');
    expect(result.remediation.join(' ')).toMatch(/cannot archive/);
  });

  it('reports requested counts for levels it never reached', async () => {
    // Zero created out of zero requested would read as "nothing was asked for".
    const { writer: w } = writer({
      createCampaigns: async () => failed(0, 'nope'),
    });
    const result = await createCampaignTree(w, {
      ...MANUAL,
      products: [{ sku: 'A' }, { sku: 'B' }],
    });

    expect(result.productAds).toEqual({
      requested: 2,
      created: 0,
      failures: [],
    });
  });
});

describe('servable is computed from the tree, not from the absence of errors', () => {
  it('is false when every product ad fails, though the campaign exists', async () => {
    // The dangerous outcome: a campaign that looks created and can never show
    // an impression.
    const { writer: w } = writer({
      createProductAds: async () => failed(0, 'sku not found'),
    });
    const result = await createCampaignTree(w, MANUAL);

    expect(result.campaign.created).toBe(true);
    expect(result.adGroup.created).toBe(true);
    expect(result.servable).toBe(false);
    expect(result.remediation.join(' ')).toMatch(/No product ads/);
  });

  it('is true when only SOME product ads fail, and names which', async () => {
    const { writer: w } = writer({
      createProductAds: async () => ({
        success: [{ adId: 'A1' }],
        error: [{ index: 1, errors: [{ message: 'sku not found' }] }],
      }),
    });
    const result = await createCampaignTree(w, {
      ...MANUAL,
      products: [{ sku: 'FP-24OZ' }, { sku: 'GONE-SKU' }],
    });

    expect(result.servable).toBe(true);
    // Named by the caller's own label — "one of these failed" is not actionable.
    expect(result.productAds.failures).toEqual([
      { item: 'GONE-SKU', error: 'sku not found' },
    ]);
    expect(result.remediation.join(' ')).toMatch(/1 of 2 product ads failed/);
  });

  it('is false when a MANUAL campaign gets no keywords', async () => {
    const { writer: w } = writer({
      createKeywords: async () => failed(0, 'blocked term'),
    });
    const result = await createCampaignTree(w, MANUAL);

    expect(result.servable).toBe(false);
    expect(result.remediation.join(' ')).toMatch(/No keywords/);
  });

  it('never leaves remediation empty when the tree cannot serve', async () => {
    for (const override of [
      { createCampaigns: async () => failed(0, 'x') },
      { createAdGroups: async () => failed(0, 'x') },
      { createProductAds: async () => failed(0, 'x') },
      { createKeywords: async () => failed(0, 'x') },
    ]) {
      const { writer: w } = writer(override as Partial<CampaignTreeWriter>);
      const result = await createCampaignTree(w, MANUAL);
      expect(result.servable).toBe(false);
      expect(result.remediation.length).toBeGreaterThan(0);
    }
  });

  it('attempts keywords even when the product ads failed', async () => {
    // Siblings: one failing must not hide the other's problem, so a seller
    // learns about both in one pass rather than two.
    const { writer: w, calls } = writer({
      createProductAds: async () => failed(0, 'sku not found'),
    });
    await createCampaignTree(w, MANUAL);

    expect(calls).toContain('createProductAds');
    expect(calls).toContain('createKeywords');
  });
});

describe('refusals, before anything is created', () => {
  it.each([
    ['no products', { products: [] }, /can never serve/],
    [
      'MANUAL with no keywords',
      { keywords: [] },
      /MANUAL but names no keywords/,
    ],
    [
      'AUTO with keywords',
      { targetingType: 'AUTO' as const },
      /AUTO, which chooses its own targets/,
    ],
  ])('refuses %s', async (_label, patch, expected) => {
    const { writer: w, calls } = writer();
    await expect(
      createCampaignTree(w, { ...MANUAL, ...patch })
    ).rejects.toThrow(expected);
    // Refused locally: Amazon was never called, so nothing needs cleaning up.
    expect(calls).toEqual([]);
  });
});

describe('describeItemError', () => {
  it("reads Amazon's nested errors array as a sentence", () => {
    expect(
      describeItemError({
        index: 0,
        errors: [{ errorType: 'INVALID_ARGUMENT', message: 'budget too low' }],
      })
    ).toBe('INVALID_ARGUMENT: budget too low');
  });

  it('joins several errors on one item', () => {
    expect(
      describeItemError({
        errors: [{ message: 'first' }, { message: 'second' }],
      })
    ).toBe('first; second');
  });

  it('falls back rather than losing an unfamiliar shape', () => {
    // Printing something ugly beats dropping the only diagnostic there is.
    expect(describeItemError({ weird: true })).toBe('{"weird":true}');
  });
});

describe('levelResult', () => {
  it('maps a failure to its item by index', () => {
    const result = levelResult(
      {
        success: [{ adId: '1' }],
        error: [{ index: 2, errors: [{ message: 'bad' }] }],
      },
      ['a', 'b', 'c']
    );

    expect(result).toEqual({
      requested: 3,
      created: 1,
      failures: [{ item: 'c', error: 'bad' }],
    });
  });

  it('says so rather than guessing when Amazon omits the index', () => {
    const result = levelResult(
      { success: [], error: [{ errors: [{ message: 'bad' }] }] },
      ['a']
    );

    expect(result.failures[0].item).toBe('(unidentified item)');
  });
});
