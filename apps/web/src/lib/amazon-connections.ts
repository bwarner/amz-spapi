import type {
  AmazonApiType,
  AmazonCredentialProfile,
} from '@farvisionllc/models';
import { createSpApiProfile, MARKETPLACE_REGIONS } from '@farvisionllc/models';
import { getCredentialStore } from './credential-store';

export type AmazonConnection = {
  profileName: string;
  profile: AmazonCredentialProfile;
  isDefault: boolean;
  missing: string[];
};

type ConnectionFilters = {
  apiType: AmazonApiType;
  userId: string;
  marketplaceId?: string;
  profileName?: string;
  requireAdvertiserProfileId?: boolean;
  requireRefreshToken?: boolean;
};

type ResolveResult =
  | {
      connected: true;
      connection: AmazonConnection;
      candidates: AmazonConnection[];
    }
  | {
      connected: false;
      reason: string;
      candidates: AmazonConnection[];
    };

const ENV_SP_PROFILE_NAME = 'env-self-auth';

function getMissingFields(
  profile: AmazonCredentialProfile,
  options: Pick<
    ConnectionFilters,
    'apiType' | 'requireAdvertiserProfileId' | 'requireRefreshToken'
  >
) {
  const missing: string[] = [];
  if (!profile.client_id) missing.push('client_id');
  if (options.requireRefreshToken !== false && !profile.refresh_token) {
    missing.push('refresh_token');
  }
  if (
    options.apiType === 'ADS_API' &&
    options.requireAdvertiserProfileId &&
    !profile.advertiser_profile_id
  ) {
    missing.push('advertiser_profile_id');
  }
  return missing;
}

function getEnvSpConnection(userId: string): AmazonConnection | null {
  const clientId = process.env['LWA_CLIENT_ID'];
  const clientSecret = process.env['LWA_CLIENT_SECRET'];
  const refreshToken = process.env['LWA_REFRESH_TOKEN'];
  const marketplaceId = process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const profile = createSpApiProfile({
    profile_name: ENV_SP_PROFILE_NAME,
    user_id: userId,
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    marketplace_id: marketplaceId,
    region: MARKETPLACE_REGIONS[marketplaceId] || 'NA',
  });

  return {
    profileName: profile.profile_name,
    profile,
    isDefault: false,
    missing: [],
  };
}

function matchesMarketplace(
  profile: AmazonCredentialProfile,
  marketplaceId?: string
) {
  return !marketplaceId || profile.marketplace_id === marketplaceId;
}

function sortConnections(
  connections: AmazonConnection[],
  preferredMarketplaceId?: string
) {
  return [...connections].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (preferredMarketplaceId) {
      const aMatches = a.profile.marketplace_id === preferredMarketplaceId;
      const bMatches = b.profile.marketplace_id === preferredMarketplaceId;
      if (aMatches !== bMatches) return aMatches ? -1 : 1;
    }
    return (b.profile.updated_at || 0) - (a.profile.updated_at || 0);
  });
}

export async function listAmazonConnections(
  options: ConnectionFilters
): Promise<AmazonConnection[]> {
  const credStore = getCredentialStore();
  const defaultProfileName = await credStore.getDefaultProfile(
    options.apiType,
    options.userId
  );

  if (options.profileName) {
    const profile = await credStore.getProfile(
      options.profileName,
      options.apiType,
      options.userId
    );
    if (profile && matchesMarketplace(profile, options.marketplaceId)) {
      return [
        {
          profileName: profile.profile_name,
          profile,
          isDefault: profile.profile_name === defaultProfileName,
          missing: getMissingFields(profile, options),
        },
      ];
    }

    if (
      options.apiType === 'SP_API' &&
      options.profileName === ENV_SP_PROFILE_NAME
    ) {
      const envConnection = getEnvSpConnection(options.userId);
      if (
        envConnection &&
        matchesMarketplace(envConnection.profile, options.marketplaceId)
      ) {
        return [envConnection];
      }
    }

    return [];
  }

  const profileNames = await credStore.listProfiles(
    options.apiType,
    options.userId
  );
  const profiles = await Promise.all(
    profileNames.map((profileName) =>
      credStore.getProfile(profileName, options.apiType, options.userId)
    )
  );

  const connections = profiles
    .filter((profile): profile is AmazonCredentialProfile => Boolean(profile))
    .filter((profile) => matchesMarketplace(profile, options.marketplaceId))
    .map((profile) => ({
      profileName: profile.profile_name,
      profile,
      isDefault: profile.profile_name === defaultProfileName,
      missing: getMissingFields(profile, options),
    }));

  if (options.apiType === 'SP_API') {
    const envConnection = getEnvSpConnection(options.userId);
    if (
      envConnection &&
      matchesMarketplace(envConnection.profile, options.marketplaceId) &&
      !connections.some(
        (connection) =>
          connection.profile.client_id === envConnection.profile.client_id &&
          connection.profile.refresh_token ===
            envConnection.profile.refresh_token &&
          connection.profile.marketplace_id ===
            envConnection.profile.marketplace_id
      )
    ) {
      connections.push({
        ...envConnection,
        isDefault: !defaultProfileName,
      });
    }
  }

  return sortConnections(connections, options.marketplaceId);
}

export async function resolveAmazonConnection(
  options: ConnectionFilters
): Promise<ResolveResult> {
  const candidates = await listAmazonConnections(options);
  const ready = candidates.find((candidate) => candidate.missing.length === 0);

  if (ready) {
    return {
      connected: true,
      connection: ready,
      candidates,
    };
  }

  if (!candidates.length) {
    return {
      connected: false,
      reason: `${options.apiType} is not connected${
        options.marketplaceId ? ` for marketplace ${options.marketplaceId}` : ''
      }.`,
      candidates,
    };
  }

  return {
    connected: false,
    reason: `${
      options.apiType
    } connection is missing ${candidates[0].missing.join(', ')}.`,
    candidates,
  };
}
