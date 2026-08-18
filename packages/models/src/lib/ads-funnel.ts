/**
 * Keyword harvest funnels: campaigns that feed each other (#147).
 *
 * Amazon has no concept of one campaign feeding another, so the relationship is
 * ours to hold. A funnel is a small graph — discovery ad groups (auto, broad)
 * pointing at more focused ones (phrase, exact) — plus the log of every term
 * that has already crossed an edge.
 *
 * Two things in here are load-bearing and easy to get wrong:
 *
 * **Nodes are ad groups, not campaigns.** A keyword applies to every product in
 * its ad group, so the promise "this term converted for these products" only
 * holds if source and destination advertise a compatible product set. Amazon's
 * own Target Promotion Group agrees — it pins the specific product ad ids in
 * the auto ad group alongside exactly one manual keyword ad group. Campaign id
 * alone cannot express that, which is why `advertisedProductIds` sits on the
 * node and `productScope` gates the edge.
 *
 * **Ids are the identity; names are only a join alias.** Stored search-term
 * evidence arrives keyed by `campaignName`/`adGroupName` when it came from a
 * console export, because that export carries no ids at all. The node keeps
 * both so name-keyed rows can still be attributed — but a rename changes the
 * alias, never the node, and a name that no longer resolves is reported rather
 * than silently harvesting nothing.
 */

import { z } from 'zod';

/**
 * Where a node sits in the funnel.
 *
 * Auto and broad are BOTH discovery and they find different things: auto
 * surfaces terms the seller never seeded, broad expands around seeds they
 * chose. Broad is also a destination — a term found in auto is sometimes added
 * as broad to explore its neighbourhood — so this is a role, not a rank.
 */
export const FunnelRoleSchema = z.enum(['auto', 'broad', 'phrase', 'exact']);
export type FunnelRole = z.infer<typeof FunnelRoleSchema>;

/**
 * What a campaign is FOR, which decides how patient its rules are.
 *
 * A waste rule that is correct for a mature profit campaign is actively harmful
 * during a launch: it negates terms before they have had a chance and shuts
 * down the discovery the funnel depends on. Ad-driven sales feed organic rank,
 * so spending above break-even can be the right call while a product is
 * establishing itself.
 *
 * Rarely set by hand — `defaultObjectiveForRole` derives it from the node's
 * role, which is right in the common case. The override exists for a launch
 * window, where the role says "exact" but the intent is still velocity.
 */
export const CampaignObjectiveSchema = z.enum([
  'launch',
  'discovery',
  'profit',
  'defensive',
]);
export type CampaignObjective = z.infer<typeof CampaignObjectiveSchema>;

/**
 * The objective a role implies.
 *
 * Phrase counts as discovery, not profit: the funnel sends promising-but-
 * unproven terms there precisely to gather data at a controlled bid, so judging
 * it on a profit campaign's thresholds would prune terms while they are still
 * doing the job they were sent to do.
 */
export function defaultObjectiveForRole(role: FunnelRole): CampaignObjective {
  return role === 'exact' ? 'profit' : 'discovery';
}

export const FunnelNodeSchema = z.object({
  /** Stable within the funnel; what edges refer to. Never an Amazon id. */
  nodeId: z.string().min(1),
  campaignId: z.string().min(1),
  adGroupId: z.string().min(1),
  role: FunnelRoleSchema,
  /**
   * Names as they read in the console WHEN THE NODE WAS MAPPED.
   *
   * An alias for joining name-keyed evidence, never the identity. Kept
   * deliberately even though the whole design stores ids: a console export has
   * no id column, so without these the manual-harvest path — the half that
   * ships first — could not attribute a single row to a node.
   */
  campaignName: z.string().optional(),
  adGroupName: z.string().optional(),
  /**
   * ASINs this ad group advertises, from `listProductAds`.
   *
   * Not derivable from the evidence: neither search-term path carries an ASIN
   * column. It has to be read from the API when the funnel is mapped, and it
   * goes stale when someone adds a product ad in the console — hence
   * `productsReadAt`, so a gate can say "verified on the 3rd" rather than
   * implying it is checking live.
   */
  advertisedProductIds: z.array(z.string().min(1)).default([]),
  productsReadAt: z.number().int().nonnegative().optional(),
  /** Overrides `defaultObjectiveForRole`. Set for a launch window. */
  objective: CampaignObjectiveSchema.optional(),
});
export type FunnelNode = z.infer<typeof FunnelNodeSchema>;

/**
 * How strictly source and destination product sets must agree.
 *
 * `exact` — identical sets. The default, and the only one where the evidence
 *   describes precisely what the destination will advertise.
 * `subset` — destination ⊆ source. Still fully evidence-backed: every product
 *   the destination advertises contributed to the numbers. The sane relaxation.
 * `ignore` — no check. Recorded on the graduation so it is visible later that
 *   the term was promoted into products it has no record for.
 *
 * There is deliberately no "superset" setting. Destination ⊋ source means
 * promoting a term into products nothing observed, which is the failure this
 * gate exists to prevent; anyone who wants it is asking for `ignore` and should
 * have to say so.
 */
export const ProductScopeRuleSchema = z.enum(['exact', 'subset', 'ignore']);
export type ProductScopeRule = z.infer<typeof ProductScopeRuleSchema>;

/**
 * Thresholds for one edge. Every number is policy, never inferred from prose.
 *
 * The issue text carried two implicit rules at once — "≥10 clicks, 1 order goes
 * to phrase" alongside a default `minOrders` of 2 — which is exactly how a
 * config and a docstring drift apart. There is one home for a threshold, and
 * it is here.
 */
export const GraduationPolicySchema = z.object({
  minClicks: z.number().int().nonnegative().default(10),
  minOrders: z.number().int().nonnegative().default(2),
  /** Undefined means "do not judge efficiency", not "target 0". */
  maxAcos: z.number().positive().optional(),
  minSpend: z.number().nonnegative().default(0),
  /**
   * Days the source keeps serving after the destination keyword is created,
   * before the backward negative comes due.
   *
   * Applying the negative in the same breath as the create is worse than
   * skipping it: it switches off a proven traffic source in favour of an
   * unproven one, and traffic gaps rather than transfers.
   */
  overlapDays: z.number().int().positive().default(14),
  /**
   * Multiplier on the term's observed CPC in the source.
   *
   * A naive default bid is the most common cause of "it did worse after I moved
   * it" — more than any loss of history. Amazon's own guidance is to bid exact
   * above phrase above broad, so a modest uplift rather than a copy.
   */
  bidUplift: z.number().positive().default(1.1),
  minBid: z.number().positive().default(0.02),
  maxBid: z.number().positive().default(5),
  productScope: ProductScopeRuleSchema.default('exact'),
  /**
   * Ceiling per harvest run, strongest evidence first.
   *
   * A large batch makes the destination's subsequent performance
   * unattributable — nobody can say which of thirty new keywords moved it.
   */
  maxPerRun: z.number().int().positive().default(10),
  /**
   * Fraction of daily budget above which the destination counts as saturated.
   *
   * A campaign has one daily budget and Amazon does not pace it evenly, so a
   * campaign already exhausting early will simply divide the same pool among
   * more keywords — existing champions lose impression share to newcomers with
   * no record.
   */
  saturationRatio: z.number().positive().max(1).default(0.95),
});
export type GraduationPolicy = z.infer<typeof GraduationPolicySchema>;

export const FunnelEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  policy: GraduationPolicySchema.default({}),
});
export type FunnelEdge = z.infer<typeof FunnelEdgeSchema>;

/**
 * When a term that never converts should be negated in its source.
 *
 * Often the higher-ROI half of the whole feature — the money a funnel saves
 * usually exceeds the money it redirects.
 */
export const WastePolicySchema = z.object({
  minClicks: z.number().int().positive().default(20),
  minSpend: z.number().nonnegative().default(5),
  maxPerRun: z.number().int().positive().default(10),
});
export type WastePolicy = z.infer<typeof WastePolicySchema>;

/**
 * Waste thresholds per objective.
 *
 * `null` means the rule is OFF, which is a real answer and not an omission: on
 * a launch campaign velocity matters more than efficiency, and on a defensive
 * campaign ACOS is largely irrelevant because the point is denying competitors
 * the placement.
 */
export const WASTE_BY_OBJECTIVE: Record<CampaignObjective, WastePolicy | null> =
  {
    launch: null,
    defensive: null,
    // Patient. Amazon's own advice is to let a keyword gather around 20 clicks
    // before judging it, and discovery is where a premature negative does the
    // most damage — it removes a query family the funnel might never resurface.
    discovery: { minClicks: 20, minSpend: 5, maxPerRun: 10 },
    profit: { minClicks: 10, minSpend: 3, maxPerRun: 10 },
  };

export const FunnelSchema = z.object({
  funnelId: z.string().min(1),
  profileId: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(FunnelNodeSchema).min(1),
  edges: z.array(FunnelEdgeSchema).default([]),
  waste: WastePolicySchema.partial().optional(),
});
export type Funnel = z.infer<typeof FunnelSchema>;

/**
 * The numbers a decision was made on, and the window they cover.
 *
 * Stored with every graduation because a graduation without its evidence is an
 * unexplainable fact six weeks later — and because the window is not a detail:
 * the same term over two different windows is two different decisions.
 */
export const HarvestEvidenceSchema = z.object({
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  orders: z.number().nonnegative(),
  spend: z.number().nonnegative(),
  sales: z.number().nonnegative(),
  /**
   * Undefined rather than 0 when there are no sales.
   *
   * Zero would read as "perfectly efficient" for the rows that are pure waste,
   * which inverts the ranking. Same reasoning as `AdsPerformanceRow`.
   */
  acos: z.number().nonnegative().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  /**
   * Attribution window of the rows this was computed from, in days.
   *
   * Not a constant. A console export reports "7 Day Total Orders"; the API path
   * defaults to 14d and the window is recovered from the payload's own column
   * names. The trailing exclusion is derived from THIS number, so storing it is
   * what makes the window reproducible.
   */
  attributionDays: z.number().int().positive(),
  /** Stored rows the figures were summed from. */
  rows: z.number().int().nonnegative(),
});
export type HarvestEvidence = z.infer<typeof HarvestEvidenceSchema>;

/**
 * A backward negative as a scheduled obligation, not a side effect.
 *
 * The dangerous partial is a keyword created downstream while the upstream
 * negative failed: the seller is then bidding against themselves and cannot see
 * it. Recording the obligation with a state and a due date is what makes that
 * visible — reconciling these IS the self-competition detector.
 */
export const BackwardNegativeSchema = z.object({
  campaignId: z.string().min(1),
  adGroupId: z.string().min(1),
  /**
   * Exact by default, and surgical for it: negative phrase blocks a whole
   * family and can starve the discovery the funnel runs on.
   *
   * Note that negative exact still covers close variants — plurals and
   * misspellings of the term — so this blocks a small family, not one literal
   * string.
   */
  matchType: z
    .enum(['negativeExact', 'negativePhrase'])
    .default('negativeExact'),
  negativeKeywordId: z.string().nullable().default(null),
  state: z
    .enum(['scheduled', 'applied', 'failed', 'skipped', 'cancelled'])
    .default('scheduled'),
  /** Epoch ms when the overlap window closes and this becomes proposable. */
  dueAt: z.number().int().nonnegative(),
  appliedAt: z.number().int().nonnegative().optional(),
  /** Why it failed or was skipped. Never discarded — silence is the failure. */
  note: z.string().optional(),
});
export type BackwardNegative = z.infer<typeof BackwardNegativeSchema>;

export const GraduationStateSchema = z.enum([
  'proposed',
  'applied',
  'failed',
  'rejected',
]);
export type GraduationState = z.infer<typeof GraduationStateSchema>;

export const GraduationSchema = z.object({
  /** Deterministic from funnel + edge + term family — see `graduationId`. */
  graduationId: z.string().min(1),
  funnelId: z.string().min(1),
  profileId: z.string().min(1),
  /** The normalised term. Un-normalised keys graduate the same term twice. */
  term: z.string().min(1),
  /**
   * Close variants folded into this one, as they appeared in the reports.
   *
   * Exact match already covers plurals and misspellings, so graduating both
   * "french press" and "french presses" splits the data for no gain. Kept so
   * the evidence total can be traced back to the rows that produced it.
   */
  variants: z.array(z.string().min(1)).default([]),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  fromCampaignId: z.string().min(1),
  fromAdGroupId: z.string().min(1),
  toCampaignId: z.string().min(1),
  toAdGroupId: z.string().min(1),
  fromRole: FunnelRoleSchema,
  toRole: FunnelRoleSchema,
  matchType: z.enum(['broad', 'phrase', 'exact']),
  /**
   * The created keyword. Load-bearing: it is how the graduation is later
   * measured, and how the delivery gate checks the destination is serving
   * before the backward negative is allowed to cut the source.
   */
  keywordId: z.string().nullable().default(null),
  bid: z.number().positive(),
  /** What the term actually cost per click in the source. */
  sourceCpc: z.number().nonnegative(),
  evidence: HarvestEvidenceSchema,
  /** Recorded when the edge ran with `productScope: 'ignore'`. */
  productScopeChecked: z.boolean().default(true),
  negatives: z.array(BackwardNegativeSchema).default([]),
  state: GraduationStateSchema.default('proposed'),
  proposedAt: z.number().int().nonnegative(),
  appliedAt: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});
export type Graduation = z.infer<typeof GraduationSchema>;

/**
 * Normalise a raw search term into a comparable key.
 *
 * Raw terms vary in case and spacing, and an un-normalised key graduates the
 * same term twice — once from each spelling — creating two keywords that then
 * split their own data.
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The key a term and its close variants share.
 *
 * Deliberately crude: only a trailing plural on the LAST word is folded, and
 * only when the stem is long enough that folding cannot invent a word. Amazon's
 * close-variant matching is far broader than this, but a broader rule here
 * would merge terms that are genuinely different queries ("teapot" and
 * "teapots" yes; "press" and "pres" no), and a wrong merge silently sums two
 * products' evidence into one decision.
 */
export function termFamilyKey(raw: string): string {
  const normalized = normalizeSearchTerm(raw);
  const words = normalized.split(' ');
  const last = words[words.length - 1] ?? '';
  if (last.length > 4 && last.endsWith('es')) {
    words[words.length - 1] = last.slice(0, -2);
  } else if (last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join(' ');
}

/**
 * A stable id for "this term family, over this edge".
 *
 * Deterministic on purpose: it is the idempotency key. A retried run recomputes
 * the same id, finds the graduation already logged, and proposes nothing —
 * which is what stops a duplicate keyword being created downstream.
 */
export function graduationId(params: {
  funnelId: string;
  fromNodeId: string;
  toNodeId: string;
  term: string;
}): string {
  return [
    params.funnelId,
    params.fromNodeId,
    params.toNodeId,
    termFamilyKey(params.term),
  ].join('::');
}

/** ACOS, or undefined when there were no sales to divide by. */
export function acosOf(spend: number, sales: number): number | undefined {
  return sales > 0 ? spend / sales : undefined;
}
