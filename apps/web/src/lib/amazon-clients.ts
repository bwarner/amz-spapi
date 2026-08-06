import { cache } from 'react';
import { AmazonAdsApiClient } from '@farvisionllc/ad-client';
import { SpApiClient } from '@farvisionllc/sp-client';
import type { AmazonApiType } from '@farvisionllc/models';
import { credentialService } from '../services/credential-service';
import type { AmazonConnection } from './amazon-connections';

/**
 * Amazon clients built from a minted token, never from a stored secret (#55).
 *
 * The single seam that replaced six call sites, each of which used to read a
 * decrypted profile and hand `clientSecret` and `refreshToken` straight to a
 * client. Those two fields are the whole of what #55 removes from this runtime,
 * so the fix is not to repeat the removal six times — it is to leave exactly one
 * place that constructs a client, and give it nothing to leak.
 *
 * ## How retry-on-401 survives
 *
 * A client built from a bare access token cannot refresh itself, because
 * refreshing needs the material we deliberately do not have. Instead each
 * client gets `mintAccessToken`, a callback that asks the credentials API for a
 * fresh token. The client's own 401 interceptor calls it and retries, so the
 * behaviour callers depend on is unchanged while the secret is somewhere else.
 *
 * The API answers from its cache unless the token is genuinely near expiry, so
 * a burst of 401s does not become a burst of exchanges at Amazon — and when it
 * does exchange, it does so under a single-flight lock.
 */

/**
 * Ask the credentials API for a token. No caching — see `mintForRequest`.
 *
 * A new `credentialService` per call rather than one captured at construction:
 * the service holds the caller's Auth0 access token, and a long-lived client
 * may outlive it. Building it per mint means an expired session surfaces as an
 * auth error at the moment of use rather than as a token that silently stopped
 * being mintable.
 */
async function mintFresh(
  apiType: AmazonApiType,
  profileName: string
): Promise<string> {
  const credentials = await credentialService();
  const { access_token } = await credentials.mintAccessToken(
    apiType,
    profileName
  );
  return access_token;
}

/**
 * One mint per connection per request, however many clients get built.
 *
 * Clients are constructed freely — `ads-ops` builds one per call, and a single
 * chat turn touching several connections was producing ten round trips to the
 * credentials API. Each is a Lambda invocation, a Couchbase read and a KMS
 * decrypt for a token that was already in hand.
 *
 * **`cache` from React, which is REQUEST-scoped — not a module-level map.**
 * That distinction is the whole safety argument. A module-level cache lives for
 * the life of the server instance, and one Vercel instance serves many users,
 * so it would hand one seller's access token to the next request that asked for
 * the same profile name. Request scope cannot: the memo is created and
 * discarded with the request, and every entry in it belongs to the one user who
 * made it.
 *
 * If this is ever called outside a request scope it simply does not memoize,
 * which is the behaviour before this existed — slower, never wrong.
 */
const mintForRequest = cache(
  async (apiType: AmazonApiType, profileName: string): Promise<string> =>
    mintFresh(apiType, profileName)
);

/** An SP-API client for one connection, already holding a valid token. */
export async function spApiClientFor(
  connection: AmazonConnection,
  options: { marketplaceId?: string } = {}
): Promise<SpApiClient> {
  const { profile, profileName } = connection;

  return new SpApiClient({
    clientId: profile.client_id,
    // Up front rather than lazily, so a connection that cannot mint fails here
    // — where the caller is still deciding what to do — instead of inside the
    // first API call, wrapped in an Amazon-shaped error. Memoized, so building
    // five clients for one connection still costs one mint.
    accessToken: await mintForRequest('SP_API', profileName),
    // Deliberately NOT memoized. This runs when Amazon has just rejected the
    // token, which for a long chat turn means it expired mid-request — and the
    // memo holds exactly the expired one. Serving it again would turn the
    // client's retry into a second guaranteed 401.
    mintAccessToken: () => mintFresh('SP_API', profileName),
    sellerId: profile.seller_id,
    marketplaceId: options.marketplaceId || profile.marketplace_id,
    region: profile.region || 'NA',
  });
}

/** An Ads API client for one connection, already holding a valid token. */
export async function adsClientFor(
  connection: AmazonConnection,
  options: { marketplaceId?: string } = {}
): Promise<AmazonAdsApiClient> {
  const { profile, profileName } = connection;

  return new AmazonAdsApiClient({
    clientId: profile.client_id,
    accessToken: await mintForRequest('ADS_API', profileName),
    // Uncached, for the same reason as the SP client above.
    mintAccessToken: () => mintFresh('ADS_API', profileName),
    marketplaceId: options.marketplaceId || profile.marketplace_id,
    region: profile.region || 'NA',
    profileId: profile.advertiser_profile_id,
  });
}
