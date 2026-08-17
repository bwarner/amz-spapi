import type {
  AdsKeywordMatchType,
  AdsMutationResult,
  AdsTargetingType,
} from './ad-client.js';

/**
 * Building a whole Sponsored Products campaign, and reporting what exists (#146).
 *
 * Separate from `ad-client` because none of this is HTTP. It is the decision
 * layer: which levels to attempt, when to stop, and — the part that matters —
 * whether what got created can actually serve. Keeping it here means those
 * decisions are testable by handing in four functions, with no transport to
 * mock, and it keeps the client a client.
 *
 * ## Why creation is not like the other writes
 *
 * Every other mutation in this package can be undone by a second call: pause it
 * back, re-enable it, change the number again. A create cannot. Amazon has no
 * delete that returns a campaign to not-existing — only archive, which is
 * permanent and which the client deliberately does not expose.
 *
 * Two things make it safe enough to offer anyway.
 *
 * **Everything is created PAUSED**, whatever was asked for — state is not a
 * parameter on any of the four creates. That converts an irreversible operation
 * into a reversible one in the sense that matters: a paused tree spends nothing,
 * so a mistake costs a console cleanup rather than a budget.
 *
 * **A partial tree is reported as what it is.** Four POSTs each answer 207
 * independently, so partial trees are the normal failure rather than an edge
 * case. The dangerous outcome is not an error — it is a campaign that exists,
 * reports created, has no product ads, and can never show an impression. So
 * there is no "did it work" boolean anywhere in the result.
 */

/**
 * A whole campaign, as one request.
 *
 * One object rather than four calls the caller sequences, because each level's
 * id is only known once the level above succeeded — and because a caller free
 * to stop halfway is a caller who can leave live-money structure in a broken
 * state.
 */
export type AdCampaignTreeRequest = {
  name: string;
  targetingType: AdsTargetingType;
  dailyBudget: number;
  biddingStrategy?:
    | 'LEGACY_FOR_SALES'
    | 'AUTO_FOR_SALES'
    | 'MANUAL'
    | 'RULE_BASED';
  adGroup: { name: string; defaultBid: number };
  /**
   * What to advertise. At least one is required, and the requirement is not
   * cosmetic: a campaign with no product ads is accepted by Amazon, costs
   * nothing, and can never show an impression.
   */
  products: Array<{ sku?: string; asin?: string }>;
  /**
   * Targets, for MANUAL campaigns. An AUTO campaign supplies its own, so
   * keywords here are rejected by Amazon rather than ignored.
   */
  keywords?: Array<{
    keywordText: string;
    matchType: AdsKeywordMatchType;
    bid?: number;
  }>;
};

/** One level's outcome, per item, labelled the way the caller named it. */
export type AdTreeLevelResult = {
  requested: number;
  created: number;
  failures: Array<{ item: string; error: string }>;
};

/**
 * What was actually built — not what was asked for.
 *
 * `servable` is computed from the tree rather than from the absence of errors,
 * because "no error" and "can serve" are different claims and only the second
 * one is what a seller is asking about.
 */
export type AdCampaignTreeResult = {
  campaign: {
    name: string;
    created: boolean;
    campaignId?: string;
    error?: string;
  };
  adGroup: {
    name: string;
    created: boolean;
    adGroupId?: string;
    error?: string;
  };
  productAds: AdTreeLevelResult;
  keywords: AdTreeLevelResult;
  /**
   * Whether what exists could show an impression once enabled: the campaign,
   * the ad group, at least one product ad, and — for MANUAL — at least one
   * keyword. Anything less is structure that spends nothing and returns nothing.
   */
  servable: boolean;
  /**
   * What a person has to do about what exists. Never empty when `servable` is
   * false, because there is no rollback: a half-built tree has to be finished or
   * archived by hand in the console.
   */
  remediation: string[];
};

/**
 * The four creates this needs, injected.
 *
 * A structural type rather than the client class, so the orchestration can be
 * exercised without HTTP — and so the campaign-split work (#148) can reuse it
 * against a different caller.
 */
export type CampaignTreeWriter = {
  createCampaigns(
    campaigns: Array<{
      name: string;
      targetingType: AdsTargetingType;
      dailyBudget: number;
      biddingStrategy?: AdCampaignTreeRequest['biddingStrategy'];
    }>
  ): Promise<AdsMutationResult>;
  createAdGroups(
    adGroups: Array<{ campaignId: string; name: string; defaultBid: number }>
  ): Promise<AdsMutationResult>;
  createProductAds(
    productAds: Array<{
      campaignId: string;
      adGroupId: string;
      sku?: string;
      asin?: string;
    }>
  ): Promise<AdsMutationResult>;
  createKeywords(
    keywords: Array<{
      campaignId: string;
      adGroupId: string;
      keywordText: string;
      matchType: AdsKeywordMatchType;
      bid?: number;
    }>
  ): Promise<AdsMutationResult>;
};

/**
 * Amazon's per-item error, as a sentence.
 *
 * The 207 error entries carry an `errors` array of `{errorType, message}` and
 * nothing human-readable at the top level, so a caller that stringifies the
 * entry puts JSON in front of a seller. Falls back to the whole object only for
 * an unfamiliar shape — printing something ugly beats losing the detail.
 */
export function describeItemError(entry: Record<string, unknown>): string {
  const inner = entry['errors'];
  if (Array.isArray(inner) && inner.length > 0) {
    const messages = inner
      .map((e) => {
        const o = e as Record<string, unknown>;
        return [o['errorType'], o['message']].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  return typeof entry['message'] === 'string'
    ? entry['message']
    : JSON.stringify(entry);
}

/** Fold a 207 into counts, naming each failure by the caller's own label. */
export function levelResult(
  result: AdsMutationResult,
  labels: string[]
): AdTreeLevelResult {
  return {
    requested: labels.length,
    created: result.success.length,
    failures: result.error.map((entry) => {
      // `index` maps a failure back to its request item. Without it a seller is
      // told "one of these failed" and has to guess which.
      const index = entry['index'];
      return {
        item:
          typeof index === 'number' && labels[index] !== undefined
            ? labels[index]
            : '(unidentified item)',
        error: describeItemError(entry),
      };
    }),
  };
}

const EMPTY_LEVEL: AdTreeLevelResult = {
  requested: 0,
  created: 0,
  failures: [],
};

/**
 * Build a campaign tree, PAUSED, reporting what exists.
 *
 * Descends only while the level above succeeded, because each id comes from the
 * response above it. Product ads and keywords are siblings, so both are
 * attempted — one failing must not hide the other's problem, and a seller
 * learns about both in one pass.
 *
 * Never throws for a partial tree. A throw would discard the ids of what Amazon
 * already created, which is the only handle for finishing or archiving it.
 * Combinations that could never serve are refused BEFORE anything is created,
 * because refusing locally costs nothing and leaves nothing to clean up.
 */
export async function createCampaignTree(
  writer: CampaignTreeWriter,
  request: AdCampaignTreeRequest
): Promise<AdCampaignTreeResult> {
  const keywords = request.keywords ?? [];

  if (request.products.length === 0) {
    throw new Error(
      `Campaign ${request.name} names no products. A campaign with no product ` +
        'ads can never serve, so this is refused before anything is created.'
    );
  }
  if (request.targetingType === 'MANUAL' && keywords.length === 0) {
    throw new Error(
      `Campaign ${request.name} is MANUAL but names no keywords, so it could ` +
        'never serve. Supply keywords, or use AUTO targeting.'
    );
  }
  if (request.targetingType === 'AUTO' && keywords.length > 0) {
    throw new Error(
      `Campaign ${request.name} is AUTO, which chooses its own targets — ` +
        'Amazon rejects keywords on an AUTO campaign rather than ignoring them.'
    );
  }

  const productLabels = request.products.map(
    (p) => p.sku ?? p.asin ?? '(unnamed product)'
  );
  const keywordLabels = keywords.map(
    (k) => `${k.keywordText} (${k.matchType})`
  );

  const campaignResult = await writer.createCampaigns([
    {
      name: request.name,
      targetingType: request.targetingType,
      dailyBudget: request.dailyBudget,
      ...(request.biddingStrategy
        ? { biddingStrategy: request.biddingStrategy }
        : {}),
    },
  ]);
  const campaignId = campaignResult.success[0]?.['campaignId'];
  if (typeof campaignId !== 'string') {
    return {
      campaign: {
        name: request.name,
        created: false,
        error: campaignResult.error[0]
          ? describeItemError(campaignResult.error[0])
          : 'Amazon returned no campaign id and no error.',
      },
      adGroup: { name: request.adGroup.name, created: false },
      productAds: { ...EMPTY_LEVEL, requested: productLabels.length },
      keywords: { ...EMPTY_LEVEL, requested: keywordLabels.length },
      servable: false,
      // The one clean failure: nothing exists, so nothing needs cleaning up.
      remediation: ['Nothing was created. Fix the reported error and retry.'],
    };
  }

  const adGroupResult = await writer.createAdGroups([
    {
      campaignId,
      name: request.adGroup.name,
      defaultBid: request.adGroup.defaultBid,
    },
  ]);
  const adGroupId = adGroupResult.success[0]?.['adGroupId'];
  if (typeof adGroupId !== 'string') {
    return {
      campaign: { name: request.name, created: true, campaignId },
      adGroup: {
        name: request.adGroup.name,
        created: false,
        error: adGroupResult.error[0]
          ? describeItemError(adGroupResult.error[0])
          : 'Amazon returned no ad group id and no error.',
      },
      productAds: { ...EMPTY_LEVEL, requested: productLabels.length },
      keywords: { ...EMPTY_LEVEL, requested: keywordLabels.length },
      servable: false,
      remediation: [
        `Campaign ${request.name} (${campaignId}) exists with no ad group, so ` +
          'it can never serve. It is PAUSED and spends nothing. Either add an ' +
          'ad group in the console, or archive the campaign there — this tool ' +
          'cannot archive.',
      ],
    };
  }

  const [productAdResult, keywordResult] = await Promise.all([
    writer.createProductAds(
      request.products.map((p) => ({ campaignId, adGroupId, ...p }))
    ),
    keywords.length
      ? writer.createKeywords(
          keywords.map((k) => ({ campaignId, adGroupId, ...k }))
        )
      : Promise.resolve<AdsMutationResult>({ success: [], error: [] }),
  ]);

  const productAds = levelResult(productAdResult, productLabels);
  const keywordLevel = levelResult(keywordResult, keywordLabels);

  const needsKeywords = request.targetingType === 'MANUAL';
  const servable =
    productAds.created > 0 && (!needsKeywords || keywordLevel.created > 0);

  const remediation: string[] = [];
  if (productAds.created === 0) {
    remediation.push(
      `No product ads were created, so campaign ${request.name} ` +
        `(${campaignId}) cannot serve. Add the SKUs in the console, or archive ` +
        'the campaign there.'
    );
  } else if (productAds.failures.length) {
    remediation.push(
      `${productAds.failures.length} of ${productAds.requested} product ads ` +
        'failed — the campaign will serve, but not for those SKUs.'
    );
  }
  if (needsKeywords && keywordLevel.created === 0) {
    remediation.push(
      `No keywords were created on a MANUAL campaign, so ${request.name} ` +
        `(${campaignId}) cannot serve. Add targets in the console, or archive it.`
    );
  } else if (keywordLevel.failures.length) {
    remediation.push(
      `${keywordLevel.failures.length} of ${keywordLevel.requested} keywords ` +
        'failed — the campaign will serve on the rest.'
    );
  }
  if (servable) {
    // Said on every successful path, because "created" reads as "running" and
    // it is not: nothing spends until somebody enables it.
    remediation.push(
      `Created PAUSED and spending nothing. Enable ${request.name} ` +
        `(${campaignId}) when the structure looks right.`
    );
  }

  return {
    campaign: { name: request.name, created: true, campaignId },
    adGroup: { name: request.adGroup.name, created: true, adGroupId },
    productAds,
    keywords: keywordLevel,
    servable,
    remediation,
  };
}
