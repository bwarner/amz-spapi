import { describe, expect, it, vi } from 'vitest';

/**
 * Partial batch failure (#36).
 *
 * The contract that matters: one seller failing must not redeliver the sellers
 * that succeeded. Throwing fails the WHOLE batch, so every one of them re-runs
 * against Amazon and spends rate-limit budget redoing completed work — and
 * because their cursors already advanced, the repeat is pure waste.
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

vi.mock('@farvisionllc/sp-client', () => ({
  SpApiClient: class {
    constructor(public config: unknown) {}
  },
}));

const { handler } = await import('./main.js');

function record(id: string, body: Record<string, unknown>) {
  return { messageId: id, body: JSON.stringify(body) };
}

const message = (domain = 'finances', sellerId = 'A1') => ({
  userId: 'auth0|1',
  sellerId,
  marketplaceId: 'ATVPDKIKX0DER',
  domain,
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
    // Every message fails here for the same reason — the worker has no
    // credential source yet — so the assertion is about the SHAPE: each id is
    // reported individually rather than the handler throwing.
    const result = await handler({
      Records: [
        record('m1', message('finances', 'A1')),
        record('m2', message('finances', 'A2')),
      ],
    });

    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('returns a response instead of throwing, whatever happens', async () => {
    // Throwing is what redelivers the batch. The handler must always return the
    // partial-batch shape, even when every record failed.
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
