import {
  deliveryFromRows,
  dueNegativeDecisions,
  type DeliveryEvidence,
} from './harvest-apply.js';
import {
  listDueNegatives,
  listFunnels,
  listGraduations,
} from './funnel-store.js';
import type { ReconcileRow } from './negative-reconcile.js';

/**
 * A stored row as this view reads it.
 *
 * The delivery gate needs impressions; the health line needs spend. Same rows,
 * two questions.
 */
export type AdOpsRow = ReconcileRow & { spend?: number };

/**
 * The AdOps read model (#149).
 *
 * Assembling this in one place, rather than in the route, is what makes it
 * testable: every number on this screen is a claim about a live ad account, and
 * the ways it can be wrong are quiet. A budget utilisation computed against the
 * wrong window reads as a healthy destination; a freshness line omitted turns
 * week-old ACOS into today's.
 *
 * Strictly READ-ONLY. `reconcileDueNegatives` is the half that writes, and it
 * runs on a schedule; opening a screen must not settle an obligation as a side
 * effect of looking at it. The two share their decision logic
 * (`dueNegativeDecisions`) so the screen cannot disagree with the sweep about
 * what is blocked.
 */

/** How the seller sees a due negative: proposable, or held back and why. */
export type DueNegativeView = {
  graduationId: string;
  term: string;
  fromCampaignId: string;
  toCampaignId: string;
  ready: boolean;
  /** Present when held back. The remedy is what makes it actionable. */
  reason?: string;
  remedy?: string[];
  delivery?: DeliveryEvidence;
};

export type DestinationHealth = {
  campaignId: string;
  keywordCount?: number;
  dailyBudget?: number;
  /** Mean daily spend across the window, not a single day's. */
  spendPerDay?: number;
  /**
   * `spendPerDay / dailyBudget`, absent when either side is unknown.
   *
   * Absent rather than zero: a destination whose budget we could not read is
   * not a destination with room, and graduating into it on that assumption is
   * how existing champions lose impression share to newcomers.
   */
  utilisation?: number;
};

export type AdOpsFunnelView = {
  funnelId: string;
  profileId: string;
  name: string;
  nodes: Array<{ campaignId: string; adGroupId: string; role: string }>;
  edges: Array<{ from: string; to: string }>;
  destinations: DestinationHealth[];
};

/**
 * What the numbers on this screen actually cover.
 *
 * First-class rather than a footnote. Structure is fetched live, performance is
 * not, so a screen that shows both without saying which is which invites the
 * reader to treat a fortnight-old ACOS as current. A page that silently shows
 * week-old numbers is worse than one that shows none.
 */
export type Freshness = {
  /** Latest day any ingested window covers, or absent if nothing is stored. */
  through?: string;
  /** Days inside the requested range with nothing ingested. */
  gaps: Array<{ from: string; to: string }>;
  /** Days between `through` and today. Zero means fresh, absent means unknown. */
  staleDays?: number;
};

export type AdOpsView = {
  funnels: AdOpsFunnelView[];
  dueNegatives: DueNegativeView[];
  awaitingApproval: Array<{
    graduationId: string;
    funnelId: string;
    term: string;
    toCampaignId: string;
    bid: number;
    sourceCpc: number;
    proposedAt: number;
  }>;
  freshness: Freshness;
};

const DELIVERY_WINDOW_DAYS = 14;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Summarise coverage into something a header line can state honestly.
 *
 * `through` is the latest day any ingested window reaches — not the newest
 * import, because an import can backfill an old window and say nothing about
 * whether this week exists.
 */
export function summariseFreshness(
  coverage: {
    covered: Array<{ from: string; to: string }>;
    gaps: Array<{ from: string; to: string }>;
  },
  today: string
): Freshness {
  const through = coverage.covered.reduce<string | undefined>(
    (latest, window) => (!latest || window.to > latest ? window.to : latest),
    undefined
  );

  return {
    ...(through ? { through, staleDays: daysBetween(through, today) } : {}),
    gaps: coverage.gaps,
  };
}

export async function buildAdOpsView(params: {
  userId: string;
  /**
   * Reads stored search-term rows. Injected for the same reason the sweep
   * injects it: the funnel belongs to a user and the rows to a seller, and the
   * caller is the only place that knows both.
   */
  readRows: (query: {
    campaignIds: string[];
    from: string;
    to: string;
  }) => Promise<AdOpsRow[]>;
  /** Stored search-term coverage for the window, for the freshness line. */
  readCoverage: () => Promise<{
    covered: Array<{ from: string; to: string }>;
    gaps: Array<{ from: string; to: string }>;
  }>;
  /**
   * Live campaign budgets, keyed by campaign id.
   *
   * Live because structure can be fetched synchronously while performance
   * cannot. A budget read from a report would be as old as the report, and the
   * saturation question is about the budget in force now.
   */
  readBudgets: (
    campaignIds: string[]
  ) => Promise<Map<string, { dailyBudget?: number; keywordCount?: number }>>;
  now?: number;
}): Promise<AdOpsView> {
  const now = params.now ?? Date.now();
  const today = isoDay(now);
  const from = shiftDays(today, -DELIVERY_WINDOW_DAYS);

  const [stored, coverage, due] = await Promise.all([
    listFunnels({ userId: params.userId }),
    params.readCoverage(),
    listDueNegatives({ userId: params.userId, now }),
  ]);

  // Destinations are the campaigns edges point AT. A source's budget is not a
  // saturation signal — nothing is being graduated into it.
  const destinationIds = [
    ...new Set(
      stored.flatMap((entry) => {
        const byId = new Map(
          entry.funnel.nodes.map((node) => [node.nodeId, node] as const)
        );
        return entry.funnel.edges
          .map((edge) => byId.get(edge.to)?.campaignId)
          .filter((id): id is string => Boolean(id));
      })
    ),
  ];

  const rowCampaigns = [
    ...new Set([
      ...destinationIds,
      ...due.map((record) => record.graduation.toCampaignId),
    ]),
  ];

  const [rows, budgets] = await Promise.all([
    rowCampaigns.length
      ? params.readRows({ campaignIds: rowCampaigns, from, to: today })
      : Promise.resolve([]),
    destinationIds.length
      ? params.readBudgets(destinationIds)
      : Promise.resolve(new Map()),
  ]);

  // The same scoping the sweep uses, and for the same reason: during the
  // overlap the source is still serving the term, so a term-only match would
  // credit the source's impressions to the destination.
  const delivery = deliveryFromRows({
    rows,
    graduations: due.map((record) => record.graduation),
    from,
    to: today,
  });

  const decisions = await dueNegativeDecisions({
    userId: params.userId,
    delivery,
    now,
  });

  const byGraduation = new Map(
    due.map((record) => [record.graduation.graduationId, record.graduation])
  );

  const dueNegatives: DueNegativeView[] = decisions.map((decision) => {
    const graduation = byGraduation.get(decision.graduationId);
    return {
      graduationId: decision.graduationId,
      // From the record rather than the decision: only the refusal branch of
      // `NegativeDecision` carries a term at the top level, and the two must
      // not describe the same graduation differently.
      term: graduation?.term ?? '',
      fromCampaignId: graduation?.fromCampaignId ?? '',
      toCampaignId: graduation?.toCampaignId ?? '',
      ready: decision.propose,
      ...(decision.propose
        ? {}
        : { reason: decision.reason, remedy: decision.remedy }),
      ...(decision.propose === false && decision.delivery
        ? { delivery: decision.delivery }
        : {}),
    };
  });

  const windowDays = daysBetween(from, today) || 1;
  const spendByCampaign = new Map<string, number>();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const spend = row.spend ?? 0;
    spendByCampaign.set(
      row.campaignId,
      (spendByCampaign.get(row.campaignId) ?? 0) + spend
    );
  }

  const health = (campaignId: string): DestinationHealth => {
    const budget = budgets.get(campaignId);
    const spend = spendByCampaign.get(campaignId);
    const spendPerDay = spend === undefined ? undefined : spend / windowDays;
    const dailyBudget = budget?.dailyBudget;
    return {
      campaignId,
      ...(budget?.keywordCount === undefined
        ? {}
        : { keywordCount: budget.keywordCount }),
      ...(dailyBudget === undefined ? {} : { dailyBudget }),
      ...(spendPerDay === undefined ? {} : { spendPerDay }),
      ...(spendPerDay !== undefined && dailyBudget
        ? { utilisation: spendPerDay / dailyBudget }
        : {}),
    };
  };

  const proposed = await listGraduations({
    userId: params.userId,
    state: 'proposed',
  });

  return {
    funnels: stored.map((entry) => {
      const byId = new Map(
        entry.funnel.nodes.map((node) => [node.nodeId, node] as const)
      );
      const destinations = [
        ...new Set(
          entry.funnel.edges
            .map((edge) => byId.get(edge.to)?.campaignId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      return {
        funnelId: entry.funnel.funnelId,
        profileId: entry.funnel.profileId,
        name: entry.funnel.name,
        nodes: entry.funnel.nodes.map((node) => ({
          campaignId: node.campaignId,
          adGroupId: node.adGroupId,
          role: node.role,
        })),
        edges: entry.funnel.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
        })),
        destinations: destinations.map(health),
      };
    }),
    dueNegatives,
    awaitingApproval: proposed.map((entry) => ({
      graduationId: entry.graduation.graduationId,
      funnelId: entry.graduation.funnelId,
      term: entry.graduation.term,
      toCampaignId: entry.graduation.toCampaignId,
      bid: entry.graduation.bid,
      sourceCpc: entry.graduation.sourceCpc,
      proposedAt: entry.graduation.proposedAt,
    })),
    freshness: summariseFreshness(coverage, today),
  };
}
