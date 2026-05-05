import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { auth0 } from '../../../../lib/auth0';
import {
  createSpApiOAuthFlow,
  createAdsApiOAuthFlow,
} from '../../../../lib/amazon-oauth';
import { validateOAuthCallback } from '@farvisionllc/credential-store';
import {
  MARKETPLACE_REGIONS,
  type AmazonCredentialProfile,
} from '@farvisionllc/models';
import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import { getCredentialStore } from '../../../../lib/credential-store';

type AdsProfileCandidate = {
  profileId?: number | string;
  profile_id?: number | string;
  id?: number | string;
  countryCode?: string;
  marketplaceId?: string;
  accountInfo?: {
    id?: string;
    name?: string;
    type?: string;
    marketplaceStringId?: string;
    marketplaceId?: string;
  };
};

function asAdsProfiles(value: unknown): AdsProfileCandidate[] {
  if (Array.isArray(value)) return value as AdsProfileCandidate[];
  if (value && typeof value === 'object') {
    const body = value as { profiles?: unknown; data?: unknown };
    if (Array.isArray(body.profiles))
      return body.profiles as AdsProfileCandidate[];
    if (Array.isArray(body.data)) return body.data as AdsProfileCandidate[];
  }
  return [];
}

function getAdsProfileId(profile: AdsProfileCandidate): string | null {
  const id = profile.profileId ?? profile.profile_id ?? profile.id;
  return id == null ? null : String(id);
}

function getAdsMarketplaceId(
  profile: AdsProfileCandidate,
  fallbackMarketplaceId: string
): string {
  return (
    profile.marketplaceId ||
    profile.accountInfo?.marketplaceId ||
    profile.accountInfo?.marketplaceStringId ||
    fallbackMarketplaceId
  );
}

function getAdsProfileName(
  baseName: string,
  marketplaceId: string,
  advertiserProfileId: string,
  profile: AdsProfileCandidate
): string {
  const accountName = profile.accountInfo?.name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);

  const readablePart = accountName ? `${accountName}-` : '';
  return `${baseName}-${readablePart}${marketplaceId}-${advertiserProfileId}`;
}

async function expandAdsCredentialProfiles(
  baseProfile: AmazonCredentialProfile,
  selectedMarketplaceId: string
): Promise<AmazonCredentialProfile[]> {
  const adsClient = new AmazonAdsApiClient({
    clientId: baseProfile.client_id,
    clientSecret: baseProfile.client_secret,
    accessToken: baseProfile.access_token,
    refreshToken: baseProfile.refresh_token,
    marketplaceId: selectedMarketplaceId,
    region: baseProfile.region,
  });

  const response = await adsClient.getProfiles();
  const adsProfiles = asAdsProfiles(response.data);

  return adsProfiles.flatMap((adsProfile) => {
    const advertiserProfileId = getAdsProfileId(adsProfile);
    if (!advertiserProfileId) return [];

    const marketplaceId = getAdsMarketplaceId(
      adsProfile,
      selectedMarketplaceId
    );
    return [
      {
        ...baseProfile,
        profile_name: getAdsProfileName(
          baseProfile.profile_name,
          marketplaceId,
          advertiserProfileId,
          adsProfile
        ),
        marketplace_id: marketplaceId,
        region: MARKETPLACE_REGIONS[marketplaceId] || baseProfile.region,
        advertiser_profile_id: advertiserProfileId,
      },
    ];
  });
}

/**
 * GET /api/amazon/callback
 * Shared OAuth callback for both SP-API and Ads API.
 * Differentiates by reading apiType from the state parameter.
 */
export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const searchParams = request.nextUrl.searchParams;
  const callbackCode =
    searchParams.get('spapi_oauth_code') ??
    searchParams.get('code') ??
    undefined;
  const callbackState = searchParams.get('state') ?? undefined;
  const sellingPartnerId =
    searchParams.get('selling_partner_id') ??
    searchParams.get('seller_id') ??
    undefined;
  const error = searchParams.get('error') ?? undefined;
  const errorDescription = searchParams.get('error_description') ?? undefined;

  // Validate basic callback parameters
  try {
    validateOAuthCallback({
      code: callbackCode,
      state: callbackState,
      error,
      error_description: errorDescription,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'OAuth validation failed';
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url)
    );
  }
  if (!callbackCode || !callbackState) {
    return NextResponse.redirect(
      new URL('/settings?error=Missing+OAuth+callback+parameters.', request.url)
    );
  }

  // Validate CSRF: state must match the cookie we set before redirect
  const cookieStore = await cookies();
  const storedState = cookieStore.get('amazon_oauth_state')?.value;
  const storedMarketplace = cookieStore.get('amazon_oauth_marketplace')?.value;

  if (!storedState || storedState !== callbackState) {
    return NextResponse.redirect(
      new URL(
        '/settings?error=Invalid+state+parameter.+Please+try+again.',
        request.url
      )
    );
  }

  // Clear the CSRF and marketplace cookies
  cookieStore.delete('amazon_oauth_state');
  cookieStore.delete('amazon_oauth_marketplace');

  const marketplaceId =
    storedMarketplace || process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  try {
    // Parse state to determine which API type
    const tempFlow = createSpApiOAuthFlow();
    const parsedState = tempFlow.parseState(callbackState);
    const region = MARKETPLACE_REGIONS[marketplaceId];

    const oauthFlow =
      parsedState.apiType === 'ADS_API'
        ? createAdsApiOAuthFlow(region)
        : createSpApiOAuthFlow(region);

    // Exchange code for tokens and create credential profile
    const profile = await oauthFlow.completeOAuthFlow(
      callbackCode,
      parsedState,
      marketplaceId,
      parsedState.apiType === 'SP_API' ? sellingPartnerId : undefined
    );

    // Store credentials in Couchbase
    const credStore = getCredentialStore();

    if (parsedState.apiType === 'ADS_API') {
      const adsProfiles = await expandAdsCredentialProfiles(
        profile,
        marketplaceId
      );
      if (adsProfiles.length === 0) {
        throw new Error(
          'Amazon Ads OAuth succeeded, but no advertiser profiles were found for this login.'
        );
      }

      for (const adsProfile of adsProfiles) {
        await credStore.setProfile(adsProfile);
      }
      await credStore.setDefaultProfile(
        adsProfiles[0].profile_name,
        'ADS_API',
        adsProfiles[0].user_id
      );
    } else {
      await credStore.setProfile(profile);
      await credStore.setDefaultProfile(
        profile.profile_name,
        profile.api_type,
        profile.user_id
      );
    }

    const apiLabel = parsedState.apiType === 'SP_API' ? 'sp_api' : 'ads_api';
    return NextResponse.redirect(
      new URL(`/settings?connected=${apiLabel}`, request.url)
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Token exchange failed';
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
