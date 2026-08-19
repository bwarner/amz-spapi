import {
  deliveryFromRows,
  dueNegativeDecisions,
  type DeliveryEvidence,
} from './harvest-apply.js';
import { listDueNegatives, settleGraduation } from './funnel-store.js';

/**
 * Noticing the backward negatives that came due (#147).
 *
 * A graduation is two obligations separated in time, and only the first one
 * happens while anybody is watching. The keyword is created downstream during a
 * conversation; the negative that cuts the term upstream falls due fourteen
 * days later, when nobody is looking at this funnel and there is no reason they
 * would be.
 *
 * Until something sweeps for them, "came due and was never applied" is
 * indistinguishable from "never came due". The seller is bidding against
 * themselves in two campaigns, their own CPC rises, attribution splits across
 * the pair, and nothing anywhere says so. That silence is the failure this
 * exists to end — reconciling these IS the self-competition detector.
 *
 * ## What it deliberately does not do
 *
 * It does not apply anything. Detection is scheduled; application is approved.
 * A negative switches off a traffic source that is, by definition, converting —
 * it earned its graduation — so the same premise as the cost ledger holds here:
 * the machine may notice, and a human decides.
 *
 * What it produces instead is a record. A blocked negative gets its reason
 * written onto the graduation, so the next person to look — in chat, or on the
 * AdOps screen (#149) — finds out why the funnel stopped halfway rather than
 * finding nothing at all.
 */

/** The subset of a stored search-term row this needs. */
export type ReconcileRow = {
  campaignId?: string;
  adGroupId?: string;
  searchTerm: string;
  impressions: number;
  clicks: number;
};

export type ReconcileSummary = {
  /** Graduations carrying a negative whose overlap window has closed. */
  due: number;
  /** Ready to propose: the destination is shown to be serving. */
  ready: number;
  /** Due, but the destination has not proved it delivers. Cutting now loses sales. */
  blocked: number;
  /**
   * Why each blocked one is blocked.
   *
   * Carried out rather than only written down, so a log line and an alarm can
   * name the funnel that has been stuck for a week.
   */
  blockedDetail: Array<{
    graduationId: string;
    term: string;
    reason: string;
    remedy: string[];
  }>;
};

/**
 * How much delivery evidence the gate reads.
 *
 * Deliberately shorter than the harvest window: the question is whether the
 * destination is serving NOW, and sixty days would let a keyword that died
 * three weeks ago still look alive.
 */
const DELIVERY_WINDOW_DAYS = 14;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function reconcileDueNegatives(params: {
  userId: string;
  profileId?: string;
  funnelId?: string;
  /**
   * Reads stored search-term rows.
   *
   * Injected rather than imported so this is testable without a database, and
   * so the caller owns which seller's rows are in scope — the funnel belongs to
   * a user, the rows belong to a seller, and conflating the two would read
   * another account's numbers.
   */
  readRows: (query: {
    campaignIds: string[];
    from: string;
    to: string;
  }) => Promise<ReconcileRow[]>;
  now?: number;
}): Promise<ReconcileSummary> {
  const now = params.now ?? Date.now();

  const due = await listDueNegatives({
    userId: params.userId,
    ...(params.funnelId ? { funnelId: params.funnelId } : {}),
    now,
  });

  if (!due.length) {
    return { due: 0, ready: 0, blocked: 0, blockedDetail: [] };
  }

  const to = isoDay(now);
  const from = shiftDays(to, -DELIVERY_WINDOW_DAYS);

  // Only the DESTINATIONS. Fetching every funnel campaign would pull the source
  // rows too, and the source is still serving this term during the overlap —
  // that is what the overlap is for. `deliveryFromRows` filters by campaign for
  // the same reason; narrowing here means the wrong rows are never in hand.
  const campaignIds = [
    ...new Set(due.map((record) => record.graduation.toCampaignId)),
  ];

  const rows = await params.readRows({ campaignIds, from, to });

  const delivery: Map<string, DeliveryEvidence> = deliveryFromRows({
    rows,
    graduations: due.map((record) => record.graduation),
    from,
    to,
  });

  const decisions = await dueNegativeDecisions({
    userId: params.userId,
    ...(params.profileId ? { profileId: params.profileId } : {}),
    delivery,
    now,
  });

  const summary: ReconcileSummary = {
    due: decisions.length,
    ready: 0,
    blocked: 0,
    blockedDetail: [],
  };

  for (const decision of decisions) {
    if (decision.propose) {
      summary.ready += 1;
      continue;
    }

    summary.blocked += 1;
    summary.blockedDetail.push({
      graduationId: decision.graduationId,
      term: decision.term,
      reason: decision.reason,
      remedy: decision.remedy,
    });

    const record = due.find(
      (entry) => entry.graduation.graduationId === decision.graduationId
    );
    if (!record) continue;

    // The negative stays `scheduled`: it is still owed, and the destination may
    // start delivering tomorrow. What changes is that the reason is now written
    // down. Only write when it actually changed — this sweep runs on every sync
    // and rewriting an identical document would bury the real transitions in
    // the record's own history.
    if (record.graduation.note === decision.reason) continue;

    await settleGraduation({
      userId: params.userId,
      graduationId: decision.graduationId,
      note: decision.reason,
    });
  }

  return summary;
}
