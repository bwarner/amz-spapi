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
 * The standard topology, pre-wired for a human to edit.
 *
 * Discovery feeds focus: every auto and broad node points at every phrase and
 * exact node in the funnel, and broad is a destination for auto as well as a
 * source — a term auto surfaces is often added as broad to explore its
 * neighbourhood before it earns exact.
 *
 * Deliberately generous rather than clever. An edge nobody wants is visible in
 * the proposal and deleted in one click; an edge that should exist and does not
 * is a term that silently never graduates, and nothing surfaces that. The
 * product-scope gate is what stops a wrong edge doing damage if one survives
 * review — it refuses a graduation between ad groups advertising different
 * products regardless of what the topology says.
 */
function proposeEdges(nodes: FunnelNode[]): FunnelEdge[] {
  const policy = GraduationPolicySchema.parse({});
  const edges: FunnelEdge[] = [];

  for (const from of nodes) {
    for (const to of nodes) {
      if (from.nodeId === to.nodeId) continue;
      // The only rule: a term may move to a strictly narrower match, never
      // back. That admits phrase→exact, which #147's own diagram calls for —
      // an earlier version restricted sources to auto and broad and silently
      // dropped it.
      if (specificity(to.role) <= specificity(from.role)) continue;
      // Not restricted to one campaign's ad groups: a funnel routinely spans
      // campaigns, and which pairings are legitimate is the product-scope
      // gate's judgement rather than something to guess at here.
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
