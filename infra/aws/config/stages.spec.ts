import { STAGES, getStageConfig } from './stages.js';

/**
 * The account mapping, which nothing else checks.
 *
 * A wrong account is worse than a missing one — it either fails in a way that
 * reads as an ordinary permissions problem, or succeeds in the wrong place.
 * `prod` previously defaulted to the Organizations management account.
 */

describe('stage accounts', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env['SELLAVANT_PROD_ACCOUNT_ID'];
    delete process.env['SELLAVANT_AWS_ACCOUNT_ID'];
  });
  afterEach(() => {
    process.env = env;
  });

  it('puts dev and staging in the same SellAvant account', () => {
    // Deliberate: resource names carry the stage, so the two cannot collide.
    expect(STAGES.dev.account).toBe('853583158600');
    expect(STAGES.staging.account).toBe('853583158600');
  });

  it("uses SellAvant's own production account", () => {
    expect(STAGES.prod.account).toBe('108248327073');
  });

  it('never uses the management or SSG accounts', () => {
    // 132664187310 is the Organizations management account and is where prod
    // used to point; 260820062117 (ssg-prod) and 654654299558 belong to
    // ScanSafeGuard. None may host SellAvant.
    const forbidden = ['132664187310', '260820062117', '654654299558'];

    for (const stage of ['dev', 'staging', 'prod'] as const) {
      expect(forbidden).not.toContain(STAGES[stage].account);
    }
  });

  it('lets the environment override a stage account', async () => {
    // The table is built when the module loads, so the override only applies
    // to a process that already had the variable set — which is how CI and a
    // one-off deploy would use it. Re-importing is the only way to exercise
    // that from a test.
    process.env['SELLAVANT_PROD_ACCOUNT_ID'] = '111122223333';
    vi.resetModules();

    const fresh = await import('./stages.js');

    expect(fresh.STAGES.prod.account).toBe('111122223333');
  });

  it('resolves every stage without throwing', () => {
    for (const stage of ['dev', 'staging', 'prod'] as const) {
      expect(() => getStageConfig(stage).account).not.toThrow();
    }
  });
});

/**
 * Service principals (#152).
 *
 * These are the identities allowed to mint an Amazon access token on behalf of
 * ANY connected seller in their stage. The failure worth guarding is not a
 * missing one — that refuses every mint, loudly. It is a SHARED one, which
 * would let a token minted for dev act on production accounts.
 */
describe('service principals', () => {
  const principalsOf = (stage: 'dev' | 'staging' | 'prod') =>
    STAGES[stage].servicePrincipals ?? [];

  it('never shares a principal between stages', () => {
    // Each stage is a different Auth0 tenant, so a value appearing twice means
    // a copy-paste rather than a legitimate arrangement.
    const all = (['dev', 'staging', 'prod'] as const).flatMap(principalsOf);
    expect(new Set(all).size).toBe(all.length);
  });

  it('does not trust dev principals in production', () => {
    for (const principal of principalsOf('dev')) {
      expect(principalsOf('prod')).not.toContain(principal);
    }
  });

  it('shapes every principal as a machine subject', () => {
    // A client-credentials `sub` is `<client_id>@clients`. A bare client id
    // here would never match, and the mint would be refused with a message
    // about the allow-list rather than about the shape.
    for (const stage of ['dev', 'staging', 'prod'] as const) {
      for (const principal of principalsOf(stage)) {
        expect(principal).toMatch(/^[A-Za-z0-9]{20,}@clients$/);
      }
    }
  });
});
