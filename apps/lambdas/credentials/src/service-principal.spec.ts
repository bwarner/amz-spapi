import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service principal (#152).
 *
 * This is the one place in the credential service where a caller may name an
 * account that is not its own, so the tests are mostly about what is REFUSED.
 * The failure that matters is not "the sync cannot mint" — that is loud. It is a
 * request that mints for the wrong seller and looks exactly like a right one.
 */

const executeQuery = vi.fn();
vi.mock('@amz-spapi/couchbase-utils', () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
}));

const { authorizeServiceMint, isServicePrincipal, servicePrincipals } =
  await import('./service-principal.js');

const MACHINE = 'AV0aVbr7Bkrgf3YuOzNT3fwUGpnwMbZV@clients';
const SELLER = 'auth0|65f0c0ffee';

const env = { SERVICE_PRINCIPALS: MACHINE } as NodeJS.ProcessEnv;

const body = (overrides: Record<string, unknown> = {}) => ({
  onBehalfOf: SELLER,
  apiType: 'SP_API',
  profileName: 'default',
  sellerId: 'A1SELLER',
  domain: 'finances',
  ...overrides,
});

beforeEach(() => {
  executeQuery.mockReset();
  // Not shed unless a test says so.
  executeQuery.mockResolvedValue({ rows: [] });
});

describe('servicePrincipals', () => {
  it('is empty when unset, which refuses every service mint', () => {
    expect(servicePrincipals({} as NodeJS.ProcessEnv).size).toBe(0);
  });

  it('reads a comma-separated list, tolerating spacing', () => {
    const parsed = servicePrincipals({
      SERVICE_PRINCIPALS: ` ${MACHINE} , other@clients ,`,
    } as NodeJS.ProcessEnv);

    expect([...parsed]).toEqual([MACHINE, 'other@clients']);
  });

  it('does not treat a machine-shaped subject as a principal on its own', () => {
    // Any client in the tenant can get a token for this audience. Being a
    // machine is not a permission; being on the list is.
    expect(isServicePrincipal('SomeOtherClientId@clients', env)).toBe(false);
  });
});

describe('authorizeServiceMint', () => {
  it('authorizes an allow-listed principal naming a seller', async () => {
    const result = await authorizeServiceMint({
      subject: MACHINE,
      body: body(),
      env,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.request.onBehalfOf).toBe(SELLER);
  });

  it('refuses a user token, which is the impersonation hole this route could open', async () => {
    // The whole reason act-on-behalf lives on its own route: if a user token
    // were honoured here, any signed-in user could mint for any other by
    // putting their subject in the body.
    const result = await authorizeServiceMint({
      subject: 'auth0|some-real-person',
      body: body({ onBehalfOf: 'auth0|somebody-else' }),
      env,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.status).toBe(403);
  });

  it('checks identity before it reads the body at all', async () => {
    // A non-principal must not get its `onBehalfOf` parsed, let alone reach the
    // shed query — the refusal cannot depend on the body being well-formed.
    const result = await authorizeServiceMint({
      subject: 'auth0|some-real-person',
      body: { total: 'nonsense' },
      env,
    });

    expect(result.ok === false && result.failure.status).toBe(403);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('refuses when no principal is configured for the stage', async () => {
    const result = await authorizeServiceMint({
      subject: MACHINE,
      body: body(),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.status).toBe(403);
  });

  it('will not default the subject — an absent onBehalfOf is refused, not assumed', async () => {
    const result = await authorizeServiceMint({
      subject: MACHINE,
      body: body({ onBehalfOf: undefined }),
      env,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.status).toBe(400);
    expect(result.ok === false && result.failure.detail).toContain(
      'onBehalfOf'
    );
  });

  it('will not let the shed check be skipped by omitting its fields', async () => {
    // A check the caller can switch off is not a check.
    for (const missing of ['sellerId', 'domain']) {
      const result = await authorizeServiceMint({
        subject: MACHINE,
        body: body({ [missing]: undefined }),
        env,
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.failure.detail).toContain(missing);
    }
  });

  it('does not echo the request body into the refusal', async () => {
    // The body names a user and a seller; a Zod error formatted with its input
    // would put both into the response and then into whatever logs it.
    const result = await authorizeServiceMint({
      subject: MACHINE,
      body: body({ profileName: 123 }),
      env,
    });

    expect(result.ok).toBe(false);
    const detail = result.ok === false ? result.failure.detail : '';
    expect(detail).toContain('profileName');
    expect(detail).not.toContain(SELLER);
    expect(detail).not.toContain('A1SELLER');
  });

  it('refuses a seller the dispatcher has shed', async () => {
    executeQuery.mockResolvedValue({ rows: [{ failures: 12 }] });

    const result = await authorizeServiceMint({
      subject: MACHINE,
      body: body(),
      env,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.error).toBe('Shed');
  });

  it('sheds per seller AND domain, so one dead report does not stop the rest', async () => {
    await authorizeServiceMint({ subject: MACHINE, body: body(), env });

    const [, , options] = executeQuery.mock.calls[0];
    expect(options.parameters).toMatchObject({
      sellerId: 'A1SELLER',
      domain: 'finances',
    });
    // Read-only: nothing on the authorization path may write.
    expect(options.readonly).toBe(true);
  });

  it('rejects an unknown apiType rather than coercing it', async () => {
    const result = await authorizeServiceMint({
      subject: MACHINE,
      body: body({ apiType: 'SP-API' }),
      env,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failure.status).toBe(400);
  });
});
