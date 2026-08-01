import {
  ApiError,
  ApiService,
  apiErrorResponse,
  describeToken,
} from './api-service';

/** A concrete service, since ApiService is abstract by design. */
class TestService extends ApiService {
  get(path: string) {
    return this.request<{ ok: boolean }>(path);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const service = (fetchImpl: typeof fetch) =>
  new TestService({
    apiUrl: 'https://api.example.com',
    accessToken: 'token-123',
    fetchImpl,
  });

describe('ApiService construction', () => {
  it('refuses to build without an API URL, naming the variable', () => {
    expect(
      () => new TestService({ apiUrl: '', accessToken: 't' })
    ).toThrowError(/SELLAVANT_API_URL/);
  });

  it('refuses to build without a token rather than sending "Bearer undefined"', () => {
    expect(
      () =>
        new TestService({ apiUrl: 'https://api.example.com', accessToken: '' })
    ).toThrowError(/access token/i);
  });

  it('tolerates a trailing slash on the configured URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));
    const trailing = new TestService({
      apiUrl: 'https://api.example.com/',
      accessToken: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await trailing.get('/me');

    // Not https://api.example.com//me, which some gateways 404.
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/me');
  });
});

describe('ApiService requests', () => {
  it('forwards the caller token as a bearer credential', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));

    await service(fetchImpl as unknown as typeof fetch).get('/me');

    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer token-123');
    expect(headers.Accept).toBe('application/json');
  });

  it('returns the parsed body on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true }));

    await expect(
      service(fetchImpl as unknown as typeof fetch).get('/me')
    ).resolves.toEqual({ ok: true });
  });
});

describe('ApiService failure mapping', () => {
  beforeEach(() => {
    // The 401 path describes the token to the log; that is deliberate, and
    // noise in the test output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes an upstream 401 through as 401, not 500', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ error: 'Unauthorized' }, 401));

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/me')
      .catch((e) => e as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.isAuthError).toBe(true);
  });

  it('passes an upstream 403 through as 403', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ error: 'Forbidden' }, 403));

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/me')
      .catch((e) => e as ApiError);

    expect(error.status).toBe(403);
    expect(error.isAuthError).toBe(false);
  });

  it('reports an upstream 500 as 502, so the failing side is identifiable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'boom' }, 500));

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/me')
      .catch((e) => e as ApiError);

    expect(error.status).toBe(502);
    expect(error.upstreamStatus).toBe(500);
    expect(error.message).toContain('/me');
  });

  it('reports an upstream 404 as 502, since it is our routing mistake', async () => {
    // A 404 from the API means the BFF asked for a path that does not exist —
    // not "this user has no data", which is what a bare 404 would imply.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ error: 'Not Found' }, 404));

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/nope')
      .catch((e) => e as ApiError);

    expect(error.status).toBe(502);
    expect(error.upstreamStatus).toBe(404);
  });

  it('reports a transport failure as 502 and never as an auth error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/me')
      .catch((e) => e as ApiError);

    expect(error.status).toBe(502);
    expect(error.isAuthError).toBe(false);
    expect(error.upstreamStatus).toBeUndefined();
  });

  it('reports a 200 that is not JSON as 502 rather than throwing raw', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>login</html>', { status: 200 }));

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/me')
      .catch((e) => e as ApiError);

    expect(error.status).toBe(502);
    expect(error.message).toContain('non-JSON');
  });

  it('surfaces the upstream detail in the message', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        json({ error: 'Unauthenticated', detail: 'No verified subject.' }, 401)
      );

    const error = await service(fetchImpl as unknown as typeof fetch)
      .get('/me')
      .catch((e) => e as ApiError);

    expect(error.message).toContain('No verified subject.');
  });
});

describe('describeToken', () => {
  const jwt = (claims: Record<string, unknown>, header = { alg: 'RS256' }) =>
    [
      Buffer.from(JSON.stringify(header)).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      'signature-not-checked',
    ].join('.');

  it('names the opaque-token case, which the gateway cannot report', () => {
    // Auth0 issues an opaque token when no audience was requested. It looks
    // like a valid credential and is rejected without explanation.
    const described = describeToken('opaque-token-value');

    expect(described.problem).toMatch(/Not a JWT/);
    expect(described.problem).toMatch(/AUTH0_AUDIENCE/);
  });

  it('reports the audience and issuer to compare against the authorizer', () => {
    const described = describeToken(
      jwt({
        aud: 'https://local.sellavant.com',
        iss: 'https://sellavant-dev.us.auth0.com/',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );

    expect(described.aud).toBe('https://local.sellavant.com');
    expect(described.iss).toBe('https://sellavant-dev.us.auth0.com/');
    expect(described.alg).toBe('RS256');
    expect(described.expired).toBe(false);
  });

  it('reports an expired token as expired', () => {
    const described = describeToken(
      jwt({ aud: 'a', iss: 'b', exp: Math.floor(Date.now() / 1000) - 60 })
    );

    expect(described.expired).toBe(true);
  });

  it('never returns the token itself', () => {
    const token = jwt({ aud: 'a', iss: 'b', exp: 1 });

    expect(JSON.stringify(describeToken(token))).not.toContain(token);
  });

  it('survives a three-segment value that is not really a JWT', () => {
    expect(describeToken('a.b.c').problem).toMatch(/did not decode/);
  });
});

describe('apiErrorResponse', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 401 for an auth error so the UI can send the user to sign in', async () => {
    const response = apiErrorResponse(new ApiError(401, 'Token rejected.'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Token rejected.',
      retryable: false,
    });
  });

  it('marks a 502 retryable', async () => {
    const response = apiErrorResponse(new ApiError(502, 'API down.'));

    expect(response.status).toBe(502);
    expect((await response.json()).retryable).toBe(true);
  });

  it('does not leak the message of an unexpected error', async () => {
    const response = apiErrorResponse(
      new Error('connect ECONNREFUSED 10.0.0.5:8080')
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal error.' });
  });

  it('logs an unexpected error rather than discarding it', () => {
    const error = new Error('boom');

    apiErrorResponse(error);

    expect(console.error).toHaveBeenCalledWith(
      '[api-service] unexpected error',
      error
    );
  });
});
