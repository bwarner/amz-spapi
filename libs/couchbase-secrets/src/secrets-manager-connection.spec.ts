import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Couchbase login, fetched from Secrets Manager (#55).
 *
 * Three things are being bought here and each has a test that fails without it:
 *
 *   1. cost and latency — one `GetSecretValue` per container, not one per
 *      Couchbase operation, and not one per concurrent caller on a cold start;
 *   2. recoverability — a rotated password, and a transient AWS failure, both
 *      heal rather than pinning the container to a broken value;
 *   3. the secret never appears in an error message.
 */

type Connection = {
  dataApiUrl: string;
  bucket: string;
  scope: string;
  username: string;
  password: string;
};

const send = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = send;
  },
  GetSecretValueCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

/**
 * Capture what gets registered.
 *
 * `useSecretsManagerConnection()` hands its provider to `couchbase-utils` and
 * returns nothing, so mocking the registration point is the only way to hold
 * the function under test — and it doubles as proof that registration happens
 * at all.
 */
let registered: (() => Promise<Connection>) | undefined;
vi.mock('@amz-spapi/couchbase-utils', () => ({
  setConnectionProvider: (provider: () => Promise<Connection>) => {
    registered = provider;
  },
}));

const { useSecretsManagerConnection, invalidateCachedConnection } =
  await import('./secrets-manager-connection.js');

const SECRET = 'sellavant-dev-couchbase';
const PASSWORD = 'sup3r-s3cret-p4ssw0rd';

/** The registered provider, as `couchbase-utils` would call it. */
const provider = (): Promise<Connection> => {
  if (!registered) throw new Error('no provider was registered');
  return registered();
};

beforeEach(() => {
  send.mockReset();
  registered = undefined;
  invalidateCachedConnection();
  vi.useFakeTimers();
  process.env['CB_CREDENTIALS_SECRET_ID'] = SECRET;
  for (const k of [
    'CB_DATA_API_URL',
    'CB_BUCKET',
    'CB_SCOPE',
    'CB_USERNAME',
    'CB_PASSWORD',
    'CB_SECRET_TTL_MS',
  ]) {
    delete process.env[k];
  }

  useSecretsManagerConnection();
});

afterEach(() => {
  vi.useRealTimers();
});

const secretValue = (password = PASSWORD) => ({
  SecretString: JSON.stringify({
    dataApiUrl: 'https://vnabxcz.data.cloud.couchbase.com',
    bucket: 'sell-avant',
    scope: 'dev',
    username: 'SellAvant',
    password,
  }),
});

describe('one fetch per container, not per operation', () => {
  it('reuses the login across calls', async () => {
    // Without this every Couchbase operation calls Secrets Manager: one
    // `credentials` request makes three, a sync-worker run makes thousands.
    send.mockResolvedValue(secretValue());

    await provider();
    await provider();
    await provider();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent callers on a cold start into one call', async () => {
    // The reason the PROMISE is cached rather than the value. On a cold
    // container several operations start at once; caching the resolved value
    // would let all of them miss and each issue its own GetSecretValue.
    let release!: (value: unknown) => void;
    send.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const all = Promise.all([provider(), provider(), provider(), provider()]);
    release(secretValue());
    const results = await all;

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.password === PASSWORD)).toBe(true);
  });

  it('returns the whole connection, not just the login', async () => {
    // The reason all five live together: a cluster move is one secret write
    // with no deploy, and host/bucket/scope/login can never disagree.
    send.mockResolvedValue(secretValue());

    await expect(provider()).resolves.toEqual({
      dataApiUrl: 'https://vnabxcz.data.cloud.couchbase.com',
      bucket: 'sell-avant',
      scope: 'dev',
      username: 'SellAvant',
      password: PASSWORD,
    });
  });

  it('asks for the secret named by the environment', async () => {
    send.mockResolvedValue(secretValue());

    await provider();

    expect(send.mock.calls[0][0].input).toMatchObject({ SecretId: SECRET });
  });
});

describe('recovering from a stale or failed fetch', () => {
  it('refetches once the TTL has elapsed', async () => {
    // Cached forever, a warm container keeps presenting a rotated-away
    // password until it happens to be recycled, failing every request until
    // then with no way to recover.
    send.mockResolvedValue(secretValue());
    await provider();

    vi.setSystemTime(Date.now() + 11 * 60_000);
    await provider();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('picks up a rotated password after the TTL', async () => {
    send.mockResolvedValueOnce(secretValue('old'));
    expect((await provider()).password).toBe('old');

    send.mockResolvedValueOnce(secretValue('rotated'));
    vi.setSystemTime(Date.now() + 11 * 60_000);

    expect((await provider()).password).toBe('rotated');
  });

  it('does not cache a failure', async () => {
    // A transient Secrets Manager error must not pin the container to a
    // rejected promise for the rest of the TTL — that would turn one blip into
    // ten minutes of total failure.
    send.mockRejectedValueOnce(new Error('throttled'));
    await expect(provider()).rejects.toThrow('throttled');

    send.mockResolvedValueOnce(secretValue());
    await expect(provider()).resolves.toMatchObject({ password: PASSWORD });
  });

  it('refetches after an explicit invalidation', async () => {
    send.mockResolvedValue(secretValue());
    await provider();

    invalidateCachedConnection();
    await provider();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('honours a TTL override', async () => {
    process.env['CB_SECRET_TTL_MS'] = '1000';
    send.mockResolvedValue(secretValue());
    await provider();

    vi.setSystemTime(Date.now() + 1500);
    await provider();

    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('the secret never appears in an error', () => {
  it('does not quote the body when the JSON is malformed', async () => {
    // A JSON syntax error quotes the text around the fault, and the text here
    // is the password.
    send.mockResolvedValue({ SecretString: `{"password":"${PASSWORD}"` });

    await expect(provider()).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(PASSWORD),
      })
    );
  });

  it('names the missing keys without echoing the present ones', async () => {
    send.mockResolvedValue({
      SecretString: JSON.stringify({
        password: PASSWORD,
        bucket: 'sell-avant',
      }),
    });

    const error = await provider().catch((e: Error) => e);

    expect(String(error)).toContain(SECRET);
    expect(String(error)).not.toContain(PASSWORD);
  });

  it('rejects a binary-only secret by name', async () => {
    send.mockResolvedValue({ SecretBinary: new Uint8Array([1, 2, 3]) });

    await expect(provider()).rejects.toThrow(/SecretString/);
  });
});

describe('the sam local invoke path', () => {
  it('uses the environment and never calls AWS', async () => {
    // `sam local invoke` has no AWS credentials to call Secrets Manager with.
    delete process.env['CB_CREDENTIALS_SECRET_ID'];
    process.env['CB_DATA_API_URL'] = 'https://local.example.com';
    process.env['CB_BUCKET'] = 'sell-avant';
    process.env['CB_SCOPE'] = 'dev';
    process.env['CB_USERNAME'] = 'local';
    process.env['CB_PASSWORD'] = 'local-pw';

    await expect(provider()).resolves.toEqual({
      dataApiUrl: 'https://local.example.com',
      bucket: 'sell-avant',
      scope: 'dev',
      username: 'local',
      password: 'local-pw',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('throws naming both routes when neither is configured', async () => {
    delete process.env['CB_CREDENTIALS_SECRET_ID'];

    const error = await provider().catch((e: Error) => e);

    expect(String(error)).toContain('CB_CREDENTIALS_SECRET_ID');
    expect(String(error)).toContain('CB_DATA_API_URL');
  });
});
