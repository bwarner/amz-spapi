import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import { SpApiClient } from '@farvisionllc/sp-client';
import { auth0 } from '../../../../lib/auth0';
import { getCredentialStore } from '../../../../lib/credential-store';
import { listAmazonConnections } from '../../../../lib/amazon-connections';

type InventorySummary = {
  asin?: string;
  productName?: string;
  sellerSku?: string;
};

type CatalogSummary = {
  brand?: string;
  itemName?: string;
};

type CatalogItem = {
  summaries?: CatalogSummary[];
};

type BrandResult = {
  id?: string;
  name: string;
  asinCount: number;
  sampleAsins: string[];
  sampleProducts: string[];
  profiles: Array<{
    profileName: string;
    marketplaceId: string;
    region?: string;
    sellerId?: string;
    advertiserProfileId?: string;
  }>;
  source: 'ads' | 'sp-api';
};

type AdsBrand = {
  id?: string;
  name?: string;
};

function uniqueValues(values: Array<string | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function normalizeBrand(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function upsertBrand(
  brandMap: Map<string, BrandResult>,
  key: string,
  brand: Omit<BrandResult, 'asinCount' | 'sampleAsins' | 'sampleProducts'> &
    Partial<Pick<BrandResult, 'asinCount' | 'sampleAsins' | 'sampleProducts'>>
) {
  const current =
    brandMap.get(key) ||
    ({
      ...brand,
      asinCount: 0,
      sampleAsins: [],
      sampleProducts: [],
    } satisfies BrandResult);

  current.asinCount += brand.asinCount || 0;
  for (const asin of brand.sampleAsins || []) {
    if (!current.sampleAsins.includes(asin) && current.sampleAsins.length < 5) {
      current.sampleAsins.push(asin);
    }
  }
  for (const product of brand.sampleProducts || []) {
    if (
      !current.sampleProducts.includes(product) &&
      current.sampleProducts.length < 3
    ) {
      current.sampleProducts.push(product);
    }
  }
  brandMap.set(key, current);
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.sub;
  const credStore = getCredentialStore();
  const defaultMarketplaceId =
    process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';
  const brandMap = new Map<string, BrandResult>();
  const scannedProfiles: BrandResult['profiles'] = [];
  const errors: string[] = [];

  const adsConnections = await listAmazonConnections({
    apiType: 'ADS_API',
    userId,
    requireAdvertiserProfileId: true,
  });

  for (const connection of adsConnections) {
    const { profile, profileName } = connection;

    const marketplaceId = profile.marketplace_id || defaultMarketplaceId;
    const profileRef = {
      profileName,
      marketplaceId,
      region: profile.region,
      advertiserProfileId: profile.advertiser_profile_id,
    };
    scannedProfiles.push(profileRef);

    if (connection.missing.length) {
      errors.push(`${profileName}: missing ${connection.missing.join(', ')}`);
      continue;
    }

    try {
      const client = new AmazonAdsApiClient({
        clientId: profile.client_id,
        clientSecret: profile.client_secret,
        refreshToken: profile.refresh_token,
        accessToken: profile.access_token,
        marketplaceId,
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

      const brands = (await client.getNegativeBrands()) as AdsBrand[];
      for (const brand of brands) {
        const name = normalizeBrand(brand.name || '');
        if (!name) continue;

        upsertBrand(
          brandMap,
          `ads::${name.toLowerCase()}::${marketplaceId}::${profileName}`,
          {
            id: brand.id,
            name,
            profiles: [profileRef],
            source: 'ads',
          }
        );
      }
    } catch (error) {
      errors.push(
        `${profileName}: ${
          error instanceof Error ? error.message : 'Ads brand query failed'
        }`
      );
    }
  }

  if (!brandMap.size) {
    const spConnections = await listAmazonConnections({
      apiType: 'SP_API',
      userId,
    });

    for (const connection of spConnections) {
      const { profile, profileName } = connection;

      const marketplaceId = profile.marketplace_id || defaultMarketplaceId;
      const profileRef = {
        profileName,
        marketplaceId,
        region: profile.region,
        sellerId: profile.seller_id,
      };
      scannedProfiles.push(profileRef);

      if (connection.missing.length) {
        errors.push(`${profileName}: missing ${connection.missing.join(', ')}`);
        continue;
      }

      try {
        const client = new SpApiClient({
          clientId: profile.client_id,
          clientSecret: profile.client_secret,
          refreshToken: profile.refresh_token,
          accessToken: profile.access_token,
          sellerId: profile.seller_id,
          marketplaceId,
          region: (profile.region as 'NA' | 'EU' | 'FE') || 'NA',
          onTokenRefresh: async (accessToken, expiresIn) => {
            await credStore.updateAccessToken(
              profileName,
              'SP_API',
              accessToken,
              expiresIn,
              userId
            );
          },
        });

        const inventoryItems: InventorySummary[] = [];
        let nextToken: string | undefined;
        let pageCount = 0;

        do {
          const inventory = (await client.getInventorySummaries({
            granularityType: 'Marketplace',
            granularityId: marketplaceId,
            marketplaceIds: [marketplaceId],
            nextToken,
          })) as {
            inventorySummaries?: InventorySummary[];
            nextToken?: string;
          };

          inventoryItems.push(...(inventory.inventorySummaries || []));
          nextToken = inventory.nextToken;
          pageCount += 1;
        } while (nextToken && pageCount < 3);

        const asins = uniqueValues(
          inventoryItems.map((item) => item.asin)
        ).slice(0, 40);
        const productNameByAsin = new Map(
          inventoryItems
            .filter((item) => item.asin)
            .map((item) => [
              item.asin as string,
              item.productName || item.sellerSku || '',
            ])
        );

        await Promise.all(
          asins.map(async (asin) => {
            try {
              const item = (await client.getCatalogItem(asin, {
                marketplaceIds: [marketplaceId],
                includedData: ['summaries'],
              })) as CatalogItem;
              const name = normalizeBrand(item.summaries?.[0]?.brand || '');
              if (!name) return;

              upsertBrand(
                brandMap,
                `sp::${name.toLowerCase()}::${marketplaceId}::${profileName}`,
                {
                  name,
                  asinCount: 1,
                  sampleAsins: [asin],
                  sampleProducts: [
                    item.summaries?.[0]?.itemName ||
                      productNameByAsin.get(asin) ||
                      '',
                  ].filter(Boolean),
                  profiles: [profileRef],
                  source: 'sp-api',
                }
              );
            } catch {
              // Skip catalog rows the connected account cannot read.
            }
          })
        );
      } catch (error) {
        errors.push(
          `${profileName}: ${
            error instanceof Error ? error.message : 'SP-API brand query failed'
          }`
        );
      }
    }
  }

  return Response.json({
    connected: Boolean(adsConnections.length || scannedProfiles.length),
    profiles: scannedProfiles,
    brands: [...brandMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    source: brandMap.size
      ? [...brandMap.values()].some((brand) => brand.source === 'ads')
        ? 'ads'
        : 'sp-api'
      : null,
    message:
      adsConnections.length || scannedProfiles.length
        ? undefined
        : 'Amazon Ads or SP-API is not connected.',
    errors,
  });
}
