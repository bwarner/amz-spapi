import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import type { SellerAdsOps } from '@amz-spapi/seller-agent';
import { adsClientFor } from './amazon-clients';
import {
  listAmazonConnections,
  type AmazonConnection,
} from './amazon-connections';

/**
 * Host implementation of read-only Amazon Ads access for the agent (#86).
 *
 * Scoped to a USER rather than a seller, unlike reports. An advertiser profile
 * belongs to an Ads account, and one user commonly holds several — this seller
 * has four (US, Canada, Mexico, Brazil). There is no single "their Ads account"
 * to resolve to, which is why every call carries a `profileId` and why
 * `listProfiles` exists at all.
 *
 * Reads AND writes. The write methods (bids, budgets, states, negative
 * keywords) can spend real money, so their tools carry `needsApproval` in the
 * agent — the chat pauses for an explicit human yes before any of them runs.
 * This layer stays thin on purpose: the approval gate lives in the tool
 * definitions and the reversibility guarantee (ENABLED/PAUSED only, no
 * archive) lives in the ad-client, so there is no policy here to bypass.
 */
export function createAdsOps(params: { userId: string }): SellerAdsOps {
  /**
   * Ads connections for this user, one per advertiser profile.
   *
   * Only those with an `advertiser_profile_id` are usable: every Sponsored
   * Products call needs it as the `Amazon-Advertising-API-Scope` header, and a
   * connection without one authenticates fine and then 401s on every request.
   */
  async function connections(): Promise<AmazonConnection[]> {
    const all = await listAmazonConnections({
      apiType: 'ADS_API',
      userId: params.userId,
    });
    return all.filter((c) => c.profile.advertiser_profile_id);
  }

  /**
   * Mints through the credentials API and re-mints on a 401 (#55). This runtime
   * holds neither the refresh token nor the client secret.
   */
  function clientFor(
    connection: AmazonConnection
  ): Promise<AmazonAdsApiClient> {
    return adsClientFor(connection);
  }

  /**
   * Resolve the profile a call should use.
   *
   * Refuses to guess when the user holds several and named none. Picking the
   * first would silently report one marketplace's campaigns as though they were
   * the whole account — an answer that looks complete and is not, which is worse
   * than a question.
   */
  async function resolve(profileId?: string): Promise<AmazonAdsApiClient> {
    const available = await connections();
    if (available.length === 0) {
      throw new Error(
        'No Amazon Ads account is connected, or the connected one has no ' +
          'advertiser profile. Connect one from Settings.'
      );
    }

    if (profileId) {
      const match = available.find(
        (c) => c.profile.advertiser_profile_id === profileId
      );
      if (!match) {
        throw new Error(
          `No connected Ads profile with id ${profileId}. Call list-ad-profiles ` +
            'to see the available ones.'
        );
      }
      return clientFor(match);
    }

    if (available.length > 1) {
      const options = available
        .map(
          (c) =>
            `${c.profile.advertiser_profile_id} (${c.profile.marketplace_id})`
        )
        .join(', ');
      throw new Error(
        `This account has ${available.length} advertiser profiles and no ` +
          `profileId was given. Ask the user which one, then pass it. ` +
          `Available: ${options}`
      );
    }

    return clientFor(available[0]);
  }

  return {
    async listProfiles() {
      const available = await connections();
      return available.map((c) => ({
        profileId: c.profile.advertiser_profile_id as string,
        marketplaceId: c.profile.marketplace_id,
        profileName: c.profile.profile_name,
        region: c.profile.region ?? undefined,
      }));
    },

    async listCampaigns({ profileId, stateFilter, maxResults }) {
      const client = await resolve(profileId);
      return client.listCampaigns({ stateFilter, maxResults });
    },

    async listAdGroups({ profileId, campaignIdFilter, maxResults }) {
      const client = await resolve(profileId);
      return client.listAdGroups({ campaignIdFilter, maxResults });
    },

    async listKeywords({
      profileId,
      campaignIdFilter,
      adGroupIdFilter,
      maxResults,
    }) {
      const client = await resolve(profileId);
      return client.listKeywords({
        campaignIdFilter,
        adGroupIdFilter,
        maxResults,
      });
    },

    async listNegativeKeywords({ profileId, campaignIdFilter, maxResults }) {
      const client = await resolve(profileId);
      return client.listNegativeKeywords({ campaignIdFilter, maxResults });
    },

    async listProductAds({ profileId, campaignIdFilter, maxResults }) {
      const client = await resolve(profileId);
      return client.listProductAds({ campaignIdFilter, maxResults });
    },

    async getCampaignBudgetUsage({ profileId, campaignIds }) {
      const client = await resolve(profileId);
      return client.getCampaignBudgetUsage(campaignIds);
    },

    async requestPerformanceReport({
      profileId,
      level,
      startDate,
      endDate,
      attribution,
    }) {
      const client = await resolve(profileId);
      return client.requestPerformanceReport({
        level,
        startDate,
        endDate,
        attribution,
      });
    },

    async fetchPerformanceReport({ profileId, reportId }) {
      const client = await resolve(profileId);
      return client.fetchPerformanceReport(reportId);
    },

    async updateCampaigns({ profileId, campaigns }) {
      const client = await resolve(profileId);
      return client.updateCampaigns(campaigns);
    },

    async updateAdGroups({ profileId, adGroups }) {
      const client = await resolve(profileId);
      return client.updateAdGroups(adGroups);
    },

    async updateKeywords({ profileId, keywords }) {
      const client = await resolve(profileId);
      return client.updateKeywords(keywords);
    },

    async createNegativeKeywords({ profileId, negativeKeywords }) {
      const client = await resolve(profileId);
      return client.createNegativeKeywords(negativeKeywords);
    },

    async updateNegativeKeywords({ profileId, negativeKeywords }) {
      const client = await resolve(profileId);
      return client.updateNegativeKeywords(negativeKeywords);
    },
  };
}
