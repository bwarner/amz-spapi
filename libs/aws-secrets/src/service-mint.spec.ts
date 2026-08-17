import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two-hop token path (#152).
 *
 * The failures worth guarding are the quiet ones: a client secret escaping into
 * an error message, and a machine token cached in a way that could hand one
 * seller's credential to another's sync.
 */

const getAuth0ServicePrincipal = vi.fn();
vi.mock('./auth0-service-principal.js', () => ({
  getAuth0ServicePrincipal: () => getAuth0ServicePrincipal(),
}));

const { mintSellerAccessToken, clearMachineToken, ServiceTokenError } =
  await import('./service-mint.js');

const SECRET = 'shh-this-is-the-client-secret';

const REQUEST = {
  onBehalfOf: 'auth0|seller',
  apiType: 'SP_API' as const,
  profileName: 'sp-ATVPDKIKX0DER-msi1l2wg',
  sellerId: 'A2HXBWIE3KMLKV',
  domain: 'finances',
};

const fetchMock = vi.fn();

/** Auth0 answers the token URL; the credential service answers everything else. */
function respond(handlers: {
  auth0?: () => Response;
  credentials?: () => Response;
}) {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/oauth/token')
      ? handlers.auth0?.() ??
        Response.json({ access_token: 'MACHINE', expires_in: 86400 })
      : handlers.credentials?.() ??
        Response.json({ access_token: 'Atza|SELLER' })
  );
}

beforeEach(() => {
  clearMachineToken();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env['CREDENTIALS_API_BASE_URL'] = 'https://api.example.com';
  getAuth0ServicePrincipal.mockResolvedValue({
    domain: 'sellavant-dev.us.auth0.com',
    audience: 'https://local.sellavant.com',
    clientId: 'CLIENT',
    clientSecret: SECRET,
  });
  respond({});
});

describe('mintSellerAccessToken', () => {
  it('exchanges a machine token for a seller token', async () => {
    expect(await mintSellerAccessToken(REQUEST)).toBe('Atza|SELLER');

    const [[auth0Url], [credentialsUrl, init]] = fetchMock.mock.calls;
    expect(auth0Url).toBe('https://sellavant-dev.us.auth0.com/oauth/token');
    expect(credentialsUrl).toBe(
      'https://api.example.com/credentials/service/access-token'
    );
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer MACHINE',
    });
  });

  it('names the seller in the body rather than relying on its own identity', async () => {
    await mintSellerAccessToken(REQUEST);

    const [, [, init]] = fetchMock.mock.calls;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(REQUEST);
  });

  it('reuses the machine token across sellers', async () => {
    // Safe precisely because it identifies the WORKER, not who it acts for.
    await mintSellerAccessToken(REQUEST);
    await mintSellerAccessToken({ ...REQUEST, sellerId: 'A-OTHER' });

    const auth0Calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/oauth/token')
    );
    expect(auth0Calls).toHaveLength(1);
  });

  it('does not cache the SELLER token', async () => {
    // The inverse of the above. A per-seller cache here would hand one seller's
    // token to another's sync, which authenticates fine and returns the wrong
    // account's data.
    await mintSellerAccessToken(REQUEST);
    await mintSellerAccessToken(REQUEST);

    const mints = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/credentials/service/')
    );
    expect(mints).toHaveLength(2);
  });

  it('never puts the client secret in an Auth0 failure', async () => {
    // Auth0 echoes request parameters in some error bodies, and the request
    // body here contains the secret.
    respond({
      auth0: () =>
        new Response(JSON.stringify({ error_description: SECRET }), {
          status: 401,
        }),
    });

    const error = await mintSellerAccessToken(REQUEST).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceTokenError);
    expect(String(error)).not.toContain(SECRET);
    // Still says what to check — a missing client grant presents as exactly
    // this, and the message should point there.
    expect(String(error)).toContain('client grant');
  });

  it('surfaces the credential service refusal, which distinguishes the causes', async () => {
    respond({
      credentials: () =>
        new Response(
          JSON.stringify({ error: 'Shed', detail: 'Reconnect the account.' }),
          { status: 409 }
        ),
    });

    const error = await mintSellerAccessToken(REQUEST).catch((e) => e);
    expect(String(error)).toContain('Shed');
    expect(String(error)).toContain('409');
  });

  it('treats a 200 with no token as a contract break, not a credential failure', async () => {
    respond({ credentials: () => Response.json({}) });

    const error = await mintSellerAccessToken(REQUEST).catch((e) => e);
    expect(String(error)).toContain('no access_token');
  });

  it('refuses when it has no credential service to ask', async () => {
    delete process.env['CREDENTIALS_API_BASE_URL'];

    await expect(mintSellerAccessToken(REQUEST)).rejects.toThrow(
      /CREDENTIALS_API_BASE_URL/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an absent expires_in as short rather than generous', async () => {
    // Guessing long keeps presenting a dead token; guessing short costs one
    // round trip and recovers on its own.
    respond({ auth0: () => Response.json({ access_token: 'MACHINE' }) });

    await mintSellerAccessToken(REQUEST);
    await mintSellerAccessToken(REQUEST);

    // 60s default minus the 60s renewal margin: never reused.
    const auth0Calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/oauth/token')
    );
    expect(auth0Calls).toHaveLength(2);
  });
});
