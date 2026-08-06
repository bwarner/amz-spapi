/**
 * Advertiser profile resolution (#86).
 *
 * This account holds four Ads profiles — US, Canada, Mexico, Brazil. There is
 * no correct default among them, and the failure mode if one is picked anyway
 * is the worst kind: a confident, complete-looking answer about one marketplace
 * presented as the whole account. Nothing errors, and the number is wrong.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const listAmazonConnections = vi.fn();

vi.mock('./amazon-connections', () => ({
  listAmazonConnections: (...args: unknown[]) => listAmazonConnections(...args),
}));

/**
 * One fake client, shared by both mocks below.
 *
 * `vi.hoisted` because `vi.mock` factories are lifted above ordinary
 * declarations. Defining the class here rather than importing the real one
 * inside a factory also keeps `@farvisionllc/ad-client` a STATIC dependency of
 * this file — a dynamic `import()` makes Nx classify the library as lazy-loaded
 * and then forbids the static imports everywhere else.
 */
const { listCampaigns, FakeAdsClient } = vi.hoisted(() => {
  const listCampaigns = vi.fn();
  class FakeAdsClient {
    constructor(public config: Record<string, unknown>) {}
    listCampaigns = (...args: unknown[]) => listCampaigns(this.config, ...args);
  }
  return { listCampaigns, FakeAdsClient };
});

vi.mock('@farvisionllc/ad-client', () => ({
  AmazonAdsApiClient: FakeAdsClient,
}));

/**
 * The client factory, stubbed.
 *
 * Since #55 building a client mints an access token through the credentials
 * API, which needs a request scope and a session — neither of which exists in a
 * unit test, and neither of which this file is about. The stub keeps
 * `profileId` visible, since which advertiser profile a call is scoped to is
 * exactly what these tests assert.
 */
vi.mock('./amazon-clients', () => ({
  adsClientFor: async (connection: { profile: Record<string, unknown> }) =>
    new FakeAdsClient({
      clientId: connection.profile['client_id'],
      accessToken: 'minted',
      marketplaceId: connection.profile['marketplace_id'],
      region: connection.profile['region'],
      profileId: connection.profile['advertiser_profile_id'],
    }),
}));

const { createAdsOps } = await import('./ads-ops');

function connection(
  advertiserProfileId: string | undefined,
  marketplaceId: string
) {
  return {
    profile: {
      profile_name: `ads-${marketplaceId}`,
      client_id: 'client',
      // No client_secret, refresh_token or access_token: since #55 a connection
      // carries none, and a fixture that still did would let a regression that
      // reintroduced them pass unnoticed.
      has_refresh_token: true,
      marketplace_id: marketplaceId,
      region: 'NA',
      advertiser_profile_id: advertiserProfileId,
    },
  };
}

const FOUR_PROFILES = [
  connection('967757046531288', 'ATVPDKIKX0DER'),
  connection('425541911196119', 'A2EUQ1WTGCTBG2'),
  connection('104769602540763', 'A1AM78C64UM0Y8'),
  connection('235277580219052', 'A2Q3Y263D00KWC'),
];

beforeEach(() => {
  listAmazonConnections.mockReset();
  listCampaigns.mockClear().mockResolvedValue({ items: [] });
});

describe('with several advertiser profiles', () => {
  beforeEach(() => listAmazonConnections.mockResolvedValue(FOUR_PROFILES));

  it('refuses to guess when no profileId is given', async () => {
    const ops = createAdsOps({ userId: 'auth0|1' });

    await expect(ops.listCampaigns({})).rejects.toThrow(
      /4 advertiser profiles/
    );
    // The important half: it did NOT quietly answer for one of them.
    expect(listCampaigns).not.toHaveBeenCalled();
  });

  it('names the options so the agent can ask a real question', async () => {
    const ops = createAdsOps({ userId: 'auth0|1' });

    await expect(ops.listCampaigns({})).rejects.toThrow(/967757046531288/);
  });

  it('uses the requested profile as the API scope', async () => {
    const ops = createAdsOps({ userId: 'auth0|1' });
    await ops.listCampaigns({ profileId: '425541911196119' });

    expect(listCampaigns.mock.calls[0][0]).toMatchObject({
      profileId: '425541911196119',
      marketplaceId: 'A2EUQ1WTGCTBG2',
    });
  });

  it('rejects an unknown profileId instead of falling back', async () => {
    const ops = createAdsOps({ userId: 'auth0|1' });

    await expect(
      ops.listCampaigns({ profileId: 'not-a-profile' })
    ).rejects.toThrow(/list-ad-profiles/);
    expect(listCampaigns).not.toHaveBeenCalled();
  });

  it('lists every profile with its marketplace', async () => {
    const ops = createAdsOps({ userId: 'auth0|1' });
    const profiles = await ops.listProfiles();

    expect(profiles).toHaveLength(4);
    expect(profiles.map((p) => p.profileId)).toContain('104769602540763');
  });
});

describe('with a single advertiser profile', () => {
  it('proceeds without asking', async () => {
    // Asking when there is only one answer is its own kind of unhelpful.
    listAmazonConnections.mockResolvedValue([FOUR_PROFILES[0]]);
    const ops = createAdsOps({ userId: 'auth0|1' });

    await ops.listCampaigns({});

    expect(listCampaigns).toHaveBeenCalledOnce();
  });
});

describe('connections that cannot actually be used', () => {
  it('ignores a connection with no advertiser profile id', async () => {
    // Every Sponsored Products call sends the profile id as the API scope
    // header. A connection without one authenticates and then 401s on every
    // request, so counting it as available turns a clear "not connected" into
    // an unexplained auth failure.
    listAmazonConnections.mockResolvedValue([
      connection(undefined, 'ATVPDKIKX0DER'),
    ]);
    const ops = createAdsOps({ userId: 'auth0|1' });

    await expect(ops.listCampaigns({})).rejects.toThrow(
      /No Amazon Ads account is connected/
    );
  });

  it('does not count an unusable connection toward the ambiguity check', async () => {
    // One usable profile plus one broken one is not a choice to put to the
    // user — it is one profile.
    listAmazonConnections.mockResolvedValue([
      FOUR_PROFILES[0],
      connection(undefined, 'A2EUQ1WTGCTBG2'),
    ]);
    const ops = createAdsOps({ userId: 'auth0|1' });

    await ops.listCampaigns({});

    expect(listCampaigns).toHaveBeenCalledOnce();
  });
});
