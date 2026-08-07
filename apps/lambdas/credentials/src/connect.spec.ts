import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Completing an Amazon OAuth connection behind the private API (#55, step 3).
 *
 * Ordered by how bad the failure is:
 *
 *   1. the connection is written against the JWT subject, never against
 *      anything in the request — the state blob carries a `userId` and this
 *      must never be it;
 *   2. the refresh token is encrypted and never returned, which is the reason
 *      the exchange moved off Vercel;
 *   3. one Ads login fans out to the same profile NAMES the BFF produced —
 *      the name is the document key, so a change here would duplicate every
 *      connection on reconnect rather than update it.
 */

const upsertDocument = vi.fn();
vi.mock('@amz-spapi/couchbase-utils', () => ({
  upsertDocument: (...args: unknown[]) => upsertDocument(...args),
  getDocument: vi.fn(),
}));

const getAmazonOAuthApp = vi.fn();
vi.mock('@amz-spapi/aws-secrets', () => ({
  getAmazonOAuthApp: (...args: unknown[]) => getAmazonOAuthApp(...args),
}));

/** KMS as a greppable envelope — see access-token.spec.ts for why. */
const encryptSecrets = vi.fn();
vi.mock('./kms.js', () => ({
  encryptSecrets: (...args: unknown[]) => encryptSecrets(...args),
  decryptSecrets: vi.fn(),
}));

const { connect, ConnectRequestSchema } = await import('./connect.js');

const SUBJECT = 'auth0|69cf4c211c2242f800bcec09';
const CLIENT_ID = 'amzn1.application-oa2-client.710a480e';
const CLIENT_SECRET = 'amzn1.oa2-cs.v1.THE-CLIENT-SECRET';
const CODE = 'ANLrEXAMPLEAUTHCODE';
const REFRESH_TOKEN = 'Atzr|THE-REFRESH-TOKEN';
const ACCESS_TOKEN = 'Atza|THE-ACCESS-TOKEN';

const request = (overrides: Record<string, unknown> = {}) => ({
  apiType: 'SP_API' as const,
  code: CODE,
  profileName: 'sp-ATVPDKIKX0DER-abc',
  marketplaceId: 'ATVPDKIKX0DER',
  redirectUri: 'https://local.sellavant.com/api/amazon/callback',
  ...overrides,
});

const lwaOk = (body: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      token_type: 'bearer',
      expires_in: 3600,
      ...body,
    }),
    { status: 200 }
  );

const adsProfiles = (profiles: unknown[]) =>
  new Response(JSON.stringify(profiles), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  upsertDocument.mockReset().mockResolvedValue(undefined);
  getAmazonOAuthApp
    .mockReset()
    .mockResolvedValue({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  encryptSecrets.mockReset().mockResolvedValue('ciphertext');

  fetchMock = vi.fn().mockResolvedValue(lwaOk());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Documents written, excluding the default pointer. */
const writtenProfiles = () =>
  upsertDocument.mock.calls
    .filter(([, , key]) => !String(key).startsWith('DEFAULT::'))
    .map(([, , key, doc]) => ({ key, doc }));

describe('the connection belongs to the token subject', () => {
  it('keys the document on the JWT subject', async () => {
    const result = await connect(SUBJECT, request());

    expect(result.ok).toBe(true);
    const [{ key, doc }] = writtenProfiles();
    expect(key).toBe(`SP_API::${SUBJECT}::sp-ATVPDKIKX0DER-abc`);
    expect(doc.user_id).toBe(SUBJECT);
  });

  it('has no way to be told a different user', () => {
    // The state blob carries a userId and the BFF must not be able to forward
    // it. The schema is the enforcement: an unknown key is dropped, so even a
    // caller that sends one cannot have it read.
    const parsed = ConnectRequestSchema.parse({
      ...request(),
      userId: 'auth0|victim',
    });

    expect(parsed).not.toHaveProperty('userId');
  });

  it('points the default at what it just wrote, for this subject', async () => {
    await connect(SUBJECT, request());

    const [, , key, doc] = upsertDocument.mock.calls.find(([, , k]) =>
      String(k).startsWith('DEFAULT::')
    )!;
    expect(key).toBe(`DEFAULT::SP_API::${SUBJECT}`);
    expect(doc).toEqual({ profileName: 'sp-ATVPDKIKX0DER-abc' });
  });
});

describe('the refresh token is encrypted and never returned', () => {
  it('encrypts it and stores nothing in the clear', async () => {
    const result = await connect(SUBJECT, request());

    const [secrets, context] = encryptSecrets.mock.calls[0];
    expect(secrets.refresh_token).toBe(REFRESH_TOKEN);
    expect(secrets.access_token).toBe(ACCESS_TOKEN);
    expect(context).toEqual({
      userId: SUBJECT,
      apiType: 'SP_API',
      profileName: 'sp-ATVPDKIKX0DER-abc',
    });

    const [{ doc }] = writtenProfiles();
    expect(doc.encrypted_secrets).toBe('ciphertext');
    expect(doc.refresh_token).toBeUndefined();
    expect(doc.access_token).toBeUndefined();
    expect(doc.has_refresh_token).toBe(true);

    expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN);
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
  });

  it('sends the code and the redirect uri Amazon will check', async () => {
    await connect(SUBJECT, request());

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe(CODE);
    expect(body.get('redirect_uri')).toBe(
      'https://local.sellavant.com/api/amazon/callback'
    );
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
  });

  it('refuses to store a connection Amazon gave no refresh token for', async () => {
    // It would work for an hour and then fail forever, with nothing to renew
    // from. Storing it looks like success.
    fetchMock.mockResolvedValue(
      lwaOk({ refresh_token: undefined as unknown as string })
    );

    expect(await connect(SUBJECT, request())).toMatchObject({
      ok: false,
      failure: { status: 502, error: 'NoRefreshToken' },
    });
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('tells a spent authorization code apart from a transient failure', async () => {
    // Codes are single-use and expire in minutes, so `invalid_grant` here means
    // "start again", not "reconnect the account".
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );

    const result = await connect(SUBJECT, request());

    expect(result).toMatchObject({
      failure: { status: 409, error: 'AuthorizationCodeRejected' },
    });
    expect(
      (result as { failure: { detail: string } }).failure.detail
    ).toContain('single-use');
  });
});

describe('one Ads login fans out to a profile per advertiser', () => {
  const adsRequest = () =>
    request({ apiType: 'ADS_API', profileName: 'ads-ATVPDKIKX0DER-xyz' });

  const twoAdvertisers = [
    {
      profileId: 967757046531288,
      marketplaceId: 'ATVPDKIKX0DER',
      accountInfo: { name: 'Farvision LLC' },
    },
    {
      profileId: 4255419111961197,
      marketplaceId: 'A2EUQ1WTGCTBG2',
      accountInfo: { name: 'Farvision LLC' },
    },
  ];

  beforeEach(() => {
    fetchMock
      .mockResolvedValueOnce(lwaOk())
      .mockResolvedValueOnce(adsProfiles(twoAdvertisers));
  });

  it('writes one profile per advertiser, named as the BFF named them', async () => {
    // The name IS the document key. A different rule would create a second
    // profile beside the first on every reconnect rather than updating it.
    await connect(SUBJECT, adsRequest());

    expect(writtenProfiles().map((p) => p.key)).toEqual([
      `ADS_API::${SUBJECT}::ads-ATVPDKIKX0DER-xyz-farvision-llc-ATVPDKIKX0DER-967757046531288`,
      `ADS_API::${SUBJECT}::ads-ATVPDKIKX0DER-xyz-farvision-llc-A2EUQ1WTGCTBG2-4255419111961197`,
    ]);
  });

  it('carries the advertiser id and each marketplace’s own region', async () => {
    await connect(SUBJECT, adsRequest());

    const docs = writtenProfiles().map((p) => p.doc);
    expect(docs[0].advertiser_profile_id).toBe('967757046531288');
    expect(docs[1].marketplace_id).toBe('A2EUQ1WTGCTBG2');
    expect(docs[1].region).toBe('NA');
  });

  it('lists advertisers with the token it just minted', async () => {
    await connect(SUBJECT, adsRequest());

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://advertising-api.amazon.com/v2/profiles');
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(init.headers['Amazon-Advertising-API-ClientId']).toBe(CLIENT_ID);
  });

  it('is 409, not a silent success, when the login has no advertisers', async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(lwaOk())
      .mockResolvedValueOnce(adsProfiles([]));

    expect(await connect(SUBJECT, adsRequest())).toMatchObject({
      failure: { status: 409, error: 'NoAdvertiserProfiles' },
    });
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('accepts every id spelling the BFF accepted', async () => {
    // Profiles in the database were named from whichever spelling Amazon sent.
    // Narrowing it now would rename connections on reconnect.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(lwaOk())
      .mockResolvedValueOnce(
        adsProfiles([{ profile_id: 111 }, { id: 222 }, { profileId: 333 }])
      );

    await connect(SUBJECT, adsRequest());

    expect(writtenProfiles().map((p) => p.doc.advertiser_profile_id)).toEqual([
      '111',
      '222',
      '333',
    ]);
  });

  it('does not store a partial connection when listing advertisers fails', async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(lwaOk())
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));

    expect(await connect(SUBJECT, adsRequest())).toMatchObject({
      failure: { status: 502, error: 'AdsProfilesFailed' },
    });
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('never puts an Ads error body in the message', async () => {
    // An Ads error body can echo the request, and the request carried the
    // access token in a header.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(lwaOk())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ details: ACCESS_TOKEN }), { status: 401 })
      );

    const result = await connect(SUBJECT, adsRequest());

    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });
});

describe('the request is validated, not trusted', () => {
  it('rejects an unknown marketplace before spending the code', async () => {
    const result = await connect(
      SUBJECT,
      request({ marketplaceId: 'NOT-A-MARKETPLACE' })
    );

    expect(result).toMatchObject({ failure: { status: 400 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a redirect uri that is not https', () => {
    // `z.string().url()` accepts any scheme. A registered LWA redirect URI is
    // always https, and "is a URL" is not the property wanted here.
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'not a url',
    ]) {
      expect(
        ConnectRequestSchema.safeParse(request({ redirectUri: bad })).success,
        `${bad} should be rejected`
      ).toBe(false);
    }

    expect(
      ConnectRequestSchema.safeParse(
        request({
          redirectUri: 'https://staging.sellavant.com/api/amazon/callback',
        })
      ).success
    ).toBe(true);
  });

  it('rejects an unknown apiType', () => {
    expect(
      ConnectRequestSchema.safeParse(request({ apiType: 'SP-API' })).success
    ).toBe(false);
  });

  it('takes seller_id for SP-API when the callback supplied one', async () => {
    await connect(SUBJECT, request({ sellerId: 'A2HXBWIE3KMLKV' }));

    expect(writtenProfiles()[0].doc.seller_id).toBe('A2HXBWIE3KMLKV');
  });
});
