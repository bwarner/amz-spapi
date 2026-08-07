import type { AmazonApiType } from '@farvisionllc/models';
import {
  credentialService,
  type CredentialProfileView,
} from '../services/credential-service';

/**
 * Which Amazon connections the current user has (#55).
 *
 * Read from the credentials API, not from the database. Every field here is
 * metadata — marketplace, region, seller id, advertiser profile id, and a
 * boolean for whether a refresh token is held. **No secret is in this file's
 * types**, which is the property that makes the rest of step 5 possible: a
 * caller that cannot name a refresh token cannot pass one to a client.
 *
 * The old `env-self-auth` fallback is gone. It read `LWA_REFRESH_TOKEN` from the
 * environment and synthesised a connection out of it — a long-lived seller
 * credential in the Vercel runtime, which is exactly what #55 exists to remove.
 * It was also already dead: the variable is set in no environment.
 */

export type AmazonConnection = {
  profileName: string;
  profile: CredentialProfileView;
  isDefault: boolean;
  /**
   * What this connection lacks in order to be usable. Empty means usable.
   *
   * Kept as strings because it is shown to the user on the connections page.
   */
  missing: string[];
};

type ConnectionFilters = {
  apiType: AmazonApiType;
  /**
   * Ignored, and kept only so the many call sites that pass it still compile.
   *
   * The API takes the caller from the verified JWT, so there is no user to
   * choose. Passing a different one here does nothing — which is the point, and
   * is why it is not simply deleted: a signature change would let a call site
   * silently keep an id it believed was being honoured.
   */
  userId?: string;
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

function getMissingFields(
  profile: CredentialProfileView,
  options: Pick<
    ConnectionFilters,
    'apiType' | 'requireAdvertiserProfileId' | 'requireRefreshToken'
  >
): string[] {
  const missing: string[] = [];
  if (!profile.client_id) missing.push('client_id');

  if (options.requireRefreshToken !== false && !profile.has_refresh_token) {
    // `has_refresh_token_known: false` means the stored document predates #55
    // and carries no flag, so `false` here is a default rather than a fact.
    // Said plainly rather than reported as a definite missing credential — the
    // remedy differs, and a user told to reconnect a working account will.
    missing.push(
      profile.has_refresh_token_known
        ? 'refresh_token'
        : 'refresh_token (unverified)'
    );
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

function matchesMarketplace(
  profile: CredentialProfileView,
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

/**
 * Every connection for one API, best first.
 *
 * One API call for the whole answer, per ADR-0007 — the previous version made
 * one call to list names and then one per name to fetch each profile, which was
 * N+1 against the database and decrypted every profile to answer a question
 * about none of them.
 */
export async function listAmazonConnections(
  options: ConnectionFilters
): Promise<AmazonConnection[]> {
  const credentials = await credentialService();
  const listing = await credentials.list(options.apiType);
  const defaultProfileName = listing.defaults[options.apiType];

  const connections = listing.profiles
    .filter((profile) => profile.api_type === options.apiType)
    .filter(
      (profile) =>
        !options.profileName || profile.profile_name === options.profileName
    )
    .filter((profile) => matchesMarketplace(profile, options.marketplaceId))
    .map((profile) => ({
      profileName: profile.profile_name,
      profile,
      isDefault: profile.profile_name === defaultProfileName,
      missing: getMissingFields(profile, options),
    }));

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
