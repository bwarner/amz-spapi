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

const { handler, subjectOf, redactErrorMessage } = await import('./main.js');

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
