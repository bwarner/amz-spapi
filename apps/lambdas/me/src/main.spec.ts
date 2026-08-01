import {
  buildMeResponse,
  handler,
  readScopes,
  type JwtAuthorizedEvent,
} from './main.js';

const at = new Date('2026-08-01T12:00:00.000Z');

/** An event shaped the way API Gateway builds it for a JWT-authorized route. */
const authorized = (
  claims: Record<string, string>,
  scopes?: string[]
): JwtAuthorizedEvent => ({
  requestContext: { authorizer: { jwt: { claims, scopes } } },
});

describe('me lambda', () => {
  it('reports the subject the gateway verified', () => {
    const response = buildMeResponse(
      authorized({ sub: 'auth0|abc123', scope: 'openid profile email' }),
      { SERVICE_NAME: 'me', STAGE: 'dev' },
      { awsRequestId: 'req-1' },
      at
    );

    expect(response).toEqual({
      userId: 'auth0|abc123',
      email: undefined,
      name: undefined,
      scopes: ['openid', 'profile', 'email'],
      service: 'me',
      stage: 'dev',
      requestId: 'req-1',
      at: '2026-08-01T12:00:00.000Z',
    });
  });

  it('passes through profile claims when the tenant adds them', () => {
    const response = buildMeResponse(
      authorized({
        sub: 'google-oauth2|42',
        email: 'seller@example.com',
        name: 'A Seller',
      }),
      {},
      undefined,
      at
    );

    expect(response?.email).toBe('seller@example.com');
    expect(response?.name).toBe('A Seller');
  });

  it('treats a missing email as absent rather than inventing one', () => {
    // Auth0 access tokens for a custom API carry `sub` and usually nothing
    // else. That must not read as "this user has no email".
    const response = buildMeResponse(
      authorized({ sub: 'auth0|abc123' }),
      {},
      undefined,
      at
    );

    expect(response?.userId).toBe('auth0|abc123');
    expect(response?.email).toBeUndefined();
  });
});

describe('me lambda without a verified subject', () => {
  it('refuses an event carrying no claims at all', () => {
    expect(buildMeResponse({}, {}, undefined, at)).toBeUndefined();
  });

  it('refuses claims that have everything except a subject', () => {
    // The dangerous case: a body shaped like a verified identity, with no
    // identity in it.
    const response = buildMeResponse(
      authorized({ email: 'seller@example.com', scope: 'openid' }),
      {},
      undefined,
      at
    );

    expect(response).toBeUndefined();
  });

  it('answers 401, not 200 with an empty user', async () => {
    const response = await handler({}, undefined);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Unauthenticated',
      detail: 'No verified subject on the request.',
    });
  });

  it('answers 401 when invoked with no event at all', async () => {
    const response = await handler(undefined, undefined);

    expect(response.statusCode).toBe(401);
  });
});

describe('me lambda scopes', () => {
  it('splits the space-delimited scope claim', () => {
    expect(
      readScopes(authorized({ sub: 'x', scope: 'read:orders write' }))
    ).toEqual(['read:orders', 'write']);
  });

  it('prefers the parsed scopes array when the gateway supplies one', () => {
    // Present once the route declares authorization scopes; reading it now
    // means this does not change on the day that happens.
    expect(
      readScopes(authorized({ sub: 'x', scope: 'ignored' }, ['read:orders']))
    ).toEqual(['read:orders']);
  });

  it('is an empty list, never undefined, when there are no scopes', () => {
    expect(readScopes(authorized({ sub: 'x' }))).toEqual([]);
  });
});

describe('me lambda success path', () => {
  it('returns 200 and JSON for a verified caller', async () => {
    const response = await handler(authorized({ sub: 'auth0|abc123' }), {
      awsRequestId: 'req-9',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(JSON.parse(response.body).userId).toBe('auth0|abc123');
  });
});
