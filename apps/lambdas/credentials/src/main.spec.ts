import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The credentials read API (#55).
 *
 * Two properties carry the whole security argument for this function, and the
 * tests are ordered by how bad it is to get them wrong:
 *
 *   1. identity comes from the verified JWT and nowhere else — otherwise any
 *      caller reads any seller's connections by editing a URL;
 *   2. no secret reaches a response body — the reason this slice is being
 *      moved off Vercel in the first place.
 */

const executeQuery = vi.fn();
const getDocument = vi.fn();

vi.mock('@amz-spapi/couchbase-utils', () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  getDocument: (...args: unknown[]) => getDocument(...args),
  // `main.ts` registers a credentials provider at module scope, so the mock has
  // to offer the setter even though these tests never exercise it.
  setConnectionProvider: () => undefined,
}));

/**
 * Captures what is handed to the logger.
 *
 * Mocked rather than spied on `console`: Powertools binds its console methods
 * at construction, and the logger is built at module load, so a spy installed
 * afterwards never sees the write. This asserts the argument instead, which is
 * the thing actually under test — what this function chooses to log.
 */
const logged: unknown[] = [];
vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    error(...args: unknown[]) {
      logged.push(...args);
    }
    warn(...args: unknown[]) {
      logged.push(...args);
    }
    info(...args: unknown[]) {
      logged.push(...args);
    }
  },
}));

/**
 * The minting path, stubbed.
 *
 * What is under test here is dispatch — which requests reach the one route that
 * produces a credential. Whether it produces the right one is
 * `access-token.spec.ts`, and mocking it keeps a routing regression from being
 * hidden behind a KMS or Secrets Manager failure.
 */
const mintAccessToken = vi.fn();
vi.mock('./access-token.js', () => ({
  mintAccessToken: (...args: unknown[]) => mintAccessToken(...args),
}));

/**
 * The connect path, stubbed for the same reason.
 *
 * `ConnectRequestSchema` is NOT stubbed — body validation is part of what this
 * route does, and a mocked schema would test nothing.
 */
const connect = vi.fn();
vi.mock('./connect.js', async () => {
  const actual = await vi.importActual<typeof import('./connect.js')>(
    './connect.js'
  );
  return {
    ConnectRequestSchema: actual.ConnectRequestSchema,
    connect: (...args: unknown[]) => connect(...args),
  };
});

/** The disconnect path, stubbed for the same reason as the other two. */
const disconnect = vi.fn();
vi.mock('./disconnect.js', () => ({
  disconnect: (...args: unknown[]) => disconnect(...args),
}));

const {
  handler,
  subjectOf,
  redactErrorMessage,
  ACCESS_TOKEN_ROUTE,
  CONNECT_ROUTE,
  DISCONNECT_ROUTE,
} = await import('./main.js');

const SUBJECT = 'auth0|69cf4c211c2242f800bcec09';

/** A stored profile, in the shape the database actually holds. */
const stored = (overrides: Record<string, unknown> = {}) => ({
  profile_name: 'sp-ATVPDKIKX0DER-ms3x3t97',
  api_type: 'SP_API',
  user_id: SUBJECT,
  client_id: 'amzn1.application-oa2-client.public',
  marketplace_id: 'ATVPDKIKX0DER',
  region: 'NA',
  seller_id: 'A2HXBWIE3KMLKV',
  created_at: 1,
  updated_at: 2,
  encrypted_secrets: 'kms:AQIDAHj-CIPHERTEXT',
  has_refresh_token: true,
  ...overrides,
});

const authorized = (extra: Record<string, unknown> = {}) => ({
  requestContext: { authorizer: { jwt: { claims: { sub: SUBJECT } } } },
  ...extra,
});

beforeEach(() => {
  logged.length = 0;
  executeQuery.mockReset();
  getDocument.mockReset();
  executeQuery.mockResolvedValue({ rows: [stored()] });
  getDocument.mockResolvedValue(null);
  disconnect
    .mockReset()
    .mockResolvedValue({ ok: true, deleted: true, clearedDefault: false });
  connect.mockReset().mockResolvedValue({
    ok: true,
    connected: {
      profiles: [{ profile_name: 'sp-1', api_type: 'SP_API' }],
      default: 'sp-1',
    },
  });
  mintAccessToken.mockReset().mockResolvedValue({
    ok: true,
    token: {
      access_token: 'Atza|TOKEN',
      expires_at: Date.now() + 3600_000,
      token_type: 'bearer',
      refreshed: true,
    },
  });
});

describe('identity comes from the token', () => {
  it('refuses a request with no verified subject', async () => {
    // The authorizer did not run: the route was left open, or this was invoked
    // directly. Answering would serve credentials against an unproven identity.
    const result = await handler({});

    expect(result.statusCode).toBe(401);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('queries for the token subject, never a caller-supplied id', async () => {
    // The attack this closes: `?userId=someone-else`. The parameter is present
    // and must be ignored entirely.
    await handler(
      authorized({ queryStringParameters: { userId: 'auth0|victim' } })
    );

    const [, , options] = executeQuery.mock.calls[0];
    expect(options.parameters.userId).toBe(SUBJECT);
    expect(JSON.stringify(executeQuery.mock.calls[0])).not.toContain('victim');
  });

  it('builds the document key from the subject, not the path', async () => {
    // Same attack against the single-profile route.
    getDocument.mockResolvedValue(stored());

    await handler(
      authorized({
        pathParameters: { apiType: 'SP_API', profileName: 'p' },
        queryStringParameters: { userId: 'auth0|victim' },
      })
    );

    const [, , key] = getDocument.mock.calls[0];
    expect(key).toBe(`SP_API::${SUBJECT}::p`);
  });

  it('binds the subject as a parameter rather than interpolating it', async () => {
    // An Auth0 subject is opaque and arrives from a token. Interpolated into a
    // LIKE pattern, a `%` in it would match other users' documents.
    await handler(authorized());

    const [, statement] = executeQuery.mock.calls[0];
    expect(statement).not.toContain(SUBJECT);
  });

  it('reads the subject from the verified claims only', () => {
    expect(subjectOf(authorized())).toBe(SUBJECT);
    expect(subjectOf({ queryStringParameters: { sub: 'auth0|x' } })).toBe(
      undefined
    );
  });
});

describe('no secret reaches the response', () => {
  it('never returns the encrypted blob', async () => {
    const result = await handler(authorized());

    expect(result.body).not.toContain('CIPHERTEXT');
    expect(result.body).not.toContain('encrypted_secrets');
  });

  it('never returns a token even if storage grows one', async () => {
    // A plaintext field appearing in storage — by mistake, or by a future
    // change — must not reach a caller by riding along.
    executeQuery.mockResolvedValue({
      rows: [
        stored({ refresh_token: 'Atzr|LEAKED', access_token: 'Atza|LEAKED' }),
      ],
    });

    const result = await handler(authorized());

    expect(result.body).not.toContain('LEAKED');
  });

  it('reports the refresh token as a boolean', async () => {
    const body = JSON.parse((await handler(authorized())).body);

    expect(body.profiles[0].has_refresh_token).toBe(true);
  });

  it('keeps a failure message out of the response body', async () => {
    // A data-layer error can carry a document body. The caller gets a status,
    // not the contents.
    executeQuery.mockRejectedValue(
      new Error('Couchbase 500: {"encrypted_secrets":"kms:LEAKED"}')
    );

    const result = await handler(authorized());

    expect(result.statusCode).toBe(502);
    expect(result.body).not.toContain('LEAKED');
  });

  it('keeps it out of the LOG too', async () => {
    // Found by reading this suite's own output: the first version returned a
    // clean 502 and then wrote the whole document into CloudWatch, where it is
    // retained and readable by anyone with log access. A response-body
    // assertion alone does not catch that.
    executeQuery.mockRejectedValue(
      new Error(
        'Couchbase Data API 500: {"encrypted_secrets":"kms:AQIDAHj-LEAKED"}'
      )
    );

    await handler(authorized());

    const written = JSON.stringify(logged);
    expect(written).not.toContain('LEAKED');
    expect(written).not.toContain('encrypted_secrets');
    // Still diagnostic: the operation and status survive the redaction.
    expect(written).toContain('Couchbase Data API 500');
  });

  it('redacts an array body as well as an object', async () => {
    expect(
      redactErrorMessage(new Error('failed: ["kms:LEAKED"]'))
    ).not.toContain('LEAKED');
  });

  it('leaves an error with no body alone', async () => {
    // Over-redacting would throw away the only useful part of a plain failure.
    expect(redactErrorMessage(new Error('connection refused'))).toBe(
      'connection refused'
    );
  });
});

describe('an unmigrated profile', () => {
  it('says the refresh token state is unknown rather than guessing', async () => {
    // Documents written before #55 carry no flag. `false` would present a
    // working connection as broken; `true` sends the user into a flow that
    // fails at Amazon. Neither is reported as fact.
    executeQuery.mockResolvedValue({
      rows: [stored({ has_refresh_token: undefined })],
    });

    const body = JSON.parse((await handler(authorized())).body);

    expect(body.profiles[0].has_refresh_token_known).toBe(false);
  });

  it('marks a migrated profile as known', async () => {
    const body = JSON.parse((await handler(authorized())).body);

    expect(body.profiles[0].has_refresh_token_known).toBe(true);
  });
});

describe('routing', () => {
  it('lists profiles with the default pointers', async () => {
    getDocument.mockResolvedValue({ profileName: 'sp-default' });

    const body = JSON.parse((await handler(authorized())).body);

    expect(body.profiles).toHaveLength(1);
    expect(body.defaults.SP_API).toBe('sp-default');
  });

  it('returns 404 for a profile that is not there', async () => {
    getDocument.mockResolvedValue(null);

    const result = await handler(
      authorized({ pathParameters: { apiType: 'SP_API', profileName: 'nope' } })
    );

    expect(result.statusCode).toBe(404);
  });

  it('treats a soft-deleted profile as absent', async () => {
    getDocument.mockResolvedValue(stored({ deleted: true }));

    const result = await handler(
      authorized({ pathParameters: { apiType: 'SP_API', profileName: 'p' } })
    );

    expect(result.statusCode).toBe(404);
  });

  it('rejects an unknown apiType instead of filtering to nothing', async () => {
    // An empty list reads as "you have no connections", which is a different
    // and far more alarming answer than "you asked wrongly".
    const result = await handler(
      authorized({ queryStringParameters: { apiType: 'SP-API' } })
    );

    expect(result.statusCode).toBe(400);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('filters by apiType when asked', async () => {
    await handler(
      authorized({ queryStringParameters: { apiType: 'ADS_API' } })
    );

    const [, statement, options] = executeQuery.mock.calls[0];
    expect(statement).toContain('$apiType');
    expect(options.parameters.apiType).toBe('ADS_API');
  });
});

describe('the access-token route', () => {
  const tokenRequest = (extra: Record<string, unknown> = {}) =>
    authorized({
      routeKey: ACCESS_TOKEN_ROUTE,
      pathParameters: { apiType: 'SP_API', profileName: 'sp-1' },
      requestContext: {
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { sub: SUBJECT } } },
      },
      ...extra,
    });

  it('mints for the token subject, never a caller-supplied id', async () => {
    const result = await handler(tokenRequest());

    expect(result.statusCode).toBe(200);
    expect(mintAccessToken).toHaveBeenCalledWith(SUBJECT, 'SP_API', 'sp-1');
  });

  it('still refuses without a verified subject', async () => {
    const result = await handler({
      routeKey: ACCESS_TOKEN_ROUTE,
      pathParameters: { apiType: 'SP_API', profileName: 'sp-1' },
    });

    expect(result.statusCode).toBe(401);
    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('does not mint for the profile GET, which shares the path prefix', async () => {
    await handler(
      authorized({ pathParameters: { apiType: 'SP_API', profileName: 'sp-1' } })
    );

    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('needs POST as well as the path when there is no routeKey', async () => {
    // The direct-invocation fallback. A GET at a suggestive URL must not reach
    // the one route that produces a credential.
    await handler(
      authorized({
        rawPath: '/credentials/SP_API/sp-1/access-token',
        pathParameters: { apiType: 'SP_API', profileName: 'sp-1' },
        requestContext: {
          http: { method: 'GET' },
          authorizer: { jwt: { claims: { sub: SUBJECT } } },
        },
      })
    );

    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('passes the failure status through rather than flattening it', async () => {
    // 409 means the user must reconnect; 502 means retry. Collapsing them
    // sends the UI down the wrong path.
    mintAccessToken.mockResolvedValue({
      ok: false,
      failure: {
        status: 409,
        error: 'RefreshTokenRejected',
        detail: 'Amazon rejected the refresh token.',
      },
    });

    const result = await handler(tokenRequest());

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('RefreshTokenRejected');
  });

  it('never logs the token it just issued', async () => {
    // CloudWatch retains logs and anyone with log access can read them. The
    // audit line records THAT a token was issued, not what it was.
    await handler(tokenRequest());

    expect(JSON.stringify(logged)).not.toContain('Atza|TOKEN');
    expect(JSON.stringify(logged)).toContain('minted access token');
  });
});

describe('the connect route', () => {
  const body = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      apiType: 'SP_API',
      code: 'ANLrEXAMPLECODE',
      profileName: 'sp-1',
      marketplaceId: 'ATVPDKIKX0DER',
      redirectUri: 'https://local.sellavant.com/api/amazon/callback',
      ...overrides,
    });

  const connectRequest = (extra: Record<string, unknown> = {}) =>
    authorized({
      routeKey: CONNECT_ROUTE,
      body: body(),
      requestContext: {
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { sub: SUBJECT } } },
      },
      ...extra,
    });

  it('connects for the token subject, never one named in the body', async () => {
    const result = await handler(connectRequest());

    expect(result.statusCode).toBe(200);
    expect(connect.mock.calls[0][0]).toBe(SUBJECT);
  });

  it('ignores a userId smuggled into the body', async () => {
    await handler(connectRequest({ body: body({ userId: 'auth0|victim' }) }));

    expect(connect.mock.calls[0][0]).toBe(SUBJECT);
    expect(connect.mock.calls[0][1]).not.toHaveProperty('userId');
  });

  it('refuses without a verified subject', async () => {
    const result = await handler({ routeKey: CONNECT_ROUTE, body: body() });

    expect(result.statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not fall through to the listing when the body is missing', async () => {
    // `/credentials/connect` has no path parameters, so before the route check
    // it would have been answered as a list — a connection attempt reported as
    // a success that connected nothing.
    const result = await handler(
      authorized({ routeKey: CONNECT_ROUTE, body: null })
    );

    expect(result.statusCode).toBe(400);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('decodes a base64 body, which API Gateway may send', async () => {
    await handler(
      connectRequest({
        body: Buffer.from(body()).toString('base64'),
        isBase64Encoded: true,
      })
    );

    expect(connect).toHaveBeenCalled();
  });

  it('rejects a malformed body without echoing it', async () => {
    // The body holds an authorization code; a validation error formatted with
    // its input would put the code in the response and then in whatever logs it.
    const result = await handler(
      connectRequest({ body: body({ code: '', redirectUri: 'javascript:x' }) })
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).not.toContain('ANLrEXAMPLECODE');
    expect(JSON.parse(result.body).detail).toContain('code');
  });

  it('passes the failure status through rather than flattening it', async () => {
    connect.mockResolvedValue({
      ok: false,
      failure: {
        status: 409,
        error: 'AuthorizationCodeRejected',
        detail: 'Amazon rejected the authorization code.',
      },
    });

    const result = await handler(connectRequest());

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('AuthorizationCodeRejected');
  });

  it('never logs the code it was given', async () => {
    await handler(connectRequest());

    expect(JSON.stringify(logged)).not.toContain('ANLrEXAMPLECODE');
    expect(JSON.stringify(logged)).toContain('connected an amazon account');
  });
});

describe('the disconnect route', () => {
  const deleteRequest = (extra: Record<string, unknown> = {}) =>
    authorized({
      routeKey: DISCONNECT_ROUTE,
      pathParameters: { apiType: 'SP_API', profileName: 'sp-1' },
      requestContext: {
        http: { method: 'DELETE' },
        authorizer: { jwt: { claims: { sub: SUBJECT } } },
      },
      ...extra,
    });

  it('disconnects for the token subject', async () => {
    const result = await handler(deleteRequest());

    expect(result.statusCode).toBe(200);
    expect(disconnect).toHaveBeenCalledWith(SUBJECT, 'SP_API', 'sp-1');
  });

  it('refuses without a verified subject', async () => {
    const result = await handler({
      routeKey: DISCONNECT_ROUTE,
      pathParameters: { apiType: 'SP_API', profileName: 'sp-1' },
    });

    expect(result.statusCode).toBe(401);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('does not delete in answer to a GET on the same path', async () => {
    // `GET` and `DELETE` share this path, so the method is the entire
    // distinction. Getting it wrong in the permissive direction destroys a
    // credential in answer to a read.
    getDocument.mockResolvedValue(stored());

    await handler(
      authorized({
        rawPath: '/credentials/SP_API/sp-1',
        pathParameters: { apiType: 'SP_API', profileName: 'sp-1' },
        requestContext: {
          http: { method: 'GET' },
          authorizer: { jwt: { claims: { sub: SUBJECT } } },
        },
      })
    );

    expect(disconnect).not.toHaveBeenCalled();
  });

  it('reports a delete that found nothing as a success', async () => {
    disconnect.mockResolvedValue({
      ok: true,
      deleted: false,
      clearedDefault: false,
    });

    const result = await handler(deleteRequest());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).deleted).toBe(false);
  });

  it('records the destruction in the log', async () => {
    // The one irreversible action here, so it needs an audit line.
    await handler(deleteRequest());

    expect(JSON.stringify(logged)).toContain('disconnected an amazon account');
  });
});

/**
 * Unattended callers (#152).
 *
 * Dispatch only — whether a request is authorized is `service-principal.spec.ts`.
 * What matters here is that the two kinds of caller cannot reach each other's
 * routes, because every other guarantee in this function rests on that.
 */
describe('the service mint route', () => {
  const MACHINE = 'AV0aVbr7Bkrgf3YuOzNT3fwUGpnwMbZV@clients';

  const serviceRequest = (
    subject: string = MACHINE,
    body: Record<string, unknown> = {},
    scope = 'credentials:mint'
  ) => ({
    routeKey: 'POST /credentials/service/access-token',
    requestContext: {
      http: { method: 'POST' },
      // `scope` as a space-delimited claim, which is the shape a real Auth0
      // client-credentials token carries.
      authorizer: { jwt: { claims: { sub: subject, scope } } },
    },
    body: JSON.stringify({
      onBehalfOf: SUBJECT,
      apiType: 'SP_API',
      profileName: 'sp-ATVPDKIKX0DER-ms3x3t97',
      sellerId: 'A2HXBWIE3KMLKV',
      domain: 'finances',
      ...body,
    }),
  });

  beforeEach(() => {
    process.env.SERVICE_PRINCIPALS = MACHINE;
    // Nothing shed, unless a test says otherwise.
    executeQuery.mockResolvedValue({ rows: [] });
    mintAccessToken.mockResolvedValue({
      ok: true,
      token: {
        access_token: 'Atza|SERVICE',
        expires_at: 3,
        token_type: 'bearer',
        refreshed: true,
      },
    });
  });

  it('mints for the NAMED seller, not for the machine', async () => {
    // The single most important assertion in this file: get the argument order
    // or the source of this id wrong and the sync silently syncs the wrong
    // account with a token that works.
    const result = await handler(serviceRequest());

    expect(result.statusCode).toBe(200);
    expect(mintAccessToken).toHaveBeenCalledWith(
      SUBJECT,
      'SP_API',
      'sp-ATVPDKIKX0DER-ms3x3t97'
    );
  });

  it('logs actor and subject separately', async () => {
    await handler(serviceRequest());

    const line = JSON.stringify(logged);
    expect(line).toContain('minted access token for a service principal');
    expect(line).toContain(MACHINE);
    expect(line).toContain(SUBJECT);
  });

  it('refuses a user token on this route', async () => {
    const result = await handler(serviceRequest('auth0|a-real-person'));

    expect(result.statusCode).toBe(403);
    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('refuses a service principal on every user route', async () => {
    // Mint-only. Each of these would otherwise treat the machine as a user.
    const machineClaims = {
      requestContext: { authorizer: { jwt: { claims: { sub: MACHINE } } } },
    };

    for (const event of [
      { ...machineClaims },
      {
        ...machineClaims,
        routeKey: ACCESS_TOKEN_ROUTE,
        pathParameters: { apiType: 'SP_API', profileName: 'p' },
      },
      { ...machineClaims, routeKey: CONNECT_ROUTE, body: '{}' },
      {
        ...machineClaims,
        routeKey: DISCONNECT_ROUTE,
        pathParameters: { apiType: 'SP_API', profileName: 'p' },
      },
    ]) {
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    }

    expect(mintAccessToken).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('does not confuse the two access-token paths on direct invocation', async () => {
    // Both end in `/access-token`, and `sam local invoke` sends no routeKey.
    // A suffix match would let the user route answer the service path.
    const result = await handler({
      rawPath: '/credentials/service/access-token',
      requestContext: {
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { sub: 'auth0|a-real-person' } } },
      },
      body: JSON.stringify({ onBehalfOf: SUBJECT }),
    });

    expect(result.statusCode).toBe(403);
    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('refuses an allow-listed principal whose token carries no scope', async () => {
    // Both halves are required, and they are administered in different places:
    // the allow-list here, the client grant in the Auth0 tenant. Revoking the
    // grant must stop the mints without needing a deploy.
    const result = await handler(serviceRequest(MACHINE, {}, ''));

    expect(result.statusCode).toBe(403);
    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('refuses when the stage configures no principal', async () => {
    delete process.env.SERVICE_PRINCIPALS;

    const result = await handler(serviceRequest());

    expect(result.statusCode).toBe(403);
    expect(mintAccessToken).not.toHaveBeenCalled();
  });

  it('passes a mint failure through rather than reporting success', async () => {
    mintAccessToken.mockResolvedValue({
      ok: false,
      failure: {
        status: 409,
        error: 'Reconnect',
        detail: 'Revoked at Amazon.',
      },
    });

    const result = await handler(serviceRequest());

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('Reconnect');
  });
});
