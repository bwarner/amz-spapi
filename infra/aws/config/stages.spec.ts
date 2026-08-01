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
