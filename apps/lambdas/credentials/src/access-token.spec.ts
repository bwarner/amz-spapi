import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minting access tokens inside the private API (#55).
 *
 * The tests are ordered by how bad the failure is:
 *
 *   1. the refresh token and the client secret never leave — that is the whole
 *      reason this moved off Vercel, and a regression here is silent;
 *   2. a caller is answered from the stored token rather than an exchange, so
 *      Amazon's rate limit is not spent on repeat asks;
 *   3. a rejected refresh token is told apart from a transient failure, because
 *      one needs the user and the other needs a retry.
 */

const getDocument = vi.fn();
const upsertDocument = vi.fn();
/**
 * `insertDocument` and `deleteDocument` are the refresh lock (#55 step 4).
 *
 * Left real rather than stubbing `refresh-lock.js` wholesale: these tests are
 * about what the mint path does, and stubbing the lock away would let a change
 * that stopped taking it pass. The default below is "the lock is always
 * available", so every test here exercises the winner's path — `refresh-lock.spec.ts`
 * covers contention.
 */
const insertDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock('@amz-spapi/couchbase-utils', () => ({
  getDocument: (...args: unknown[]) => getDocument(...args),
  upsertDocument: (...args: unknown[]) => upsertDocument(...args),
  insertDocument: (...args: unknown[]) => insertDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

const getAmazonOAuthApp = vi.fn();
vi.mock('@amz-spapi/aws-secrets', () => ({
  getAmazonOAuthApp: (...args: unknown[]) => getAmazonOAuthApp(...args),
}));

/**
 * KMS, stubbed as a reversible envelope.
 *
 * Not a real cipher, and it does not need to be: what is under test is which
 * values move where, not whether AWS can decrypt. Keeping the ciphertext
 * greppable is the point — a test that asserts a secret is absent from a
 * response is worthless if the "secret" was an opaque blob either way.
 */
const decryptSecrets = vi.fn();
const encryptSecrets = vi.fn();
vi.mock('./kms.js', () => ({
  decryptSecrets: (...args: unknown[]) => decryptSecrets(...args),
  encryptSecrets: (...args: unknown[]) => encryptSecrets(...args),
}));

const { mintAccessToken } = await import('./access-token.js');

const SUBJECT = 'auth0|69cf4c211c2242f800bcec09';
const CLIENT_ID = 'amzn1.application-oa2-client.710a480e';
const CLIENT_SECRET = 'amzn1.oa2-cs.v1.THE-CLIENT-SECRET';
const REFRESH_TOKEN = 'Atzr|THE-REFRESH-TOKEN';
const ACCESS_TOKEN = 'Atza|THE-ACCESS-TOKEN';

const stored = (overrides: Record<string, unknown> = {}) => ({
  profile_name: 'sp-ATVPDKIKX0DER-ms3x3t97',
  api_type: 'SP_API',
  user_id: SUBJECT,
  client_id: CLIENT_ID,
  marketplace_id: 'ATVPDKIKX0DER',
  region: 'NA',
  created_at: 1,
  updated_at: 2,
  encrypted_secrets: 'ciphertext',
  has_refresh_token: true,
  ...overrides,
});

/** A successful LWA response. */
const lwaOk = (body: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      token_type: 'bearer',
      expires_in: 3600,
      ...body,
    }),
    { status: 200 }
  );

const lwaError = (error: string, status = 400) =>
  new Response(JSON.stringify({ error, error_description: 'x' }), { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getDocument.mockReset();
  upsertDocument.mockReset().mockResolvedValue(undefined);
  insertDocument.mockReset().mockResolvedValue(true);
  deleteDocument.mockReset().mockResolvedValue(true);
  getAmazonOAuthApp
    .mockReset()
    .mockResolvedValue({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  decryptSecrets.mockReset().mockResolvedValue({
    client_secret: 'stored-secret',
    refresh_token: REFRESH_TOKEN,
  });
  encryptSecrets.mockReset().mockResolvedValue('new-ciphertext');

  getDocument.mockResolvedValue(stored());

  fetchMock = vi.fn().mockResolvedValue(lwaOk());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mint = (profile = 'sp-ATVPDKIKX0DER-ms3x3t97') =>
  mintAccessToken(SUBJECT, 'SP_API', profile);

describe('nothing long-lived leaves this function', () => {
  it('returns the access token and neither of the secrets that made it', async () => {
    const result = await mint();

    expect(result.ok).toBe(true);
    const serialised = JSON.stringify(result);
    expect(serialised).toContain(ACCESS_TOKEN);
    expect(serialised).not.toContain(REFRESH_TOKEN);
    expect(serialised).not.toContain(CLIENT_SECRET);
  });

  it('reads the caller-scoped document key, never a bare profile name', async () => {
    // The attack this closes: naming someone else's profile. The user id is
    // part of the key, so another user's profile is simply a key that is not
    // there.
    await mint();

    const [, , key] = getDocument.mock.calls[0];
    expect(key).toBe(`SP_API::${SUBJECT}::sp-ATVPDKIKX0DER-ms3x3t97`);
  });

  it('takes the client secret from Secrets Manager, not the environment', async () => {
    await mint();

    expect(getAmazonOAuthApp).toHaveBeenCalledWith('SP_API');
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('refresh_token')).toBe(REFRESH_TOKEN);
    expect(body.get('grant_type')).toBe('refresh_token');
  });

  it('re-encrypts before writing the new token back', async () => {
    await mint();

    const [secrets, context] = encryptSecrets.mock.calls[0];
    expect(secrets.access_token).toBe(ACCESS_TOKEN);
    expect(secrets.refresh_token).toBe(REFRESH_TOKEN);
    // The binding that makes a ciphertext non-transferable between profiles.
    expect(context).toEqual({
      userId: SUBJECT,
      apiType: 'SP_API',
      profileName: 'sp-ATVPDKIKX0DER-ms3x3t97',
    });

    const [, , , written] = upsertDocument.mock.calls[0];
    expect(written.encrypted_secrets).toBe('new-ciphertext');
    expect(written.access_token).toBeUndefined();
    expect(written.refresh_token).toBeUndefined();
  });

  it('stores a refresh token Amazon rotated, so the old one is not kept', async () => {
    fetchMock.mockResolvedValue(lwaOk({ refresh_token: 'Atzr|ROTATED' }));

    await mint();

    expect(encryptSecrets.mock.calls[0][0].refresh_token).toBe('Atzr|ROTATED');
  });
});

describe('the stored token is reused while it is worth anything', () => {
  it('answers from the cache without calling Amazon', async () => {
    decryptSecrets.mockResolvedValue({
      client_secret: 'stored-secret',
      refresh_token: REFRESH_TOKEN,
      access_token: 'Atza|CACHED',
    });
    getDocument.mockResolvedValue(
      stored({ access_token_expires_at: Date.now() + 30 * 60_000 })
    );

    const result = await mint();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      token: { access_token: 'Atza|CACHED', refreshed: false },
    });
  });

  it('refreshes one about to expire rather than handing out a dying token', async () => {
    // Five minutes is the caller's safety margin: a token handed out here must
    // still be valid when the request it was fetched for actually runs.
    decryptSecrets.mockResolvedValue({
      client_secret: 'stored-secret',
      refresh_token: REFRESH_TOKEN,
      access_token: 'Atza|NEARLY-DEAD',
    });
    getDocument.mockResolvedValue(
      stored({ access_token_expires_at: Date.now() + 60_000 })
    );

    const result = await mint();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ token: { access_token: ACCESS_TOKEN } });
  });

  it('takes the lock before exchanging, and only when it exchanges', async () => {
    // The fast path must not pay for coordination — a token lasts an hour, so
    // the overwhelming majority of calls answer from the cache.
    decryptSecrets.mockResolvedValue({
      client_secret: 'stored-secret',
      refresh_token: REFRESH_TOKEN,
      access_token: 'Atza|CACHED',
    });
    getDocument.mockResolvedValue(
      stored({ access_token_expires_at: Date.now() + 30 * 60_000 })
    );

    await mint();
    expect(insertDocument).not.toHaveBeenCalled();

    // Now an expired one: the lock is taken, keyed to this connection.
    decryptSecrets.mockResolvedValue({
      client_secret: 'stored-secret',
      refresh_token: REFRESH_TOKEN,
    });
    getDocument.mockResolvedValue(stored());
    await mint();

    const [domain, collection, key] = insertDocument.mock.calls[0];
    expect(domain).toBe('credentials');
    expect(collection).toBe('locks');
    expect(key).toBe(`REFRESH::SP_API::${SUBJECT}::sp-ATVPDKIKX0DER-ms3x3t97`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports 503 rather than exchanging when another request holds the lock', async () => {
    // Losing the race must never mean exchanging anyway: Amazon may rotate the
    // refresh token, and the second write can store one already superseded,
    // breaking the connection for good.
    insertDocument.mockResolvedValue(false);

    // Fake timers, so the wait budget is spent instantly rather than making
    // every CI run eight seconds longer. `advanceTimersByTimeAsync` drains the
    // microtask queue between timers, which is what lets the poll loop's awaits
    // resolve.
    vi.useFakeTimers();
    try {
      const pending = mint();
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await pending;

      expect(result).toMatchObject({
        ok: false,
        failure: { status: 503, error: 'RefreshInProgress' },
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('refreshes when there is an expiry but no stored token', async () => {
    getDocument.mockResolvedValue(
      stored({ access_token_expires_at: Date.now() + 30 * 60_000 })
    );

    await mint();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('failures are told apart', () => {
  it('is 404 for a profile that is not there', async () => {
    getDocument.mockResolvedValue(null);

    expect(await mint()).toMatchObject({
      ok: false,
      failure: { status: 404 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is 404 for a soft-deleted profile', async () => {
    getDocument.mockResolvedValue(stored({ deleted: true }));

    expect(await mint()).toMatchObject({ failure: { status: 404 } });
  });

  it('is 409, not 502, when the profile holds no refresh token', async () => {
    // Nothing failed and retrying cannot help — the connection is incomplete
    // and the user has to reconnect.
    decryptSecrets.mockResolvedValue({ client_secret: 'stored-secret' });

    expect(await mint()).toMatchObject({
      failure: { status: 409, error: 'NotConnected' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is 409 when Amazon rejects the refresh token', async () => {
    // `invalid_grant` means revoked or superseded. Retrying never fixes it, so
    // it must not be reported as a transient upstream failure.
    fetchMock.mockResolvedValue(lwaError('invalid_grant'));

    expect(await mint()).toMatchObject({
      failure: { status: 409, error: 'RefreshTokenRejected' },
    });
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('is 502 for any other Amazon error', async () => {
    fetchMock.mockResolvedValue(lwaError('server_error', 500));

    expect(await mint()).toMatchObject({
      failure: { status: 502, error: 'LwaError' },
    });
  });

  it('is 502 when the exchange cannot be reached', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    );

    expect(await mint()).toMatchObject({ failure: { status: 502 } });
  });

  it('refuses a profile connected under a different LWA application', async () => {
    // Amazon's own answer is `invalid_client`, which says nothing about which
    // half of the pair is wrong.
    getDocument.mockResolvedValue(stored({ client_id: 'amzn1.other-app' }));

    expect(await mint()).toMatchObject({
      failure: { status: 409, error: 'ClientMismatch' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a profile written before encryption', async () => {
    getDocument.mockResolvedValue(stored({ encrypted_secrets: '' }));

    expect(await mint()).toMatchObject({
      failure: { status: 409, error: 'Unencrypted' },
    });
    expect(decryptSecrets).not.toHaveBeenCalled();
  });

  it('never puts a secret in a failure message', async () => {
    fetchMock.mockResolvedValue(lwaError('invalid_grant'));

    const result = await mint();

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(REFRESH_TOKEN);
    expect(serialised).not.toContain(CLIENT_SECRET);
  });
});

describe('the region decides the endpoint', () => {
  it('uses the European token endpoint for an EU profile', async () => {
    getDocument.mockResolvedValue(stored({ region: 'EU' }));

    await mint();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.amazon.co.uk/auth/o2/token'
    );
  });

  it('falls back to NA when a profile has no region', async () => {
    getDocument.mockResolvedValue(stored({ region: undefined }));

    await mint();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.amazon.com/auth/o2/token'
    );
  });
});
