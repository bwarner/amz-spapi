import { auth0 } from '../../../../lib/auth0';
import { listAmazonConnections } from '../../../../lib/amazon-connections';
import { getCredentialStore } from '../../../../lib/credential-store';
import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import { SpApiClient } from '@farvisionllc/sp-client';

type ConnectionProbeResult = {
  apiType: 'SP_API' | 'ADS_API';
  profileName: string;
  marketplaceId: string;
  region?: string;
  sellerId?: string;
  advertiserProfileId?: string;
  ok: boolean;
  source: 'stored' | 'env';
  probe: string;
  summary: string;
  details?: Record<string, unknown>;
  error?: string;
};

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.sub;
  const credStore = getCredentialStore();
  const results: ConnectionProbeResult[] = [];

  const spConnections = await listAmazonConnections({
    apiType: 'SP_API',
    userId,
  });
  const adsConnections = await listAmazonConnections({
    apiType: 'ADS_API',
    userId,
    requireAdvertiserProfileId: true,
  });

  for (const connection of spConnections) {
    const { profile, profileName, missing } = connection;
    const source = profileName === 'env-self-auth' ? 'env' : 'stored';

    if (missing.length) {
      results.push({
        apiType: 'SP_API',
        profileName,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        sellerId: profile.seller_id,
        ok: false,
        source,
        probe: 'inventorySummaries',
        summary: `Missing ${missing.join(', ')}`,
        error: `Connection is incomplete: ${missing.join(', ')}`,
      });
      continue;
    }

    try {
      const client = new SpApiClient({
        clientId: profile.client_id,
        clientSecret: profile.client_secret,
        refreshToken: profile.refresh_token,
        accessToken: profile.access_token,
        sellerId: profile.seller_id,
        marketplaceId: profile.marketplace_id,
        region: (profile.region as 'NA' | 'EU' | 'FE') || 'NA',
        onTokenRefresh:
          source === 'stored'
            ? async (accessToken, expiresIn) => {
                await credStore.updateAccessToken(
                  profileName,
                  'SP_API',
                  accessToken,
                  expiresIn,
                  userId
                );
              }
            : undefined,
      });

      const inventory = (await client.getInventorySummaries({
        granularityType: 'Marketplace',
        granularityId: profile.marketplace_id,
        marketplaceIds: [profile.marketplace_id],
      })) as {
        inventorySummaries?: Array<{ asin?: string; sellerSku?: string }>;
        nextToken?: string;
      };

      const firstItem = inventory.inventorySummaries?.[0];

      results.push({
        apiType: 'SP_API',
        profileName,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        sellerId: profile.seller_id,
        ok: true,
        source,
        probe: 'inventorySummaries',
        summary: `Inventory probe succeeded${
          inventory.inventorySummaries?.length
            ? ` with ${inventory.inventorySummaries.length} items on the first page`
            : ' with an empty first page'
        }.`,
        details: {
          firstAsin: firstItem?.asin,
          firstSku: firstItem?.sellerSku,
          hasNextToken: Boolean(inventory.nextToken),
        },
      });
    } catch (error) {
      results.push({
        apiType: 'SP_API',
        profileName,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        sellerId: profile.seller_id,
        ok: false,
        source,
        probe: 'inventorySummaries',
        summary: 'Inventory probe failed.',
        error: error instanceof Error ? error.message : 'Unknown SP-API error',
      });
    }
  }

  for (const connection of adsConnections) {
    const { profile, profileName, missing } = connection;

    if (missing.length) {
      results.push({
        apiType: 'ADS_API',
        profileName,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        advertiserProfileId: profile.advertiser_profile_id,
        ok: false,
        source: 'stored',
        probe: 'profiles+brandRecommendations',
        summary: `Missing ${missing.join(', ')}`,
        error: `Connection is incomplete: ${missing.join(', ')}`,
      });
      continue;
    }

    try {
      const client = new AmazonAdsApiClient({
        clientId: profile.client_id,
        clientSecret: profile.client_secret,
        refreshToken: profile.refresh_token,
        accessToken: profile.access_token,
        marketplaceId: profile.marketplace_id,
        region: (profile.region as 'NA' | 'EU' | 'FE') || 'NA',
        profileId: profile.advertiser_profile_id,
        onTokenRefresh: async (accessToken, expiresIn) => {
          await credStore.updateAccessToken(
            profileName,
            'ADS_API',
            accessToken,
            expiresIn,
            userId
          );
        },
      });

      const [profilesResponse, brands] = await Promise.all([
        client.getProfiles(),
        client.getNegativeBrands(),
      ]);

      const profiles = Array.isArray(profilesResponse.data)
        ? profilesResponse.data
        : [];

      results.push({
        apiType: 'ADS_API',
        profileName,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        advertiserProfileId: profile.advertiser_profile_id,
        ok: true,
        source: 'stored',
        probe: 'profiles+brandRecommendations',
        summary: `Ads probe succeeded with ${profiles.length} visible profiles and ${brands.length} brand recommendations.`,
        details: {
          profileCount: profiles.length,
          firstBrand: brands[0]?.name,
          firstBrandId: brands[0]?.id,
        },
      });
    } catch (error) {
      results.push({
        apiType: 'ADS_API',
        profileName,
        marketplaceId: profile.marketplace_id,
        region: profile.region,
        advertiserProfileId: profile.advertiser_profile_id,
        ok: false,
        source: 'stored',
        probe: 'profiles+brandRecommendations',
        summary: 'Ads probe failed.',
        error: error instanceof Error ? error.message : 'Unknown Ads API error',
      });
    }
  }

  return Response.json({
    testedAt: new Date().toISOString(),
    counts: {
      sp: spConnections.length,
      ads: adsConnections.length,
      ok: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
    },
    results,
  });
}
