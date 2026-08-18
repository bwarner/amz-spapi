import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three steps of the ads report sync (#145).
 *
 * Amazon bills for generating a report, so the failures worth pinning are the
 * expensive ones: a window fetched twice, a window fetched too early to be
 * final, and one profile's failure abandoning the others.
 */

const executeQuery = vi.fn();
vi.mock('@amz-spapi/couchbase-utils', () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  setConnectionProvider: () => undefined,
}));

const requestAdsReport = vi.fn();
const collectAdsReport = vi.fn();
vi.mock('@amz-spapi/sp-cache', () => ({
  requestAdsReport: (...a: unknown[]) => requestAdsReport(...a),
  collectAdsReport: (...a: unknown[]) => collectAdsReport(...a),
}));

const mintSellerAccessToken = vi.fn();
vi.mock('@amz-spapi/aws-secrets', () => ({
  useSecretsManagerConnection: () => undefined,
  mintSellerAccessToken: (...a: unknown[]) => mintSellerAccessToken(...a),
}));

/** Captures the config, so the absence of seller material is assertable. */
const clientConfigs: Array<Record<string, unknown>> = [];
vi.mock('@farvisionllc/ad-client', () => ({
  AmazonAdsApiClient: class {
    constructor(public config: Record<string, unknown>) {
      clientConfigs.push(config);
    }
  },
}));

const logged: unknown[] = [];
vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info(...a: unknown[]) {
      logged.push(...a);
    }
    warn(...a: unknown[]) {
      logged.push(...a);
    }
    error(...a: unknown[]) {
      logged.push(...a);
    }
  },
}));
const emitted: Array<[string, number]> = [];
vi.mock('@aws-lambda-powertools/metrics', () => ({
  MetricUnit: { Count: 'Count' },
  Metrics: class {
    addMetric(name: string, _unit: string, value: number) {
      emitted.push([name, value]);
    }
    addDimension() {
      return undefined;
    }
    publishStoredMetrics() {
      return undefined;
    }
  },
}));

const { handler } = await import('./main.js');

const PROFILE = {
  user_id: 'auth0|1',
  advertiser_profile_id: '967757046531288',
  seller_id: 'A2HXBWIE3KMLKV',
};

const ITEM = {
  userId: 'auth0|1',
  profileId: '967757046531288',
  sellerId: 'A2HXBWIE3KMLKV',
  kind: 'search-term' as const,
  from: '2026-07-09',
  to: '2026-08-07',
};

beforeEach(() => {
  logged.length = 0;
  emitted.length = 0;
  clientConfigs.length = 0;
  executeQuery.mockReset().mockResolvedValue({ rows: [PROFILE] });
  requestAdsReport.mockReset();
  collectAdsReport.mockReset();
  mintSellerAccessToken.mockReset().mockResolvedValue('Atza|ADS');
});

describe('plan', () => {
  it('ends the window a day back, because yesterday is not final', async () => {
    // Attribution keeps arriving for days. Fetching through today would store a
    // window that is still moving and never revisit it.
    const result = (await handler({
      step: 'plan',
      now: '2026-08-08T05:00:00.000Z',
    })) as { items: Array<{ from: string; to: string }> };

    expect(result.items[0].to).toBe('2026-08-07');
    // 30 days inclusive of the end date.
    expect(result.items[0].from).toBe('2026-07-09');
  });

  it('plans both report kinds per profile', async () => {
    const result = (await handler({
      step: 'plan',
      now: '2026-08-08T05:00:00.000Z',
    })) as { items: Array<{ kind: string }> };

    expect(result.items.map((i) => i.kind).sort()).toEqual([
      'campaign-performance',
      'search-term',
    ]);
  });

  it('skips a profile with no seller id, and says so', async () => {
    // Its rows would have nowhere to go: `collectAdsReport` files them under the
    // seller, because the manual upload path does too.
    executeQuery.mockResolvedValue({
      rows: [{ ...PROFILE, seller_id: undefined }],
    });

    const result = (await handler({ step: 'plan' })) as { items: unknown[] };

    expect(result.items).toEqual([]);
    expect(JSON.stringify(logged)).toContain('no seller id');
  });

  it('publishes the denominator, so zero items is legible', async () => {
    // A run that plans nothing looks identical to a healthy quiet night unless
    // you can see how many profiles it considered.
    await handler({ step: 'plan' });

    expect(emitted).toEqual(
      expect.arrayContaining([
        ['EligibleAdsProfiles', 1],
        ['AdsReportsPlanned', 2],
      ])
    );
  });

  it('asks only for connections that can actually mint', async () => {
    await handler({ step: 'plan' });

    const [, query] = executeQuery.mock.calls[0];
    // `refresh_token` is the pre-#55 plaintext field and matches nothing — the
    // silent-zero that stopped the SP sync for weeks.
    expect(query).not.toMatch(/\brefresh_token\b/);
    expect(query).toContain('encrypted_secrets');
    expect(query).toContain('`deleted` IS MISSING');
    expect(query).toContain("api_type = 'ADS_API'");
  });
});

describe('request', () => {
  it('reports a decline as skipped rather than failed', async () => {
    // Amazon bills for generation. Declining a window we already hold is the
    // saving, not an error.
    requestAdsReport.mockResolvedValue({
      started: false,
      reason: 'Already ingested 2026-07-09..2026-08-07',
    });

    const result = (await handler({ step: 'request', item: ITEM })) as {
      state: string;
      reason: string;
    };

    expect(result.state).toBe('skipped');
    expect(result.reason).toMatch(/Already ingested/);
  });

  it('carries the report id forward, since it is the only handle on paid work', async () => {
    requestAdsReport.mockResolvedValue({
      started: true,
      run: { reportId: 'rep-1' },
    });

    const result = (await handler({ step: 'request', item: ITEM })) as {
      state: string;
      reportId: string;
    };

    expect(result.state).toBe('requested');
    expect(result.reportId).toBe('rep-1');
  });
});

describe('collect', () => {
  it('returns pending rather than throwing, so the machine can Wait', async () => {
    // "Not ready" is the expected answer for most of a report's life.
    collectAdsReport.mockResolvedValue({
      state: 'pending',
      status: 'PROCESSING',
      run: { polls: 3 },
    });

    const result = (await handler({ step: 'collect', item: ITEM })) as {
      state: string;
      polls: number;
    };

    expect(result.state).toBe('pending');
    expect(result.polls).toBe(3);
  });

  it('returns failed rather than throwing, so one profile cannot abandon the rest', async () => {
    collectAdsReport.mockResolvedValue({
      state: 'failed',
      error: 'Date range exceeds retention',
      run: {},
    });

    const result = (await handler({ step: 'collect', item: ITEM })) as {
      state: string;
      error: string;
    };

    expect(result.state).toBe('failed');
    expect(result.error).toMatch(/retention/);
  });

  it('reports rows ingested', async () => {
    collectAdsReport.mockResolvedValue({
      state: 'ingested',
      outcome: { rowsNew: 412, rowsDuplicate: 88 },
      run: {},
    });

    const result = (await handler({ step: 'collect', item: ITEM })) as {
      state: string;
      rowsNew: number;
    };

    expect(result.state).toBe('ingested');
    expect(result.rowsNew).toBe(412);
  });

  it('treats an absent outcome as zero rows, not as an error', async () => {
    // A retried collect of an already-ingested run has no outcome to report —
    // absent means "this call did not ingest", which is not a failure.
    collectAdsReport.mockResolvedValue({ state: 'ingested', run: {} });

    const result = (await handler({ step: 'collect', item: ITEM })) as {
      state: string;
      rowsNew: number;
    };

    expect(result.state).toBe('ingested');
    expect(result.rowsNew).toBe(0);
  });
});

describe('credentials', () => {
  it('holds no seller material — it asks the credential service', async () => {
    collectAdsReport.mockResolvedValue({ state: 'ingested', run: {} });
    await handler({ step: 'collect', item: ITEM });

    const [config] = clientConfigs;
    expect(config['refreshToken']).toBeUndefined();
    expect(config['clientSecret']).toBeUndefined();
    expect(typeof config['mintAccessToken']).toBe('function');
  });

  it('scopes the client to the advertiser profile', async () => {
    // Every Sponsored Products call needs it as the Scope header; without it a
    // client authenticates and then 401s on everything.
    collectAdsReport.mockResolvedValue({ state: 'ingested', run: {} });
    await handler({ step: 'collect', item: ITEM });

    expect(clientConfigs[0]['profileId']).toBe(ITEM.profileId);
  });

  it('mints for ADS_API on behalf of the named user', async () => {
    collectAdsReport.mockResolvedValue({ state: 'ingested', run: {} });
    await handler({ step: 'collect', item: ITEM });

    await (clientConfigs[0]['mintAccessToken'] as () => Promise<string>)();

    expect(mintSellerAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        onBehalfOf: ITEM.userId,
        apiType: 'ADS_API',
        sellerId: ITEM.sellerId,
      })
    );
  });
});
