import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import {
  applyBackwardNegative,
  applyGraduation,
  deliveryFromRows,
  dueNegativeDecisions,
  getCoverage,
  getFunnel,
  inferFunnelTopology,
  listFunnels,
  listGraduations,
  planHarvest,
  queryHarvestRows,
  storeFunnel,
} from '@amz-spapi/sp-cache';
import type { SellerHarvestOps } from '@amz-spapi/seller-agent';
import { loggerFor } from './logger';

const log = loggerFor('harvest');

/**
 * Host implementation of keyword harvest funnels for the agent (#147).
 *
 * ## The three identities this bridges
 *
 * A harvest is the only feature that needs all three at once, which is why it
 * has its own ops rather than more methods on the ads ops:
 *
 * - `userId` owns the FUNNEL. The relationship between campaigns is ours, not
 *   Amazon's, so it belongs to the person who described it.
 * - `profileId` owns the CAMPAIGNS. An advertiser profile is its own account.
 * - `sellerId` owns the ROWS. Reports describe an Amazon seller account, and
 *   two users on one account must read one set of numbers.
 *
 * Conflating any two of them is a data leak between accounts, so they are
 * separate parameters here rather than one "account".
 */

/**
 * How far back a harvest looks by default.
 *
 * Long enough that a term accumulates the clicks the rules ask for; short
 * enough that it describes how the account behaves NOW rather than averaging in
 * a bid change from two months ago.
 */
const DEFAULT_WINDOW_DAYS = 60;

/**
 * Days of the window that are still filling in.
 *
 * The column is "7 Day Total Orders", so the last seven days under-report
 * conversions — a harvest that includes them proposes proven winners as waste.
 * `planHarvest` enforces this itself; the default window is chosen to satisfy
 * it rather than to be refused by it.
 */
const ATTRIBUTION_DAYS = 7;

/**
 * How much delivery evidence the negative gate reads.
 *
 * Shorter than the harvest window on purpose: the question is whether the
 * destination keyword is serving NOW, and a 60-day window would let a keyword
 * that died three weeks ago still look alive.
 */
const DELIVERY_WINDOW_DAYS = 14;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

export function createHarvestOps(params: {
  userId: string;
  sellerId: string;
  /**
   * Resolve the Ads client and the profile it is scoped to.
   *
   * A resolver rather than a client, for the same reason `createAdsOps` uses
   * one: an advertiser with several profiles who names none must be ASKED, not
   * guessed at. Picking the first would key a funnel to one marketplace while
   * presenting it as the account's.
   */
  resolveAds: (
    profileId?: string
  ) => Promise<{ client: AmazonAdsApiClient; profileId: string }>;
  /** Injected so a harvest is reproducible in a test rather than clock-bound. */
  now?: () => number;
}): SellerHarvestOps {
  const now = params.now ?? (() => Date.now());

  return {
    async listFunnels() {
      const funnels = await listFunnels({ userId: params.userId });
      return funnels.map((stored) => ({
        funnelId: stored.funnel.funnelId,
        profileId: stored.funnel.profileId,
        name: stored.funnel.name,
        nodes: stored.funnel.nodes.map((node) => ({
          campaignId: node.campaignId,
          adGroupId: node.adGroupId,
          role: node.role,
        })),
        edges: stored.funnel.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
        })),
      }));
    },

    async proposeFunnel({ profileId, productIds }) {
      const { client, profileId: profile } = await params.resolveAds(profileId);
      const [campaigns, adGroups, keywords, productAds] = await Promise.all([
        // No `profileId` argument: the client is constructed against one
        // profile and sends it as the Scope header, so passing it here would
        // be a second, ignored source of truth.
        client.listCampaigns(),
        client.listAdGroups(),
        client.listKeywords(),
        client.listProductAds(),
      ]);

      // Normalised once so the id and the filter agree: an id derived from
      // `b0abc` and a filter matching `B0ABC` would key two funnels to what the
      // seller typed rather than to what they meant.
      const scope = productIds?.length
        ? [...new Set(productIds.map((id) => id.trim().toUpperCase()))].sort()
        : undefined;

      const proposal = inferFunnelTopology({
        profileId: profile,
        name: scope
          ? `Harvest funnel — ${scope.join(', ')}`
          : `Harvest funnel ${profile}`,
        // Derived from the profile AND the scope, not random: re-proposing the
        // same scope must land on the same id, or confirming twice would store
        // two funnels describing one structure.
        //
        // The scope has to be IN the id. Keying only on the profile means a
        // funnel for one product silently overwrites the funnel for another —
        // the seller adopts their cups funnel, adopts their teapots funnel, and
        // the first one is gone with nothing said.
        funnelId: scope
          ? `funnel-${profile}-${scope.join('-')}`
          : `funnel-${profile}`,
        campaigns: (campaigns.items ?? []) as never,
        adGroups: (adGroups.items ?? []) as never,
        keywords: (keywords.items ?? []) as never,
        productAds: (productAds.items ?? []) as never,
        readAt: now(),
        ...(scope ? { productIds: scope } : {}),
      });

      return {
        proposal: proposal.funnel,
        skipped: proposal.skipped,
        // Ad groups whose keywords disagree about match type. Surfaced rather
        // than resolved: a B/P/E ad group is a real structure, and its role is
        // genuinely ambiguous, so a human corrects it instead of a coin flip.
        mixed: proposal.mixed,
        ...(proposal.funnel?.nodes?.length
          ? {}
          : {
              reason:
                'No campaign in this profile could be read as a funnel tier. ' +
                'Harvesting needs at least one discovery campaign (auto or ' +
                'broad) and one destination (phrase or exact).',
            }),
      };
    },

    async saveFunnel({ profileId, funnel }) {
      const { profileId: profile } = await params.resolveAds(profileId);
      const stored = await storeFunnel({
        userId: params.userId,
        // Validated by `storeFunnel` against the Zod schema — this arrives
        // from a model tool call and is not trusted here.
        funnel: { ...(funnel as object), profileId: profile } as never,
      });
      log.info(
        `stored funnel ${stored.funnel.funnelId} for ${params.userId} ` +
          `(${stored.funnel.nodes.length} nodes, ${stored.funnel.edges.length} edges)`
      );
      return { funnelId: stored.funnel.funnelId };
    },

    async planHarvest({ funnelId, from, to }) {
      const stored = await getFunnel(params.userId, funnelId);
      if (!stored) {
        return {
          refused: true,
          reason: `No funnel ${funnelId}. Call list-harvest-funnels.`,
        };
      }

      const today = isoDay(new Date(now()));
      // Default the window to END where attribution closes rather than today.
      // Defaulting to today would make every unqualified call a refusal, and
      // the refusal would read as "your data is bad" rather than "I asked for
      // days that are still counting".
      const windowTo = to ?? shiftDays(today, -ATTRIBUTION_DAYS);
      const windowFrom =
        from ?? shiftDays(windowTo, -(DEFAULT_WINDOW_DAYS - 1));

      const campaignIds = [
        ...new Set(stored.funnel.nodes.map((node) => node.campaignId)),
      ];

      const [rows, coverage, graduations, budgetUsage] = await Promise.all([
        queryHarvestRows({
          sellerId: params.sellerId,
          from: windowFrom,
          to: windowTo,
          campaignIds,
        }),
        getCoverage({
          kind: 'search-term',
          sellerId: params.sellerId,
          from: windowFrom,
          to: windowTo,
        }),
        listGraduations({ userId: params.userId, funnelId }),
        params
          .resolveAds(stored.funnel.profileId)
          .then(({ client }) => client.getCampaignBudgetUsage(campaignIds))
          // Today's burn only, and Amazon requires an EDIT scope for it. A 403
          // here must not fail the whole plan — the saturation gate then has
          // no signal, which `planHarvest` already treats as unknown rather
          // than as headroom.
          .catch(() => undefined),
      ]);

      return planHarvest({
        funnel: stored.funnel,
        rows,
        window: { from: windowFrom, to: windowTo },
        today,
        attributionDays: ATTRIBUTION_DAYS,
        covered: coverage.covered,
        graduations: graduations.map((entry) => entry.graduation),
        budgets: budgetUsage as never,
      });
    },

    async applyGraduation({ funnelId, graduationId }) {
      const stored = await getFunnel(params.userId, funnelId);
      if (!stored) {
        return { applied: false, reason: `No funnel ${funnelId}.` };
      }
      // Re-planned rather than trusting a proposal the model echoed back: the
      // id names a decision, and the evidence behind it must be read fresh
      // from storage rather than accepted from the conversation.
      const plan = (await this.planHarvest({ funnelId })) as {
        refused?: boolean;
        reason?: string;
        graduations?: Array<{ graduationId: string }>;
      };
      if (plan.refused) return { applied: false, reason: plan.reason };

      const proposal = plan.graduations?.find(
        (entry) => entry.graduationId === graduationId
      );
      if (!proposal) {
        return {
          applied: false,
          reason:
            `${graduationId} is not in the current plan. The evidence may ` +
            'have changed since it was proposed — re-run plan-harvest.',
        };
      }

      const { client } = await params.resolveAds(stored.funnel.profileId);
      return applyGraduation({
        client,
        userId: params.userId,
        funnelId,
        profileId: stored.funnel.profileId,
        proposal: proposal as never,
        now: now(),
      });
    },

    async dueNegatives({ funnelId }) {
      const stored = await getFunnel(params.userId, funnelId);
      if (!stored) return { decisions: [], reason: `No funnel ${funnelId}.` };

      const today = isoDay(new Date(now()));
      const from = shiftDays(today, -DELIVERY_WINDOW_DAYS);

      const graduations = await listGraduations({
        userId: params.userId,
        funnelId,
      });

      // Delivery is read from the DESTINATION's own rows, and the query is
      // narrowed to destination campaigns for the same reason `deliveryFromRows`
      // filters by them: during the overlap the source is still serving this
      // term, so a term-only match would credit the source's impressions to the
      // destination and wave through the negative this gate exists to hold.
      const destinations = [
        ...new Set(graduations.map((entry) => entry.graduation.toCampaignId)),
      ];
      const rows = destinations.length
        ? await queryHarvestRows({
            sellerId: params.sellerId,
            from,
            to: today,
            campaignIds: destinations,
          })
        : [];

      const delivery = deliveryFromRows({
        rows,
        graduations: graduations.map((entry) => entry.graduation),
        from,
        to: today,
      });

      const decisions = await dueNegativeDecisions({
        userId: params.userId,
        profileId: stored.funnel.profileId,
        delivery,
        now: now(),
      });
      return { decisions, deliveryWindow: { from, to: today } };
    },

    async applyNegative({ funnelId, graduationId }) {
      // The funnel is read for its PROFILE, not to validate the graduation —
      // `applyBackwardNegative` owns that check, and duplicating it here would
      // be a second gate to keep in step with the first.
      const stored = await getFunnel(params.userId, funnelId);
      if (!stored) return { applied: false, reason: `No funnel ${funnelId}.` };
      const { client } = await params.resolveAds(stored.funnel.profileId);
      return applyBackwardNegative({
        client,
        userId: params.userId,
        graduationId,
        now: now(),
      });
    },
  };
}
