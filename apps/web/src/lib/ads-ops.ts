import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import type { SellerAdsOps } from '@amz-spapi/seller-agent';
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
 * Read-only by design. Nothing here changes a bid, a budget or a state: writes
 * mean the agent can spend money and belong behind the approval flow and the
 * cost ledger, which is a separate piece of work.
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

  function clientFor(connection: AmazonConnection): AmazonAdsApiClient {
    const profile = connection.profile;
    return new AmazonAdsApiClient({
      clientId: profile.client_id,
      clientSecret: profile.client_secret,
      refreshToken: profile.refresh_token,
      accessToken: profile.access_token,
      marketplaceId: profile.marketplace_id,
      region: (profile.region as 'NA' | 'EU' | 'FE') || 'NA',
      profileId: profile.advertiser_profile_id,
    });
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
  };
}
