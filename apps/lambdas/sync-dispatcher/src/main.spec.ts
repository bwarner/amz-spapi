import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Fan-out (#36).
 *
 * Two properties decide whether a scheduled run is safe to repeat: the message
 * group, which is the only thing pacing a seller against SP-API rate limits,
 * and the deduplication id, which is what stops a retried dispatcher from
 * enqueuing every seller twice.
 */

const sent: Array<Record<string, unknown>> = [];
const executeQuery = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    async send(command: { input: Record<string, unknown> }) {
      sent.push(command.input);
      return {};
    }
  },
  SendMessageBatchCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock('@amz-spapi/couchbase-utils', () => ({
  executeQuery: (domain: string, query: string, options?: unknown) =>
    executeQuery(domain, query, options),
  // `main.ts` registers a credentials provider at module scope.
  setConnectionProvider: () => undefined,
}));

process.env['SYNC_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/1/q.fifo';
const { handler } = await import('./main.js');

type Entry = {
  MessageBody: string;
  MessageGroupId: string;
  MessageDeduplicationId: string;
};

const entries = () =>
  sent.flatMap((input) => (input['Entries'] as Entry[]) ?? []);

beforeEach(() => {
  sent.length = 0;
  executeQuery.mockReset();
});

function withSellers(
  sellers: Array<{
    user_id: string;
    seller_id: string;
    marketplace_id: string;
    profile_name?: string;
  }>,
  shed: Array<{ sellerId: string; domain: string }> = []
) {
  executeQuery.mockImplementation(async (domain: string) =>
    domain === 'credentials' ? { rows: sellers } : { rows: shed }
  );
}

const SELLER = {
  user_id: 'auth0|1',
  seller_id: 'A2HXBWIE3KMLKV',
  marketplace_id: 'ATVPDKIKX0DER',
  profile_name: 'sp-ATVPDKIKX0DER-msi1l2wg',
};

/**
 * What the eligibility query asks for (#152).
 *
 * These assert on the SQL text, which is unusual and is the point: everything
 * else in this file mocks `executeQuery`, so a query that matches nothing in the
 * real database passes every other test here while the nightly run enqueues zero
 * messages and reports success. That is exactly what happened — the query still
 * filtered on the pre-#55 plaintext `refresh_token`, which no document has
 * carried since the credentials moved to KMS ciphertext.
 */
describe('eligibility', () => {
  const eligibilityQuery = () =>
    (executeQuery.mock.calls.find(
      (call) => call[0] === 'credentials'
    )?.[1] as string) ?? '';

  it('does not filter on the plaintext refresh token, which no longer exists', async () => {
    withSellers([SELLER]);
    await handler();

    expect(eligibilityQuery()).not.toMatch(/\brefresh_token\b/);
  });

  it('filters on the encrypted material instead', async () => {
    withSellers([SELLER]);
    await handler();

    const query = eligibilityQuery();
    expect(query).toContain('encrypted_secrets');
    // An explicit `false` is excluded; absent is not, because a pre-#55
    // document carries no flag and dropping it would silently skip a working
    // connection.
    expect(query).toContain('has_refresh_token');
  });

  it('excludes disconnected profiles', async () => {
    withSellers([SELLER]);
    await handler();

    expect(eligibilityQuery()).toContain('`deleted` IS MISSING');
  });

  it('asks for one row per seller, since the cursor cannot separate marketplaces', async () => {
    // `cursorKey` is user::seller::domain. Two messages for one seller would
    // share a cursor and each advance it past the other's unsynced windows.
    withSellers([SELLER]);
    await handler();

    expect(eligibilityQuery()).toContain('GROUP BY user_id, seller_id');
  });

  it('carries the profile name to the worker', async () => {
    // Part of the credential document key. Without it the worker cannot say
    // which connection to mint from, and must refuse rather than guess.
    withSellers([SELLER]);
    await handler();

    for (const entry of entries()) {
      const body = JSON.parse(entry.MessageBody) as { profileName: string };
      expect(body.profileName).toBe(SELLER.profile_name);
    }
  });
});

describe('fan-out', () => {
  it('enqueues every domain for every seller', async () => {
    withSellers([SELLER]);

    const result = await handler();

    expect(result.enqueued).toBe(4);
    expect(entries()).toHaveLength(4);
  });

  it('groups by SELLER, not by seller and domain', async () => {
    // The pacing mechanism. SP-API limits are per account, so one seller's four
    // domains must serialise; grouping per domain would run all four at once and
    // throttle the account.
    withSellers([SELLER]);

    await handler();

    const groups = new Set(entries().map((e) => e.MessageGroupId));
    expect(groups).toEqual(new Set([SELLER.seller_id]));
  });

  it('lets different sellers proceed in parallel', async () => {
    withSellers([SELLER, { ...SELLER, seller_id: 'A2' }]);

    await handler();

    expect(new Set(entries().map((e) => e.MessageGroupId)).size).toBe(2);
  });

  it('gives each seller x domain a distinct deduplication id', async () => {
    // Same id across domains would have SQS drop three of the four as
    // duplicates, and the seller would only ever sync finances.
    withSellers([SELLER]);

    await handler();

    const ids = entries().map((e) => e.MessageDeduplicationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the run stamp in the id so the NEXT run is not deduplicated', async () => {
    // Deduplication is scoped to a five minute window. An id without the run
    // timestamp would make two runs inside that window collapse into one.
    withSellers([SELLER]);

    await handler();

    for (const entry of entries()) {
      const body = JSON.parse(entry.MessageBody) as { dispatchedAt: string };
      expect(entry.MessageDeduplicationId).toContain(body.dispatchedAt);
    }
  });
});

describe('shedding', () => {
  it('skips a seller x domain that keeps failing', async () => {
    // A revoked authorization otherwise burns a message per domain per run
    // forever, and fills the DLQ with the same failure instead of anything
    // worth reading.
    withSellers([SELLER], [{ sellerId: SELLER.seller_id, domain: 'finances' }]);

    const result = await handler();

    expect(result.enqueued).toBe(3);
    expect(result.shed).toBe(1);
    const domains = entries().map(
      (e) => (JSON.parse(e.MessageBody) as { domain: string }).domain
    );
    expect(domains).not.toContain('finances');
  });

  it('sheds only the failing domain, not the seller', async () => {
    // A seller whose finances are broken can still have their inventory
    // snapshotted, and that snapshot is unrecoverable if skipped.
    withSellers([SELLER], [{ sellerId: SELLER.seller_id, domain: 'finances' }]);

    await handler();

    const domains = entries().map(
      (e) => (JSON.parse(e.MessageBody) as { domain: string }).domain
    );
    expect(domains).toContain('inventory-snapshot');
  });
});

describe('batching', () => {
  it('splits into batches of ten, which is the SQS limit', async () => {
    // 4 sellers x 4 domains = 16 messages, so two batches.
    withSellers(
      Array.from({ length: 4 }, (_, i) => ({ ...SELLER, seller_id: `S${i}` }))
    );

    const result = await handler();

    expect(result.enqueued).toBe(16);
    expect(sent).toHaveLength(2);
    for (const input of sent) {
      expect((input['Entries'] as Entry[]).length).toBeLessThanOrEqual(10);
    }
  });

  it('sends nothing when no seller is eligible', async () => {
    withSellers([]);

    const result = await handler();

    expect(result.enqueued).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
