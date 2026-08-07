import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Building Amazon clients from minted tokens (#55).
 *
 * Two properties, and the second is the one that is easy to get subtly wrong:
 *
 *   1. no client is ever handed a refresh token or a client secret — the whole
 *      reason the credential slice moved off Vercel;
 *   2. the per-request memo covers construction but NOT the 401 retry. Memoizing
 *      the retry would re-serve the token Amazon just rejected, turning one
 *      expiry into a guaranteed second failure.
 */

const { mintAccessToken, SpApiClient, AmazonAdsApiClient } = vi.hoisted(() => {
  const mintAccessToken = vi.fn();
  class SpApiClient {
    constructor(public config: Record<string, unknown>) {}
  }
  class AmazonAdsApiClient {
    constructor(public config: Record<string, unknown>) {}
  }
  return { mintAccessToken, SpApiClient, AmazonAdsApiClient };
});

vi.mock('@farvisionllc/sp-client', () => ({ SpApiClient }));
vi.mock('@farvisionllc/ad-client', () => ({ AmazonAdsApiClient }));
vi.mock('../services/credential-service', () => ({
  credentialService: async () => ({ mintAccessToken }),
}));

const { spApiClientFor, adsClientFor } = await import('./amazon-clients');

const connection = (overrides: Record<string, unknown> = {}) =>
  ({
    profileName: 'sp-1',
    isDefault: true,
    missing: [],
    profile: {
      profile_name: 'sp-1',
      api_type: 'SP_API',
      client_id: 'amzn1.application-oa2-client.public',
      marketplace_id: 'ATVPDKIKX0DER',
      region: 'NA',
      seller_id: 'A2HXBWIE3KMLKV',
      has_refresh_token: true,
      has_refresh_token_known: true,
      created_at: 1,
      updated_at: 2,
      ...overrides,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

beforeEach(() => {
  let n = 0;
  mintAccessToken
    .mockReset()
    .mockImplementation(async () => ({ access_token: `Atza|TOKEN-${++n}` }));
});

describe('no long-lived secret reaches a client', () => {
  it('passes an access token and nothing that could mint another', async () => {
    const client = await spApiClientFor(connection());

    const config = (client as unknown as { config: Record<string, unknown> })
      .config;
    expect(config['accessToken']).toBe('Atza|TOKEN-1');
    expect(config['clientSecret']).toBeUndefined();
    expect(config['refreshToken']).toBeUndefined();
  });

  it('does the same for the Ads client', async () => {
    const client = await adsClientFor(connection({ api_type: 'ADS_API' }));

    const config = (client as unknown as { config: Record<string, unknown> })
      .config;
    expect(config['accessToken']).toBe('Atza|TOKEN-1');
    expect(config['clientSecret']).toBeUndefined();
    expect(config['refreshToken']).toBeUndefined();
  });
});

describe('the retry path is not memoized', () => {
  it('mints afresh when the client asks after a 401', async () => {
    // The client calls this exactly when Amazon has rejected the token it
    // holds. For a long chat turn that means it expired mid-request — and the
    // memo holds precisely the expired one.
    const client = await spApiClientFor(connection());
    const config = (client as unknown as { config: Record<string, unknown> })
      .config;

    const retried = await (
      config['mintAccessToken'] as () => Promise<string>
    )();

    expect(retried).toBe('Atza|TOKEN-2');
    expect(retried).not.toBe(config['accessToken']);
    expect(mintAccessToken).toHaveBeenCalledTimes(2);
  });

  it('asks the credentials API for the right connection each time', async () => {
    const client = await adsClientFor(connection({ api_type: 'ADS_API' }));
    const config = (client as unknown as { config: Record<string, unknown> })
      .config;

    await (config['mintAccessToken'] as () => Promise<string>)();

    for (const call of mintAccessToken.mock.calls) {
      expect(call).toEqual(['ADS_API', 'sp-1']);
    }
  });
});
