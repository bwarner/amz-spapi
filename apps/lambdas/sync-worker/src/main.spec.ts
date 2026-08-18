import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Partial batch failure (#36) and the credential wiring (#152).
 *
 * Two contracts. One seller failing must not redeliver the sellers that
 * succeeded — throwing fails the WHOLE batch, so every one of them re-runs
 * against Amazon and spends rate-limit budget redoing completed work, and
 * because their cursors already advanced the repeat is pure waste.
 *
 * The other is that this runtime asks for tokens rather than holding the
 * material to mint them, and asks for the RIGHT seller.
 */

const runJob = vi.fn();

vi.mock('@amz-spapi/sp-sync', () => ({
  SYNC_JOBS: {
    finances: (...args: unknown[]) => runJob(...args),
    settlements: (...args: unknown[]) => runJob(...args),
    'inbound-shipments': (...args: unknown[]) => runJob(...args),
    'inventory-snapshot': (...args: unknown[]) => runJob(...args),
  },
}));

/** Captures the config so the absence of seller material is assertable. */
const clientConfigs: Array<Record<string, unknown>> = [];
vi.mock('@farvisionllc/sp-client', () => ({
  SpApiClient: class {
    constructor(public config: Record<string, unknown>) {
      clientConfigs.push(config);
    }
  },
}));

const mintSellerAccessToken = vi.fn();
vi.mock('@amz-spapi/aws-secrets', () => ({
  useSecretsManagerConnection: () => undefined,
  mintSellerAccessToken: (...args: unknown[]) => mintSellerAccessToken(...args),
}));

const { handler } = await import('./main.js');

function record(id: string, body: Record<string, unknown>) {
  return { messageId: id, body: JSON.stringify(body) };
}

const message = (domain = 'finances', sellerId = 'A1') => ({
  userId: 'auth0|1',
  sellerId,
  marketplaceId: 'ATVPDKIKX0DER',
  profileName: 'sp-ATVPDKIKX0DER-msi1l2wg',
  domain,
});

beforeEach(() => {
  clientConfigs.length = 0;
  mintSellerAccessToken.mockReset().mockResolvedValue('Atza|SELLER');
  runJob
    .mockReset()
    .mockResolvedValue({ recordsWritten: 3, more: false, historyLost: false });
});

describe('batch item failures', () => {
  it('reports an unknown domain rather than throwing the batch away', async () => {
    // An unknown domain can never succeed, so it goes straight to the DLQ where
    // it can be read, instead of exhausting the redrive policy first.
    const result = await handler({
      Records: [record('m1', message('not-a-domain'))],
    });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });

  it('fails only the record that failed', async () => {
    runJob
      .mockResolvedValueOnce({ recordsWritten: 1, more: false })
      .mockRejectedValueOnce(new Error('SP-API 503'));

    const result = await handler({
      Records: [
        record('m1', message('finances', 'A1')),
        record('m2', message('finances', 'A2')),
      ],
    });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm2' }]);
  });

  it('returns a response instead of throwing, whatever happens', async () => {
    // Throwing is what redelivers the batch. The handler must always return the
    // partial-batch shape, even when every record failed.
    runJob.mockRejectedValue(new Error('everything is on fire'));

    await expect(
      handler({ Records: [record('m1', message())] })
    ).resolves.toHaveProperty('batchItemFailures');
  });

  it('treats malformed JSON as one failed record, not a crash', async () => {
    const result = await handler({
      Records: [{ messageId: 'bad', body: 'not json' }],
    });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'bad' }]);
  });

  it('handles an empty batch', async () => {
    const result = await handler({ Records: [] });

    expect(result.batchItemFailures).toEqual([]);
  });
});

describe('credentials', () => {
  it('holds no seller material — it asks instead', async () => {
    // The property #55 exists to establish, asserted rather than assumed. A
    // refresh token or client secret appearing here would mean the plaintext
    // had re-entered a general-purpose runtime.
    await handler({ Records: [record('m1', message())] });

    const [config] = clientConfigs;
    expect(config['refreshToken']).toBeUndefined();
    expect(config['clientSecret']).toBeUndefined();
    expect(config['clientId']).toBeUndefined();
    expect(typeof config['mintAccessToken']).toBe('function');
  });

  it('asks for the seller named on the message', async () => {
    await handler({ Records: [record('m1', message('finances', 'A9'))] });

    // The client only asks when it needs one; nothing has been minted yet.
    expect(mintSellerAccessToken).not.toHaveBeenCalled();

    await (clientConfigs[0]['mintAccessToken'] as () => Promise<string>)();

    expect(mintSellerAccessToken).toHaveBeenCalledWith({
      onBehalfOf: 'auth0|1',
      apiType: 'SP_API',
      profileName: 'sp-ATVPDKIKX0DER-msi1l2wg',
      sellerId: 'A9',
      domain: 'finances',
    });
  });

  it('builds a separate client per message', async () => {
    // One client reused across a batch would carry the first seller's token
    // into the second's sync, which authenticates fine and returns the wrong
    // account's data.
    await handler({
      Records: [
        record('m1', message('finances', 'A1')),
        record('m2', message('finances', 'A2')),
      ],
    });

    expect(clientConfigs).toHaveLength(2);
    expect(clientConfigs[0]['sellerId']).toBe('A1');
    expect(clientConfigs[1]['sellerId']).toBe('A2');
  });

  it('refuses a message with no profileName rather than guessing one', async () => {
    // A profile cannot be inferred: a seller may hold several, and minting from
    // the wrong one files a marketplace's data under another's cursor — which
    // reads as a successful sync.
    const { profileName: _omitted, ...withoutProfile } = message();
    const result = await handler({
      Records: [record('m1', withoutProfile)],
    });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
    expect(runJob).not.toHaveBeenCalled();
  });
});
