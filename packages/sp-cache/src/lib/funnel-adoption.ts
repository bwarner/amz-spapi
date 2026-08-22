/**
 * Turn an account that already runs a waterfall into a stored funnel (#147).
 *
 * "Adoption first": this seller has been running the shape by hand for months —
 * `Auto - Catch all`, `SP - Broad - Gran Del Val`, `SP - Phrase - Gran del Val`,
 * `B/P/E - SKW - teapot`. Asking them to rebuild it in our vocabulary would
 * throw away working structure and history. So the funnel is READ from the
 * account rather than created in it, and nothing here writes to Amazon.
 *
 * ## The role comes from the targeting, never from the name
 *
 * A name like `SP - Phrase - X` is the obvious signal and the wrong one. It is
 * a convention this seller happens to follow, it breaks the moment somebody
 * renames in the console, and it is exactly what #147 says not to depend on.
 * The account already states the answer in a form that cannot drift: a campaign
 * is `targetingType: AUTO` or it is not, and a manual ad group's keywords each
 * carry a `matchType`. That is what is read here.
 *
 * Names are still carried onto the node, but only as the join alias for
 * evidence that arrives without ids (a console export has no id column). They
 * never decide anything.
 *
 * ## A proposal, not a decision
 *
 * The output is handed to a human before it is stored. Which campaign feeds
 * which is the part that genuinely varies between sellers, and a plausible
 * guess applied silently would be indistinguishable from one they chose. Every
 * ad group that could not be placed is returned with the reason, so the answer
 * is never a quietly shorter list than the account.
 */

import {
  GraduationPolicySchema,
  type Funnel,
  type FunnelEdge,
  type FunnelNode,
  type FunnelRole,
} from '@farvisionllc/models';

/** The fields adoption reads. Everything else on the object is ignored. */
export type AdoptionCampaign = {
  campaignId: string;
  name?: string;
  targetingType?: string;
  state?: string;
};

export type AdoptionAdGroup = {
  adGroupId: string;
  campaignId: string;
  name?: string;
  state?: string;
};

export type AdoptionKeyword = {
  adGroupId: string;
  campaignId: string;
  matchType?: string;
  state?: string;
};

export type AdoptionProductAd = {
  adGroupId: string;
  campaignId: string;
  asin?: string;
  sku?: string;
  state?: string;
};

/** An ad group that could not become a node, and why. Never dropped silently. */
export type AdoptionSkip = {
  campaignId: string;
  adGroupId: string;
  name?: string;
  reason: string;
};

export type AdoptionProposal = {
  funnel: Funnel;
  skipped: AdoptionSkip[];
  /**
   * Ad groups whose keywords disagree about match type.
   *
   * Not a failure — a `B/P/E` ad group holding broad, phrase and exact for one
   * term is a real and common structure. But its role is genuinely ambiguous,
   * so the dominant match type is proposed and the disagreement is surfaced for
   * a human to correct rather than resolved by a coin flip.
   */
  mixed: Array<{
    adGroupId: string;
    chosen: FunnelRole;
    counts: Record<string, number>;
  }>;
};

export type InferFunnelParams = {
  profileId: string;
  /** Names the funnel, since the account has no name for the relationship. */
  name: string;
  funnelId: string;
  campaigns: AdoptionCampaign[];
  adGroups: AdoptionAdGroup[];
  keywords: AdoptionKeyword[];
  productAds: AdoptionProductAd[];
  /** Epoch ms, supplied rather than read from a clock. Stamps `productsReadAt`. */
  readAt: number;
  /**
   * Adopt only the ad groups advertising these products. Absent means the whole
   * account.
   *
   * A seller does not think in accounts, they think in products: "the funnel
   * for my 8oz cups". Without this the proposal is every campaign the account
   * has ever run — for a real account that is dozens of nodes and hundreds of
   * edges, which is not a thing anyone reviews. It is accepted wholesale or
   * abandoned, and both are wrong.
   *
   * Scoping at the NODE level rather than filtering edges afterwards, because
   * an unrelated campaign should not appear in the funnel at all. A node that
   * is in the graph is a node `plan-harvest` reads, `listFunnels` shows, and
   * the AdOps screen renders — belonging in the picture is the same question
   * as belonging in the funnel.
   */
  productIds?: string[];
};

/**
 * Read the account's existing structure as a funnel.
 *
 * Archived objects are excluded throughout. An archived ad group cannot serve,
 * cannot receive a keyword, and cannot be un-archived — so a node pointing at
 * one is a funnel edge that silently never fires.
 */
export function inferFunnelTopology(
  params: InferFunnelParams
): AdoptionProposal {
  const campaigns = new Map(
    params.campaigns
      .filter((campaign) => !isArchived(campaign.state))
      .map((campaign) => [campaign.campaignId, campaign])
  );

  const keywordsByAdGroup = groupBy(
    params.keywords.filter((keyword) => !isArchived(keyword.state)),
    (keyword) => keyword.adGroupId
  );
  const productsByAdGroup = groupBy(
    params.productAds.filter((ad) => !isArchived(ad.state)),
    (ad) => ad.adGroupId
  );

  // Absent means the whole account, so an EMPTY array must not silently mean
  // that too — a caller who passed a filter and matched nothing gets an empty
  // funnel, which is the honest answer.
  const wanted = params.productIds
    ? new Set(params.productIds.map((id) => id.trim().toUpperCase()))
    : undefined;

  const nodes: FunnelNode[] = [];
  const skipped: AdoptionSkip[] = [];
  const mixed: AdoptionProposal['mixed'] = [];
  const usedIds = new Set<string>();

  for (const adGroup of params.adGroups) {
    if (isArchived(adGroup.state)) continue;

    const campaign = campaigns.get(adGroup.campaignId);
    if (!campaign) {
      skipped.push({
        campaignId: adGroup.campaignId,
        adGroupId: adGroup.adGroupId,
        name: adGroup.name,
        reason:
          'Its campaign is archived or was not in the listing — an ad group ' +
          'whose campaign cannot serve is a node no edge could ever fire.',
      });
      continue;
    }

    const role = roleFor(campaign, keywordsByAdGroup.get(adGroup.adGroupId));
    if (!role.ok) {
      skipped.push({
        campaignId: adGroup.campaignId,
        adGroupId: adGroup.adGroupId,
        name: adGroup.name,
        reason: role.reason,
      });
      continue;
    }
    if (role.counts) {
      mixed.push({
        adGroupId: adGroup.adGroupId,
        chosen: role.role,
        counts: role.counts,
      });
    }

    // ASINs, deduplicated. A SKU is accepted only when no ASIN is present:
    // the product-scope gate compares two ad groups' sets, and a set of ASINs
    // will never match a set of SKUs even when they name the same products.
    const products = [
      ...new Set(
        (productsByAdGroup.get(adGroup.adGroupId) ?? [])
          .map((ad) => ad.asin ?? ad.sku)
          .filter((id): id is string => Boolean(id))
      ),
    ].sort();

    // Out of scope, and reported rather than dropped in silence. A seller who
    // asked for "the 8oz cups funnel" and got a proposal missing a campaign
    // they expected needs to know it was excluded on purpose, and why.
    if (wanted && !products.some((id) => wanted.has(id.toUpperCase()))) {
      skipped.push({
        campaignId: adGroup.campaignId,
        adGroupId: adGroup.adGroupId,
        name: adGroup.name,
        reason: products.length
          ? `Advertises ${products.join(', ')}, not the requested product.`
          : 'No product ads read for this ad group, so it cannot be matched ' +
            'to the requested product.',
      });
      continue;
    }

    nodes.push({
      nodeId: uniqueNodeId(role.role, adGroup, usedIds),
      campaignId: adGroup.campaignId,
      adGroupId: adGroup.adGroupId,
      role: role.role,
      campaignName: campaign.name,
      adGroupName: adGroup.name,
      advertisedProductIds: products,
      // Stamped even when the list came back empty. "Read, and there were
      // none" and "never looked" are different states, and only the second
      // should send someone back to the API — but the product-scope gate
      // refuses both, so the timestamp is what tells them apart.
      productsReadAt: params.readAt,
      // `objective` is deliberately not set. It falls out of the role via
      // `defaultObjectiveForRole`, and writing the derived value here would
      // freeze today's mapping into every adopted node — so a later change to
      // what a role implies would silently not apply to them. The field exists
      // for a human declaring a launch window, which is not something adoption
      // can read off the account.
    });
  }

  return {
    funnel: {
      funnelId: params.funnelId,
      profileId: params.profileId,
      name: params.name,
      nodes,
      edges: proposeEdges(nodes),
    },
    skipped,
    mixed,
  };
}

/**
 * What role an ad group plays, read from the account rather than its name.
 *
 * An AUTO campaign's ad group is `auto` whatever it is called. A manual ad
 * group's role is its keywords' match type — and an ad group with no keywords
 * at all has no role to infer: it may be product-targeted (a different
 * mechanism this funnel does not model) or simply unfinished.
 */
function roleFor(
  campaign: AdoptionCampaign,
  keywords: AdoptionKeyword[] | undefined
):
  | { ok: true; role: FunnelRole; counts?: Record<string, number> }
  | { ok: false; reason: string } {
  if (campaign.targetingType?.toUpperCase() === 'AUTO') {
    return { ok: true, role: 'auto' };
  }

  const counts: Record<string, number> = {};
  for (const keyword of keywords ?? []) {
    const role = ROLE_BY_MATCH_TYPE[keyword.matchType?.toUpperCase() ?? ''];
    if (!role) continue;
    counts[role] = (counts[role] ?? 0) + 1;
  }

  const present = Object.keys(counts);
  if (present.length === 0) {
    return {
      ok: false,
      reason:
        'A manual ad group with no keywords — it may be product-targeted, ' +
        'which this funnel does not model, or not finished yet. Add it by ' +
        'hand if it belongs in the funnel.',
    };
  }

  // Most keywords wins; ties break toward the more specific role, because a
  // node treated as exact is judged on the strictest rules and a node treated
  // as discovery is judged on the most patient. Erring toward strict makes the
  // funnel cautious about what it promotes rather than eager.
  const chosen = present.sort((a, b) => {
    const byCount = (counts[b] ?? 0) - (counts[a] ?? 0);
    return byCount !== 0 ? byCount : specificity(b) - specificity(a);
  })[0] as FunnelRole;

  return present.length > 1
    ? { ok: true, role: chosen, counts }
    : { ok: true, role: chosen };
}

const ROLE_BY_MATCH_TYPE: Record<string, FunnelRole | undefined> = {
  BROAD: 'broad',
  PHRASE: 'phrase',
  EXACT: 'exact',
};

/**
 * How narrowly a role matches, which is what makes an edge legal.
 *
 * `auto` ranks BELOW `broad` rather than level with it. They are both
 * discovery, but a term auto surfaces is routinely added as broad to explore
 * its neighbourhood before it earns exact — so broad is a destination as well
 * as a source, and ranking the two equally silently deletes every auto→broad
 * edge from the proposal.
 *
 * Also used to break a match-type tie, where only broad/phrase/exact ever
 * appear, so the auto rank is irrelevant there.
 */
function specificity(role: string): number {
  switch (role) {
    case 'exact':
      return 3;
    case 'phrase':
      return 2;
    case 'broad':
      return 1;
    default:
      return 0;
  }
}

/**
 * Do these two nodes advertise any product in common?
 *
 * The question a funnel edge is really asking. A term harvested from a source
 * only belongs in a destination that sells the same thing — otherwise the
 * destination bids on a query its products cannot satisfy.
 *
 * An empty list is NOT a wildcard. It means we read the ad group's product ads
 * and found none, or the read failed — and `applyGraduation`'s product-scope
 * gate refuses both. Treating unknown as "matches everything" would propose
 * exactly the edges that can never be acted on.
 */
function sharesProduct(a: FunnelNode, b: FunnelNode): boolean {
  const from = a.advertisedProductIds ?? [];
  const to = b.advertisedProductIds ?? [];
  if (!from.length || !to.length) return false;
  const wanted = new Set(to);
  return from.some((id) => wanted.has(id));
}

/**
 * The standard topology, pre-wired for a human to edit.
 *
 * Discovery feeds focus: an auto or broad node points at the phrase and exact
 * nodes **that advertise the same products**, and broad is a destination for
 * auto as well as a source — a term auto surfaces is often added as broad to
 * explore its neighbourhood before it earns exact.
 *
 * ## Why this is scoped rather than generous
 *
 * An earlier version connected every source to every destination and left the
 * judgement to the product-scope gate at graduation time. The reasoning was
 * that a wrong edge is visible in the proposal and deleted in one click, while
 * a missing edge is a term that silently never graduates.
 *
 * It does not survive contact with a real account. The cross product is
 * quadratic: a seller with a dozen campaigns across four products gets
 * thousands of edges, which is not something a human reviews and clicks through
 * — it is something they accept wholesale or abandon. And most of those edges
 * are nonsense on their face, proposing to harvest a teapot campaign's terms
 * into a coffee cup campaign. A proposal nobody can read is not a proposal.
 *
 * The gate still exists and still refuses those graduations. But refusing at
 * graduation time is the wrong moment: the funnel has already been stored with
 * thousands of meaningless edges, every harvest run evaluates them, and the
 * seller sees a structure that does not describe their account.
 *
 * The data to do better is already here — `advertisedProductIds` is read from
 * `listProductAds` per ad group at proposal time. Product scope is what Amazon
 * itself keys a promotion edge on (`targetPromotionGroups` pins the ad ids), so
 * scoping here agrees with how Amazon models the same relationship.
 *
 * Still deliberately over-inclusive WITHIN a product: several exact campaigns
 * for one ASIN all get an edge, because which one a seller prefers is a
 * genuine choice this cannot read off the account. That is a handful of edges
 * to review, not thousands.
 */
function proposeEdges(nodes: FunnelNode[]): FunnelEdge[] {
  const policy = GraduationPolicySchema.parse({});
  const edges: FunnelEdge[] = [];

  for (const from of nodes) {
    for (const to of nodes) {
      if (from.nodeId === to.nodeId) continue;
      // A term may move to a strictly narrower match, never back. That admits
      // phrase→exact, which #147's own diagram calls for — an earlier version
      // restricted sources to auto and broad and silently dropped it.
      if (specificity(to.role) <= specificity(from.role)) continue;
      // Not restricted to one campaign's ad groups — a funnel routinely spans
      // campaigns — but restricted to ad groups selling the same product.
      if (!sharesProduct(from, to)) continue;
      edges.push({ from: from.nodeId, to: to.nodeId, policy });
    }
  }
  return edges;
}

/**
 * A readable node id that is unique within the funnel.
 *
 * Readable because a human edits these edges: `auto-1` and `exact-2` can be
 * matched against the account, where a generated opaque id cannot. The ad group
 * id is appended only when two nodes would otherwise collide.
 */
function uniqueNodeId(
  role: FunnelRole,
  adGroup: AdoptionAdGroup,
  used: Set<string>
): string {
  // Annotated, not inferred: `role` narrows `candidate` to `FunnelRole`, and
  // the suffixed forms below are template literal types that will not assign
  // back into it. The id is a string that STARTS as the role, not a role.
  let candidate: string = role;
  let n = 1;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${role}-${n}`;
  }
  if (used.has(candidate)) candidate = `${role}-${adGroup.adGroupId}`;
  used.add(candidate);
  return candidate;
}

function isArchived(state: string | undefined): boolean {
  return state?.toUpperCase() === 'ARCHIVED';
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = grouped.get(k);
    if (list) list.push(item);
    else grouped.set(k, [item]);
  }
  return grouped;
}
