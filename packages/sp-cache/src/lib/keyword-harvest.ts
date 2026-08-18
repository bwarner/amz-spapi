/**
 * Turn stored search-term evidence into harvest proposals (#147).
 *
 * Pure and clockless, like `ads-report-sync`: no queue, no environment, no
 * `Date.now()`. The caller supplies the rows, the window they came from, and
 * today's date. That is not fastidiousness — every gate in here is a claim
 * about time ("these numbers have finished filling in", "this overlap has
 * closed"), and a function that reads its own clock cannot be tested against
 * the day the claim is false.
 *
 * Nothing here writes to Amazon. It produces proposals; a human approves them
 * and a separate path applies them. Money never moves without a human, the same
 * premise as the cost ledger.
 *
 * The three failure modes this is built around, in order of how expensive they
 * are to discover late:
 *
 * 1. **Harvesting immature data.** The orders column is an attribution total,
 *    so the most recent days are still filling in. A window that includes
 *    yesterday systematically under-counts orders — and the inverse rule reads
 *    that under-count as proof of waste and proposes negating the seller's best
 *    new terms. Refused rather than corrected: there is no honest correction.
 * 2. **Harvesting from nothing.** An empty result and an un-ingested window are
 *    indistinguishable in the data. Coverage is checked before any figure is
 *    believed.
 * 3. **Promoting into a different product.** A keyword applies to every product
 *    in its ad group, so evidence gathered where one set of ASINs was
 *    advertised says nothing about an ad group advertising another.
 */

import {
  WASTE_BY_OBJECTIVE,
  acosOf,
  defaultObjectiveForRole,
  graduationId,
  normalizeSearchTerm,
  termFamilyKey,
  type Funnel,
  type FunnelEdge,
  type FunnelNode,
  type Graduation,
  type GraduationPolicy,
  type HarvestEvidence,
  type WastePolicy,
} from '@farvisionllc/models';

/**
 * One stored search-term row, narrowed to what a harvest reads.
 *
 * Ids are optional because only the API path supplies them — a console export
 * has no id column, and that is the path that ships first. Names are the
 * fallback join, never the identity.
 */
export type HarvestRow = {
  campaignId?: string;
  adGroupId?: string;
  campaignName?: string;
  adGroupName?: string;
  searchTerm: string;
  matchType?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
};

/** Today's spend against today's budget, per destination campaign. */
export type BudgetSignal = {
  campaignId: string;
  dailyBudget: number;
  /** Average daily spend over the evidence window, or today's burn. */
  dailySpend: number;
};

/** A keyword that already exists downstream, so we do not create it twice. */
export type ExistingKeyword = {
  adGroupId: string;
  keyword: string;
  matchType: string;
};

export type GraduationProposal = {
  kind: 'graduate';
  graduationId: string;
  term: string;
  variants: string[];
  from: FunnelNode;
  to: FunnelNode;
  matchType: 'broad' | 'phrase' | 'exact';
  bid: number;
  sourceCpc: number;
  evidence: HarvestEvidence;
  productScopeChecked: boolean;
  /** Epoch-independent: days, not a timestamp. The applier sets `dueAt`. */
  overlapDays: number;
};

export type NegativeProposal = {
  kind: 'negative';
  term: string;
  variants: string[];
  node: FunnelNode;
  matchType: 'negativeExact';
  evidence: HarvestEvidence;
};

/** Something deliberately not proposed, and why. Never silent. */
export type HarvestSkip = {
  term: string;
  fromNodeId?: string;
  toNodeId?: string;
  reason: string;
};

export type HarvestPlan = {
  refused: false;
  funnelId: string;
  window: { from: string; to: string };
  attributionDays: number;
  graduations: GraduationProposal[];
  negatives: NegativeProposal[];
  skipped: HarvestSkip[];
  /** Rows that matched no node — a rename, or a campaign outside the funnel. */
  unattributedRows: number;
  rowsConsidered: number;
};

export type HarvestRefusal = {
  refused: true;
  funnelId: string;
  reason: string;
};

export type HarvestOutcome = HarvestPlan | HarvestRefusal;

export type PlanHarvestParams = {
  funnel: Funnel;
  rows: HarvestRow[];
  /** The window the rows actually cover, inclusive ISO dates. */
  window: { from: string; to: string };
  /** ISO date. Supplied, never read from a clock. */
  today: string;
  /**
   * Attribution window of these rows, in days.
   *
   * Derived by the caller from the rows' own source — `detectAttribution` for
   * an API pull, the column names for a console export. Passed in because
   * guessing it here would mean guessing how much of the window is immature,
   * and a wrong guess is invisible in the output.
   */
  attributionDays: number;
  /** Windows actually ingested, from `getCoverage`. */
  covered: Array<{ from: string; to: string }>;
  /** The graduation log, for idempotency. */
  graduations: Graduation[];
  budgets?: BudgetSignal[];
  existingKeywords?: ExistingKeyword[];
};

export function planHarvest(params: PlanHarvestParams): HarvestOutcome {
  const { funnel, window, today, attributionDays } = params;

  // ---- Gate 1: the evidence must have finished filling in. ----------------
  //
  // Checked on the WINDOW, not per row. A summary report collapses its whole
  // range into one date, so filtering rows by date cannot separate mature days
  // from immature ones — by the time the rows exist the immature days are
  // already summed into them. The only honest check is on the range the caller
  // pulled, which is why the window is an input rather than something derived
  // from the rows.
  const cutoff = addDays(today, -attributionDays);
  if (window.to > cutoff) {
    return {
      refused: true,
      funnelId: funnel.funnelId,
      reason:
        `Evidence runs to ${window.to}, but with a ${attributionDays}-day ` +
        `attribution window only data through ${cutoff} has finished filling ` +
        'in. Harvesting here would under-count orders on the newest terms and ' +
        'read that under-count as waste. Re-run with an earlier end date.',
    };
  }

  // ---- Gate 2: coverage. Empty and un-ingested look identical. ------------
  const gaps = gapsIn(window, params.covered);
  if (gaps.length > 0) {
    return {
      refused: true,
      funnelId: funnel.funnelId,
      reason:
        `No search-term data ingested for ${gaps
          .map((gap) => `${gap.from}..${gap.to}`)
          .join(', ')} inside ${window.from}..${window.to}. ` +
        'Refusing rather than harvesting from a partial window, where a term ' +
        'that converted in the gap reads as a term that never converted.',
    };
  }

  const nodesById = new Map(funnel.nodes.map((node) => [node.nodeId, node]));
  const skipped: HarvestSkip[] = [];

  // ---- Attribute rows to nodes, then fold close variants together. --------
  const totals = new Map<string, FamilyTotals>();
  let unattributedRows = 0;
  for (const row of params.rows) {
    const node = attribute(row, funnel.nodes);
    if (!node) {
      unattributedRows += 1;
      continue;
    }
    const family = termFamilyKey(row.searchTerm);
    if (!family) continue;
    const key = `${node.nodeId}::${family}`;
    const existing = totals.get(key);
    if (existing) {
      accumulate(existing, row);
      continue;
    }
    const fresh: FamilyTotals = {
      node,
      family,
      variants: new Set<string>(),
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0,
      rows: 0,
    };
    accumulate(fresh, row);
    totals.set(key, fresh);
  }

  const alreadyGraduated = new Set(
    params.graduations.map((record) => record.graduationId)
  );
  const existing = new Set(
    (params.existingKeywords ?? []).map(
      (keyword) =>
        `${keyword.adGroupId}::${normalizeSearchTerm(
          keyword.keyword
        )}::${keyword.matchType.toLowerCase()}`
    )
  );
  const budgets = new Map(
    (params.budgets ?? []).map((signal) => [signal.campaignId, signal])
  );

  const edgesByNode = new Map<string, FunnelEdge[]>();
  for (const edge of funnel.edges) {
    const list = edgesByNode.get(edge.from) ?? [];
    list.push(edge);
    edgesByNode.set(edge.from, list);
  }

  // ---- Graduations, per edge so each edge's cap is its own. ---------------
  const perEdge = new Map<string, GraduationProposal[]>();
  const graduatedFamilies = new Set<string>();

  for (const family of totals.values()) {
    const outgoing = edgesByNode.get(family.node.nodeId) ?? [];
    if (outgoing.length === 0) continue;

    // The log is consulted BEFORE the thresholds, and the order matters.
    //
    // A term that graduated last month legitimately goes quiet upstream — its
    // traffic moved downstream, which is the entire point — so it now shows
    // clicks and no orders in the source. Judged on thresholds first it fails
    // every edge, falls through to the waste rule, and gets proposed for a
    // negative that the graduation ALREADY scheduled as a backward obligation:
    // the term is cut twice, once on a timetable and once by surprise.
    const graduatedHere = outgoing.some((edge) =>
      alreadyGraduated.has(
        graduationId({
          funnelId: funnel.funnelId,
          fromNodeId: family.node.nodeId,
          toNodeId: edge.to,
          term: family.family,
        })
      )
    );
    if (graduatedHere) {
      // Not a skip worth reporting: re-proposing what already graduated is the
      // normal steady state of a funnel that runs every week.
      graduatedFamilies.add(`${family.node.nodeId}::${family.family}`);
      continue;
    }

    const evidence = evidenceOf(family, window, attributionDays);
    const qualifying = outgoing.filter((edge) =>
      meetsPolicy(evidence, edge.policy)
    );
    if (qualifying.length === 0) continue;

    // The rule picks the destination, not a fixed next step. Among the edges
    // this term qualifies for, take the most specific destination: a term with
    // proven orders should go straight to exact rather than take a detour
    // through phrase to re-learn what the evidence already says.
    const edge = qualifying.sort(
      (a, b) =>
        specificity(nodesById.get(b.to)) - specificity(nodesById.get(a.to))
    )[0];
    const destination = nodesById.get(edge.to);
    if (!destination) continue;

    const id = graduationId({
      funnelId: funnel.funnelId,
      fromNodeId: family.node.nodeId,
      toNodeId: destination.nodeId,
      term: family.family,
    });

    const matchType = matchTypeFor(destination.role);
    if (!matchType) {
      skipped.push({
        term: family.family,
        fromNodeId: family.node.nodeId,
        toNodeId: destination.nodeId,
        reason: `${destination.nodeId} is an auto ad group — keywords cannot be created in one.`,
      });
      continue;
    }

    if (
      existing.has(`${destination.adGroupId}::${family.family}::${matchType}`)
    ) {
      skipped.push({
        term: family.family,
        fromNodeId: family.node.nodeId,
        toNodeId: destination.nodeId,
        reason: `Already a ${matchType} keyword in ${destination.adGroupId}.`,
      });
      graduatedFamilies.add(`${family.node.nodeId}::${family.family}`);
      continue;
    }

    const scope = checkProductScope(family.node, destination, edge.policy);
    if (!scope.ok) {
      skipped.push({
        term: family.family,
        fromNodeId: family.node.nodeId,
        toNodeId: destination.nodeId,
        reason: scope.reason,
      });
      continue;
    }

    const saturation = checkSaturation(destination, edge.policy, budgets);
    if (!saturation.ok) {
      skipped.push({
        term: family.family,
        fromNodeId: family.node.nodeId,
        toNodeId: destination.nodeId,
        reason: saturation.reason,
      });
      continue;
    }

    const sourceCpc = family.clicks > 0 ? family.spend / family.clicks : 0;
    const proposals = perEdge.get(edgeKey(edge)) ?? [];
    proposals.push({
      kind: 'graduate',
      graduationId: id,
      term: family.family,
      variants: [...family.variants].sort(),
      from: family.node,
      to: destination,
      matchType,
      bid: bidFor(sourceCpc, edge.policy),
      sourceCpc,
      evidence,
      productScopeChecked: scope.checked,
      overlapDays: edge.policy.overlapDays,
    });
    perEdge.set(edgeKey(edge), proposals);
  }

  const graduations: GraduationProposal[] = [];
  for (const [key, proposals] of perEdge) {
    const cap =
      funnel.edges.find((edge) => edgeKey(edge) === key)?.policy.maxPerRun ??
      10;
    const ranked = proposals.sort(byEvidenceStrength);
    for (const proposal of ranked.slice(0, cap)) {
      graduations.push(proposal);
      graduatedFamilies.add(`${proposal.from.nodeId}::${proposal.term}`);
    }
    for (const proposal of ranked.slice(cap)) {
      skipped.push({
        term: proposal.term,
        fromNodeId: proposal.from.nodeId,
        toNodeId: proposal.to.nodeId,
        reason:
          `Over the ${cap}-per-run cap for this edge. Held back rather than ` +
          'dropped — a large batch makes the destination unattributable.',
      });
      // Held back, not rejected. It must not then be proposed as waste in the
      // same run: a term good enough to graduate next week is not waste today.
      graduatedFamilies.add(`${proposal.from.nodeId}::${proposal.term}`);
    }
  }

  // ---- The inverse rule: terms that only ever cost money. -----------------
  const negativesByNode = new Map<string, NegativeProposal[]>();
  for (const family of totals.values()) {
    if (graduatedFamilies.has(`${family.node.nodeId}::${family.family}`)) {
      continue;
    }
    if (family.orders > 0) continue;

    const policy = wastePolicyFor(family.node, funnel.waste);
    if (!policy) continue;
    if (family.clicks < policy.minClicks) continue;
    if (family.spend < policy.minSpend) continue;

    const list = negativesByNode.get(family.node.nodeId) ?? [];
    list.push({
      kind: 'negative',
      term: family.family,
      variants: [...family.variants].sort(),
      node: family.node,
      matchType: 'negativeExact',
      evidence: evidenceOf(family, window, attributionDays),
    });
    negativesByNode.set(family.node.nodeId, list);
  }

  const negatives: NegativeProposal[] = [];
  for (const [nodeId, list] of negativesByNode) {
    const node = nodesById.get(nodeId);
    const cap = (node && wastePolicyFor(node, funnel.waste)?.maxPerRun) ?? 10;
    // Most wasteful first: spend is the thing being stopped.
    const ranked = list.sort((a, b) => b.evidence.spend - a.evidence.spend);
    negatives.push(...ranked.slice(0, cap));
    for (const proposal of ranked.slice(cap)) {
      skipped.push({
        term: proposal.term,
        fromNodeId: nodeId,
        reason: `Over the ${cap}-per-run waste cap for this ad group.`,
      });
    }
  }

  return {
    refused: false,
    funnelId: funnel.funnelId,
    window,
    attributionDays,
    graduations,
    negatives,
    skipped,
    unattributedRows,
    rowsConsidered: params.rows.length,
  };
}

// ---------------------------------------------------------------------------

type FamilyTotals = {
  node: FunnelNode;
  family: string;
  variants: Set<string>;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  rows: number;
};

/**
 * The waste thresholds for one node, or `null` when the rule is off.
 *
 * The funnel-level override is applied key by key rather than by spreading the
 * whole object: a partial policy carrying an explicit `undefined` — which is
 * what an optional field deserialises to — would otherwise erase the objective's
 * own threshold and turn a patient rule into one that fires on the first click.
 *
 * An override cannot switch the rule back ON for launch or defensive. Those are
 * off because negating there defeats the campaign's purpose, and a global
 * default is not the place to reverse that.
 */
function wastePolicyFor(
  node: FunnelNode,
  override: Partial<WastePolicy> | undefined
): WastePolicy | null {
  const base =
    WASTE_BY_OBJECTIVE[node.objective ?? defaultObjectiveForRole(node.role)];
  if (!base) return null;
  return {
    minClicks: override?.minClicks ?? base.minClicks,
    minSpend: override?.minSpend ?? base.minSpend,
    maxPerRun: override?.maxPerRun ?? base.maxPerRun,
  };
}

function accumulate(totals: FamilyTotals, row: HarvestRow): void {
  totals.variants.add(normalizeSearchTerm(row.searchTerm));
  totals.impressions += row.impressions || 0;
  totals.clicks += row.clicks || 0;
  totals.spend += row.spend || 0;
  totals.sales += row.sales || 0;
  totals.orders += row.orders || 0;
  totals.rows += 1;
}

function evidenceOf(
  totals: FamilyTotals,
  window: { from: string; to: string },
  attributionDays: number
): HarvestEvidence {
  return {
    impressions: totals.impressions,
    clicks: totals.clicks,
    orders: totals.orders,
    spend: totals.spend,
    sales: totals.sales,
    acos: acosOf(totals.spend, totals.sales),
    from: window.from,
    to: window.to,
    attributionDays,
    rows: totals.rows,
  };
}

/**
 * Which node a row belongs to.
 *
 * Ids win when the row has them. Names are matched only as a fallback, and only
 * on BOTH campaign and ad group — an ad group name alone repeats across
 * campaigns often enough ("SP - Exact") that matching on it would attribute one
 * campaign's evidence to another's node.
 */
function attribute(row: HarvestRow, nodes: FunnelNode[]): FunnelNode | null {
  if (row.campaignId && row.adGroupId) {
    return (
      nodes.find(
        (node) =>
          node.campaignId === row.campaignId && node.adGroupId === row.adGroupId
      ) ?? null
    );
  }
  if (row.campaignName && row.adGroupName) {
    const campaign = row.campaignName.trim().toLowerCase();
    const adGroup = row.adGroupName.trim().toLowerCase();
    return (
      nodes.find(
        (node) =>
          node.campaignName?.trim().toLowerCase() === campaign &&
          node.adGroupName?.trim().toLowerCase() === adGroup
      ) ?? null
    );
  }
  return null;
}

function meetsPolicy(
  evidence: HarvestEvidence,
  policy: GraduationPolicy
): boolean {
  if (evidence.clicks < policy.minClicks) return false;
  if (evidence.orders < policy.minOrders) return false;
  if (evidence.spend < policy.minSpend) return false;
  if (policy.maxAcos !== undefined) {
    // No sales means no ACOS, and an undefined ACOS cannot satisfy a ceiling.
    // Treating it as 0 would let the worst rows through the efficiency gate.
    if (evidence.acos === undefined) return false;
    if (evidence.acos > policy.maxAcos) return false;
  }
  return true;
}

/** exact > phrase > broad. Auto is never a destination for a keyword. */
function specificity(node: FunnelNode | undefined): number {
  switch (node?.role) {
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

function matchTypeFor(
  role: FunnelNode['role']
): 'broad' | 'phrase' | 'exact' | null {
  return role === 'auto' ? null : role;
}

function bidFor(sourceCpc: number, policy: GraduationPolicy): number {
  const raw = sourceCpc * policy.bidUplift;
  const bounded = Math.min(Math.max(raw, policy.minBid), policy.maxBid);
  return Math.round(bounded * 100) / 100;
}

function edgeKey(edge: FunnelEdge): string {
  return `${edge.from}->${edge.to}`;
}

function byEvidenceStrength(
  a: GraduationProposal,
  b: GraduationProposal
): number {
  if (b.evidence.orders !== a.evidence.orders) {
    return b.evidence.orders - a.evidence.orders;
  }
  if (b.evidence.sales !== a.evidence.sales) {
    return b.evidence.sales - a.evidence.sales;
  }
  return b.evidence.clicks - a.evidence.clicks;
}

/**
 * Do source and destination advertise a compatible product set?
 *
 * An unknown set on either side is a refusal, not a pass. The product list is
 * read from the API when the funnel is mapped, so an empty one means nobody has
 * looked — and defaulting an unverified gate to "allowed" is how a gate becomes
 * decoration.
 */
function checkProductScope(
  from: FunnelNode,
  to: FunnelNode,
  policy: GraduationPolicy
): { ok: true; checked: boolean } | { ok: false; reason: string } {
  if (policy.productScope === 'ignore') {
    return { ok: true, checked: false };
  }
  if (
    from.advertisedProductIds.length === 0 ||
    to.advertisedProductIds.length === 0
  ) {
    return {
      ok: false,
      reason:
        'Product scope unknown for ' +
        (from.advertisedProductIds.length === 0 ? from.nodeId : to.nodeId) +
        ' — re-map the funnel so the advertised ASINs are read from the API, ' +
        'or set this edge to ignore product scope deliberately.',
    };
  }

  const source = new Set(from.advertisedProductIds);
  const target = new Set(to.advertisedProductIds);
  const missing = [...target].filter((asin) => !source.has(asin));
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `${to.nodeId} advertises ${missing.join(', ')}, which ${from.nodeId} ` +
        'does not — the evidence says nothing about how this term performs ' +
        'for those products.',
    };
  }
  if (policy.productScope === 'exact' && target.size !== source.size) {
    const absent = [...source].filter((asin) => !target.has(asin));
    return {
      ok: false,
      reason:
        `${from.nodeId} also advertises ${absent.join(', ')}, which ` +
        `${to.nodeId} does not. The evidence is a blend across products the ` +
        'destination will not run — relax this edge to `subset` if that is ' +
        'intended.',
    };
  }
  return { ok: true, checked: true };
}

/**
 * Refuse to add keywords to a destination that is already spending its budget.
 *
 * Not a nicety. The campaign's daily budget is a fixed pool that Amazon does not
 * pace evenly, so adding winners to a campaign already exhausting early takes
 * impression share from keywords with a proven record and gives it to newcomers
 * with none. The remedy is proposed rather than the graduation dropped quietly.
 */
function checkSaturation(
  destination: FunnelNode,
  policy: GraduationPolicy,
  budgets: Map<string, BudgetSignal>
): { ok: true } | { ok: false; reason: string } {
  const signal = budgets.get(destination.campaignId);
  // No signal is not a red light: budget usage is a separate API call the
  // caller may not have made, and refusing every graduation for want of it
  // would make the common path depend on an optional input.
  if (!signal || signal.dailyBudget <= 0) return { ok: true };

  const used = signal.dailySpend / signal.dailyBudget;
  if (used < policy.saturationRatio) return { ok: true };

  return {
    ok: false,
    reason:
      `${destination.campaignId} is spending ${(used * 100).toFixed(0)}% of ` +
      `its ${signal.dailyBudget} daily budget, so new keywords would divide a ` +
      'pool that is already full and cost the existing ones impression share. ' +
      'Raise the budget or split off a protected destination first.',
  };
}

// ---------------------------------------------------------------------------

/** ISO date arithmetic in UTC, so a local timezone cannot shift a window. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const at = Date.UTC(year, (month ?? 1) - 1, day ?? 1) + days * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/** Parts of `window` no covered range reaches. */
function gapsIn(
  window: { from: string; to: string },
  covered: Array<{ from: string; to: string }>
): Array<{ from: string; to: string }> {
  const ranges = [...covered].sort((a, b) => a.from.localeCompare(b.from));
  const gaps: Array<{ from: string; to: string }> = [];
  let cursor = window.from;
  for (const range of ranges) {
    if (range.to < cursor) continue;
    if (range.from > cursor) {
      gaps.push({
        from: cursor,
        to: earlier(addDays(range.from, -1), window.to),
      });
    }
    if (range.to >= cursor) cursor = addDays(range.to, 1);
    if (cursor > window.to) break;
  }
  if (cursor <= window.to) gaps.push({ from: cursor, to: window.to });
  return gaps;
}

function earlier(a: string, b: string): string {
  return a < b ? a : b;
}
