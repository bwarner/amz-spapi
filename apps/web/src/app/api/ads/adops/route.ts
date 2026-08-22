import {
  buildAdOpsView,
  getCoverage,
  queryHarvestRows,
} from '@amz-spapi/sp-cache';
import { auth0 } from '../../../../lib/auth0';
import { resolveAmazonConnection } from '../../../../lib/amazon-connections';
import { adsClientFor } from '../../../../lib/amazon-clients';
import { captureServerEvent } from '../../../../lib/posthog-server';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('adops');

export const runtime = 'nodejs';

/** How far back the health line averages spend. Matches the delivery window. */
const WINDOW_DAYS = 14;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The AdOps read model (#149).
 *
 * Three identities meet here and none substitutes for another: the funnel
 * belongs to the USER, its campaigns to an advertiser PROFILE, and the stored
 * rows to a SELLER. Conflating any two reads another account's numbers, so each
 * is resolved separately and a missing one degrades rather than guesses.
 *
 * Read-only by construction. `reconcileDueNegatives` is the half that writes,
 * and it runs on a schedule — opening this page must not settle an obligation
 * as a side effect of looking at it.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.sub;

  let sellerId: string | undefined;
  try {
    const resolved = await resolveAmazonConnection({
      apiType: 'SP_API',
      userId,
    });
    if (resolved.connected) sellerId = resolved.connection.profile.seller_id;
  } catch {
    // Reported as the 409 below rather than as a 500: not connected is a
    // state the seller can fix, not a fault.
  }
  if (!sellerId) {
    return Response.json(
      { error: 'Connect an Amazon Seller account to see ad operations.' },
      { status: 409 }
    );
  }

  /**
   * Budgets are best-effort, and their absence is honest rather than fatal.
   *
   * Amazon requires an EDIT scope for some campaign reads, and an advertiser
   * may not have connected Ads at all. `buildAdOpsView` leaves utilisation
   * ABSENT when the budget is unknown — which is the point: a destination whose
   * budget could not be read is not a destination with room.
   */
  const readBudgets = async (campaignIds: string[]) => {
    const empty = new Map<
      string,
      { dailyBudget?: number; keywordCount?: number }
    >();
    if (!campaignIds.length) return empty;

    try {
      const ads = await resolveAmazonConnection({ apiType: 'ADS_API', userId });
      if (!ads.connected) return empty;

      const client = await adsClientFor(ads.connection);
      const [campaigns, keywords] = await Promise.all([
        client.listCampaigns(),
        client.listKeywords(),
      ]);

      const wanted = new Set(campaignIds);
      const counts = new Map<string, number>();
      for (const keyword of (keywords.items ?? []) as Array<{
        campaignId?: string;
      }>) {
        if (!keyword.campaignId || !wanted.has(keyword.campaignId)) continue;
        counts.set(
          keyword.campaignId,
          (counts.get(keyword.campaignId) ?? 0) + 1
        );
      }

      for (const campaign of (campaigns.items ?? []) as Array<{
        campaignId?: string;
        budget?: { budget?: number };
      }>) {
        if (!campaign.campaignId || !wanted.has(campaign.campaignId)) continue;
        empty.set(campaign.campaignId, {
          ...(campaign.budget?.budget === undefined
            ? {}
            : { dailyBudget: campaign.budget.budget }),
          ...(counts.has(campaign.campaignId)
            ? { keywordCount: counts.get(campaign.campaignId) }
            : {}),
        });
      }
      return empty;
    } catch (error) {
      // Degraded, not broken: the funnels and the harvest queue are the point
      // of this screen, and losing the health line must not take them with it.
      log.warn(
        `ad budgets unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return empty;
    }
  };

  try {
    const today = isoDay(Date.now());
    const view = await buildAdOpsView({
      userId,
      readRows: (query) =>
        queryHarvestRows({
          sellerId: sellerId as string,
          from: query.from,
          to: query.to,
          campaignIds: query.campaignIds,
        }),
      readCoverage: () =>
        getCoverage({
          kind: 'search-term',
          sellerId: sellerId as string,
          from: shiftDays(today, -WINDOW_DAYS),
          to: today,
        }),
      readBudgets,
    });

    /**
     * The `viewed` step of the proposal decision funnel (#149).
     *
     * Generated → VIEWED → approved/rejected is the only way to answer whether
     * these proposals are any good: a 20% approval rate means the thresholds
     * are wrong, and nothing else reveals that.
     *
     * Counts only. No search terms — those are competitive intelligence about
     * the seller's catalogue — and no money, because `ops.cost_ledger` is the
     * system of record for spend and gets reconciled against invoices. PostHog
     * answers product questions; Couchbase holds facts.
     */
    captureServerEvent({
      distinctId: userId,
      event: 'adops_viewed',
      properties: {
        funnels: view.funnels.length,
        dueNegativesReady: view.dueNegatives.filter((n) => n.ready).length,
        dueNegativesBlocked: view.dueNegatives.filter((n) => !n.ready).length,
        awaitingApproval: view.awaitingApproval.length,
        // A product metric, not a figure on the page: a screen whose data is
        // routinely a week stale is a screen nobody can act on.
        staleDays: view.freshness.staleDays ?? null,
      },
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`adops view failed: ${message}`);

    /**
     * An unprovisioned environment is not a fault, and must not read as one.
     *
     * Couchbase answers a query against a collection that does not exist with
     * "Keyspace not found" — which is what a scope that has never had the DDL
     * applied looks like, and it is a deployment state rather than a bug. It
     * surfaced here as a generic 500 saying "Could not load ad operations",
     * which sent the reader looking for a fault in the code rather than at
     * `scripts/couchbase-ddl.ts`.
     *
     * Deliberately NOT reported as an empty account. "This environment has no
     * ad_funnels collection" and "you have not adopted a funnel yet" are
     * different facts, and the second one quietly hides the first.
     *
     * The collection name goes to the log, not to the seller: they can do
     * nothing with it, and the operator reading the log can.
     */
    if (/keyspace not found/i.test(message)) {
      return Response.json(
        {
          error:
            'Ad operations are not available in this environment yet — its ' +
            'storage has not been provisioned. This is a configuration issue, ' +
            'not a problem with your account.',
        },
        { status: 503 }
      );
    }

    return Response.json(
      { error: 'Could not load ad operations.' },
      { status: 500 }
    );
  }
}
