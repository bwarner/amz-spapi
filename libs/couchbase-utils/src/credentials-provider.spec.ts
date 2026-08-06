import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the connection comes from (#55).
 *
 * All five values travel together — host, bucket, scope, username, password.
 * They change as one unit when a cluster is rebuilt, so splitting them across
 * a deployed template and a fetched secret would create a window where a
 * function holds the new host with the old login.
 *
 * The default has to stay the environment: this library is imported by the web
 * app, the CLIs and the scripts, none of which register anything.
 */

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), { status: 200 });

let utils: typeof import('./couchbase-utils.js');

/** The credentials the Data API was actually called with. */
function sentCredentials(): { username: string; password: string } {
  const [, init] = fetchMock.mock.calls[0];
  const header = String(init.headers.Authorization).replace(/^Basic /, '');
  const [username, password] = Buffer.from(header, 'base64')
    .toString()
    .split(':');
  return { username, password };
}

const calledUrl = () => String(fetchMock.mock.calls[0][0]);

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
  process.env['CB_DATA_API_URL'] = 'https://example.cloud.couchbase.com';
  process.env['CB_BUCKET'] = 'test-bucket';
  process.env['CB_SCOPE'] = 'dev';
  process.env['CB_USERNAME'] = 'env-user';
  process.env['CB_PASSWORD'] = 'env-password';
  utils = await import('./couchbase-utils.js');
  utils.resetConnectionProvider();
});

afterEach(() => {
  utils.resetConnectionProvider();
});

describe('the default is the environment', () => {
  it('reads all five variables', async () => {
    // Regression cover for Vercel, the CLIs and the scripts, none of which
    // register a provider. If this breaks, everything outside AWS stops.
    await utils.upsertDocument('purchases', 'vendor-records', 'v1', {});

    expect(sentCredentials()).toEqual({
      username: 'env-user',
      password: 'env-password',
    });
    expect(calledUrl()).toContain(
      'https://example.cloud.couchbase.com/v1/buckets/test-bucket/scopes/dev/'
    );
  });

  it('names exactly which variables are missing', async () => {
    delete process.env['CB_PASSWORD'];
    delete process.env['CB_BUCKET'];

    const error = await utils
      .getDocument('purchases', 'vendor-records', 'v1')
      .catch((e: Error) => e);

    expect(String(error)).toContain('CB_BUCKET');
    expect(String(error)).toContain('CB_PASSWORD');
    // Not the ones that were present — the message is a checklist, not noise.
    expect(String(error)).not.toContain('CB_SCOPE');
  });
});

describe('a registered provider', () => {
  const connection = {
    dataApiUrl: 'https://from-secret.cloud.couchbase.com',
    bucket: 'secret-bucket',
    scope: 'staging',
    username: 'from-secrets-manager',
    password: 'fetched-at-runtime',
  };

  it('supplies the whole connection, not just the login', async () => {
    // The point of moving all five: the host and bucket come from the same
    // place as the password, so a cluster move is one write.
    utils.setConnectionProvider(async () => connection);

    await utils.upsertDocument('purchases', 'vendor-records', 'v1', {});

    expect(sentCredentials()).toEqual({
      username: 'from-secrets-manager',
      password: 'fetched-at-runtime',
    });
    expect(calledUrl()).toContain(
      'https://from-secret.cloud.couchbase.com/v1/buckets/secret-bucket/scopes/staging/'
    );
  });

  it('wins over the environment entirely', async () => {
    // On AWS the environment holds none of these. If any were set, the fetched
    // values must still be the ones used — otherwise a stale variable could
    // silently point a function at another environment's scope.
    utils.setConnectionProvider(async () => connection);

    await utils.upsertDocument('purchases', 'vendor-records', 'v1', {});

    expect(calledUrl()).not.toContain('test-bucket');
    expect(calledUrl()).not.toContain('/scopes/dev/');
  });

  it('is not consulted before the environment is even read', async () => {
    // Ordering matters only in that the provider is now the ONLY source; there
    // is no environment read left to fail first.
    const provider = vi.fn().mockResolvedValue(connection);
    utils.setConnectionProvider(provider);
    delete process.env['CB_BUCKET'];

    await utils.getDocument('purchases', 'vendor-records', 'v1');

    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("surfaces its failure as the operation's error", async () => {
    // Secrets Manager being unreachable must fail the request loudly, not fall
    // back to environment variables that on AWS would be absent anyway.
    utils.setConnectionProvider(async () => {
      throw new Error('GetSecretValue failed');
    });

    await expect(
      utils.getDocument('purchases', 'vendor-records', 'v1')
    ).rejects.toThrow(/GetSecretValue failed/);
  });

  it('is consulted for queries as well as key-value calls', async () => {
    // Two different code paths reach getDataApiConfig; only one was awaited in
    // an early draft.
    utils.setConnectionProvider(async () => connection);
    fetchMock.mockResolvedValue(ok({ status: 'success', results: [] }));

    await utils.executeQuery('purchases', 'SELECT 1');

    expect(sentCredentials().username).toBe('from-secrets-manager');
  });

  it('normalises a trailing slash on the host', async () => {
    // A secret edited by hand is where a stray slash comes from, and it would
    // otherwise produce `//v1/buckets/…`.
    utils.setConnectionProvider(async () => ({
      ...connection,
      dataApiUrl: 'https://from-secret.cloud.couchbase.com/',
    }));

    await utils.getDocument('purchases', 'vendor-records', 'v1');

    expect(calledUrl()).not.toContain('.com//');
  });
});
