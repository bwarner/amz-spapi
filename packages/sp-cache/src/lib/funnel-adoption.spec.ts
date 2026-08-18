import { describe, expect, it } from 'vitest';
import {
  inferFunnelTopology,
  type AdoptionAdGroup,
  type AdoptionCampaign,
  type AdoptionKeyword,
  type AdoptionProductAd,
  type InferFunnelParams,
} from './funnel-adoption.js';

/**
 * The judgement here: the role is read from the ACCOUNT, not from the name.
 *
 * Names are the tempting signal and the wrong one — they are one seller's
 * convention, they break on a console rename, and depending on them is exactly
 * what the funnel design refuses. So the tests below deliberately name things
 * misleadingly and check the targeting wins.
 */

const READ_AT = 1_760_000_000_000;

function campaign(
  overrides: Partial<AdoptionCampaign> & { campaignId: string }
): AdoptionCampaign {
  return { targetingType: 'MANUAL', state: 'ENABLED', ...overrides };
}

function adGroup(
  overrides: Partial<AdoptionAdGroup> & {
    adGroupId: string;
    campaignId: string;
  }
): AdoptionAdGroup {
  return { state: 'ENABLED', ...overrides };
}

function keyword(
  adGroupId: string,
  matchType: string,
  extra: Partial<AdoptionKeyword> = {}
): AdoptionKeyword {
  return {
    adGroupId,
    campaignId: 'c-manual',
    matchType,
    state: 'ENABLED',
    ...extra,
  };
}

function productAd(
  adGroupId: string,
  asin: string,
  extra: Partial<AdoptionProductAd> = {}
): AdoptionProductAd {
  return {
    adGroupId,
    campaignId: 'c-manual',
    asin,
    state: 'ENABLED',
    ...extra,
  };
}

function infer(overrides: Partial<InferFunnelParams> = {}) {
  return inferFunnelTopology({
    profileId: 'p1',
    funnelId: 'f1',
    name: 'Gran del Val',
    readAt: READ_AT,
    campaigns: [
      campaign({
        campaignId: 'c-auto',
        targetingType: 'AUTO',
        name: 'Auto - Catch all',
      }),
      campaign({ campaignId: 'c-manual', name: 'SP - Exact - Gran del Val' }),
    ],
    adGroups: [
      adGroup({
        adGroupId: 'ag-auto',
        campaignId: 'c-auto',
        name: 'Ad Group 1',
      }),
      adGroup({ adGroupId: 'ag-exact', campaignId: 'c-manual', name: 'Exact' }),
    ],
    keywords: [keyword('ag-exact', 'EXACT')],
    productAds: [
      productAd('ag-auto', 'B0TEAPOT'),
      productAd('ag-exact', 'B0TEAPOT'),
    ],
    ...overrides,
  });
}

describe('reading the role from the account', () => {
  it('makes an AUTO campaign’s ad group an auto node', () => {
    const auto = infer().funnel.nodes.find((n) => n.adGroupId === 'ag-auto');
    expect(auto?.role).toBe('auto');
  });

  it('reads a manual ad group’s role from its keywords’ match type', () => {
    const exact = infer().funnel.nodes.find((n) => n.adGroupId === 'ag-exact');
    expect(exact?.role).toBe('exact');
  });

  it('ignores the NAME entirely, even when it contradicts the targeting', () => {
    // The whole point: a campaign called "Phrase" whose keywords are broad is
    // a broad node. Trusting the name here is how a rename re-wires a funnel.
    const result = infer({
      campaigns: [
        campaign({ campaignId: 'c-manual', name: 'SP - Phrase - X' }),
      ],
      adGroups: [
        adGroup({
          adGroupId: 'ag-1',
          campaignId: 'c-manual',
          name: 'Exact terms',
        }),
      ],
      keywords: [keyword('ag-1', 'BROAD')],
      productAds: [productAd('ag-1', 'B0TEAPOT')],
    });
    expect(result.funnel.nodes[0].role).toBe('broad');
    // The name still travels, as the join alias for id-less console exports.
    expect(result.funnel.nodes[0].adGroupName).toBe('Exact terms');
  });

  it('reports a B/P/E ad group as mixed rather than guessing quietly', () => {
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [adGroup({ adGroupId: 'ag-bpe', campaignId: 'c-manual' })],
      keywords: [
        keyword('ag-bpe', 'EXACT'),
        keyword('ag-bpe', 'EXACT'),
        keyword('ag-bpe', 'PHRASE'),
      ],
      productAds: [productAd('ag-bpe', 'B0TEAPOT')],
    });
    expect(result.funnel.nodes[0].role).toBe('exact');
    expect(result.mixed).toEqual([
      { adGroupId: 'ag-bpe', chosen: 'exact', counts: { exact: 2, phrase: 1 } },
    ]);
  });

  it('breaks a tie toward the STRICTER role', () => {
    // A node treated as exact is judged on the strictest thresholds. Erring
    // that way makes the funnel cautious about promoting, not eager.
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [adGroup({ adGroupId: 'ag-tie', campaignId: 'c-manual' })],
      keywords: [keyword('ag-tie', 'BROAD'), keyword('ag-tie', 'EXACT')],
      productAds: [productAd('ag-tie', 'B0TEAPOT')],
    });
    expect(result.funnel.nodes[0].role).toBe('exact');
  });
});

describe('what it refuses to place', () => {
  it('skips a manual ad group with no keywords, and says why', () => {
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [
        adGroup({
          adGroupId: 'ag-pt',
          campaignId: 'c-manual',
          name: 'Product targeting',
        }),
      ],
      keywords: [],
      productAds: [],
    });
    expect(result.funnel.nodes).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('product-targeted');
    expect(result.skipped[0].name).toBe('Product targeting');
  });

  it('excludes archived ad groups, campaigns and keywords', () => {
    // An archived object cannot serve and cannot be revived, so a node on one
    // is an edge that silently never fires.
    const result = infer({
      campaigns: [
        campaign({
          campaignId: 'c-auto',
          targetingType: 'AUTO',
          state: 'ARCHIVED',
        }),
        campaign({ campaignId: 'c-manual' }),
      ],
      adGroups: [
        adGroup({ adGroupId: 'ag-auto', campaignId: 'c-auto' }),
        adGroup({
          adGroupId: 'ag-old',
          campaignId: 'c-manual',
          state: 'ARCHIVED',
        }),
        adGroup({ adGroupId: 'ag-live', campaignId: 'c-manual' }),
      ],
      keywords: [
        keyword('ag-live', 'EXACT'),
        keyword('ag-live', 'BROAD', { state: 'ARCHIVED' }),
      ],
      productAds: [productAd('ag-live', 'B0TEAPOT')],
    });

    expect(result.funnel.nodes.map((n) => n.adGroupId)).toEqual(['ag-live']);
    // The archived BROAD keyword must not drag the role away from exact.
    expect(result.funnel.nodes[0].role).toBe('exact');
    // The ad group under the archived campaign is reported, not dropped.
    expect(result.skipped.map((s) => s.adGroupId)).toContain('ag-auto');
  });
});

describe('product scope', () => {
  it('collects deduplicated ASINs and stamps when they were read', () => {
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [adGroup({ adGroupId: 'ag-1', campaignId: 'c-manual' })],
      keywords: [keyword('ag-1', 'EXACT')],
      productAds: [
        productAd('ag-1', 'B0KETTLE'),
        productAd('ag-1', 'B0TEAPOT'),
        productAd('ag-1', 'B0TEAPOT'),
      ],
    });
    expect(result.funnel.nodes[0].advertisedProductIds).toEqual([
      'B0KETTLE',
      'B0TEAPOT',
    ]);
    expect(result.funnel.nodes[0].productsReadAt).toBe(READ_AT);
  });

  it('stamps productsReadAt even when the ad group advertises nothing', () => {
    // "Read, and there were none" and "never looked" both fail the scope gate,
    // but only the second should send someone back to the API. The timestamp
    // is the only thing that tells them apart.
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [adGroup({ adGroupId: 'ag-1', campaignId: 'c-manual' })],
      keywords: [keyword('ag-1', 'EXACT')],
      productAds: [],
    });
    expect(result.funnel.nodes[0].advertisedProductIds).toEqual([]);
    expect(result.funnel.nodes[0].productsReadAt).toBe(READ_AT);
  });

  it('does not set an objective — it is derived from the role', () => {
    // Freezing today's role→objective mapping onto every adopted node would
    // mean a later change to that mapping silently skipped them.
    expect(infer().funnel.nodes[0].objective).toBeUndefined();
  });
});

describe('the proposed topology', () => {
  it('points discovery at focus, and never the other way', () => {
    const edges = infer().funnel.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].from).toBe('auto');
    expect(edges[0].to).toBe('exact');
  });

  it('treats broad as both a destination for auto and a source for exact', () => {
    const result = infer({
      campaigns: [
        campaign({ campaignId: 'c-auto', targetingType: 'AUTO' }),
        campaign({ campaignId: 'c-manual' }),
      ],
      adGroups: [
        adGroup({ adGroupId: 'ag-auto', campaignId: 'c-auto' }),
        adGroup({ adGroupId: 'ag-broad', campaignId: 'c-manual' }),
        adGroup({ adGroupId: 'ag-exact', campaignId: 'c-manual' }),
      ],
      keywords: [keyword('ag-broad', 'BROAD'), keyword('ag-exact', 'EXACT')],
      productAds: [
        productAd('ag-auto', 'B0TEAPOT'),
        productAd('ag-broad', 'B0TEAPOT'),
        productAd('ag-exact', 'B0TEAPOT'),
      ],
    });

    const pairs = result.funnel.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(pairs).toEqual(['auto->broad', 'auto->exact', 'broad->exact']);
    // Never backwards: exact is a destination only.
    expect(pairs.some((p) => p.startsWith('exact->'))).toBe(false);
  });

  it('includes phrase→exact, which the funnel diagram calls for', () => {
    // The middle of the waterfall: phrase exists to gather data at a
    // controlled bid, and what it proves has to be able to reach exact.
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [
        adGroup({ adGroupId: 'ag-phrase', campaignId: 'c-manual' }),
        adGroup({ adGroupId: 'ag-exact', campaignId: 'c-manual' }),
      ],
      keywords: [keyword('ag-phrase', 'PHRASE'), keyword('ag-exact', 'EXACT')],
      productAds: [
        productAd('ag-phrase', 'B0TEAPOT'),
        productAd('ag-exact', 'B0TEAPOT'),
      ],
    });
    expect(result.funnel.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'phrase->exact',
    ]);
  });

  it('gives every edge the default policy rather than leaving it unset', () => {
    const [edge] = infer().funnel.edges;
    expect(edge.policy.overlapDays).toBe(14);
    expect(edge.policy.productScope).toBe('exact');
  });

  it('gives colliding roles distinct, readable node ids', () => {
    // A human edits these edges, so the ids have to be matchable against the
    // account by eye.
    const result = infer({
      campaigns: [campaign({ campaignId: 'c-manual' })],
      adGroups: [
        adGroup({ adGroupId: 'ag-1', campaignId: 'c-manual' }),
        adGroup({ adGroupId: 'ag-2', campaignId: 'c-manual' }),
      ],
      keywords: [keyword('ag-1', 'EXACT'), keyword('ag-2', 'EXACT')],
      productAds: [productAd('ag-1', 'B0A'), productAd('ag-2', 'B0B')],
    });
    expect(result.funnel.nodes.map((n) => n.nodeId)).toEqual([
      'exact',
      'exact-2',
    ]);
  });
});
