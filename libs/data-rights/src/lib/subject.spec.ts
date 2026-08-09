import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Export and erasure.
 *
 * These are the two operations in the system with no undo and a legal
 * consequence for getting them wrong, in opposite directions: an export that
 * misses data is an incomplete Art. 15 response, and a purge that over-reaches
 * destroys somebody else's records while answering someone's Art. 17 request.
 *
 * The cases below are chosen for the second kind of failure, because it is the
 * one that cannot be apologised for afterwards.
 */

const executeQuery = vi.fn();
const getDocument = vi.fn();
const deleteDocument = vi.fn();

vi.mock('@amz-spapi/couchbase-utils', () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  getDocument: (...a: unknown[]) => getDocument(...a),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
  collectionName: (d: string, c: string) => `${d}_${c}`,
}));

const { exportUserData, purgeUserData, resolveSellerIds, subjectHash } =
  await import('./subject.js');

const USER = 'auth0|subject';
const OTHER = 'auth0|somebody-else';

/** Statements are dispatched on shape, so a test can answer each one. */
function respond(handler: (sql: string, params: unknown) => unknown[]) {
  executeQuery.mockImplementation(
    async (_domain: string, sql: string, opts?: { parameters?: unknown }) => ({
      rows: handler(sql.replace(/\s+/g, ' ').trim(), opts?.parameters),
    })
  );
}

const noObjects = {
  deleteObjects: vi.fn(async () => ({ deleted: 0, failed: [] })),
};

beforeEach(() => {
  vi.resetAllMocks();
  getDocument.mockResolvedValue(null);
  // The real one returns a promise, and the caller attaches `.catch`.
  deleteDocument.mockResolvedValue(undefined);
  noObjects.deleteObjects.mockResolvedValue({ deleted: 0, failed: [] });
});

describe('resolveSellerIds', () => {
  it('marks a seller account held by one user as exclusive', async () => {
    respond(() => [{ sellerId: 'A1', userId: USER }]);

    expect(await resolveSellerIds(USER)).toEqual([
      { sellerId: 'A1', heldBy: [USER], exclusive: true },
    ]);
  });

  it('marks a seller account held by two users as NOT exclusive', async () => {
    // The agency case: an owner and the contractor they hired both hold
    // credentials for the same Amazon account.
    respond(() => [
      { sellerId: 'A1', userId: USER },
      { sellerId: 'A1', userId: OTHER },
    ]);

    const [link] = await resolveSellerIds(USER);

    expect(link.exclusive).toBe(false);
    expect(link.heldBy).toEqual(expect.arrayContaining([USER, OTHER]));
  });

  it('ignores seller accounts the subject does not hold', async () => {
    respond(() => [{ sellerId: 'A2', userId: OTHER }]);

    expect(await resolveSellerIds(USER)).toEqual([]);
  });
});

describe('purgeUserData', () => {
  it('defaults to a dry run', async () => {
    respond((sql) => (sql.startsWith('SELECT RAW COUNT') ? [3] : []));

    const plan = await purgeUserData({ userId: USER, objectStore: noObjects });

    expect(plan.dryRun).toBe(true);
    // Nothing destructive may be issued without asking for it. A tool that
    // deletes twenty collections by default is one mistyped flag from an
    // unrecoverable afternoon.
    const statements = executeQuery.mock.calls.map((c) => String(c[1]));
    expect(statements.some((s) => /DELETE FROM/i.test(s))).toBe(false);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  /**
   * The one that would be a data-protection incident.
   */
  it('never deletes report data for a seller account someone else also holds', async () => {
    respond((sql) => {
      if (sql.includes('credentials_profiles')) {
        return [
          { sellerId: 'A1', userId: USER },
          { sellerId: 'A1', userId: OTHER },
        ];
      }
      return sql.startsWith('SELECT RAW COUNT') ? [999] : [];
    });

    const plan = await purgeUserData({
      userId: USER,
      objectStore: noObjects,
      dryRun: false,
    });

    const deletes = executeQuery.mock.calls
      .map((c) => String(c[1]).replace(/\s+/g, ' '))
      .filter((s) => /DELETE FROM/i.test(s));

    // Their own records still go; the shared seller's trading data does not.
    expect(deletes.some((s) => s.includes('chat_messages'))).toBe(true);
    expect(deletes.some((s) => s.includes('reports_rows'))).toBe(false);
    expect(plan.retainedForSharedSellers).toEqual([
      { sellerId: 'A1', heldBy: [USER, OTHER], exclusive: false },
    ]);
    // Reported, not silently skipped — whoever answers the request has to know
    // the erasure was partial and why.
    expect(plan.skippedCollections).toContain('reports_rows');
  });

  it('does delete report data for a seller account held only by them', async () => {
    respond((sql) => {
      if (sql.includes('credentials_profiles'))
        return [{ sellerId: 'A1', userId: USER }];
      return [];
    });

    await purgeUserData({
      userId: USER,
      objectStore: noObjects,
      dryRun: false,
    });

    const deletes = executeQuery.mock.calls
      .map((c) => String(c[1]).replace(/\s+/g, ' '))
      .filter((s) => /DELETE FROM/i.test(s));

    expect(deletes.some((s) => s.includes('reports_rows'))).toBe(true);
  });

  it('resolves seller ids BEFORE sweeping the collection that links them', async () => {
    const order: string[] = [];
    executeQuery.mockImplementation(async (_d: string, sql: string) => {
      const flat = sql.replace(/\s+/g, ' ');
      if (flat.includes('credentials_profiles')) {
        order.push(/DELETE/i.test(flat) ? 'delete-profiles' : 'read-profiles');
      }
      return { rows: [] };
    });

    await purgeUserData({
      userId: USER,
      objectStore: noObjects,
      dryRun: false,
    });

    // Deleting credentials first would strip the only userId → sellerId link,
    // leaving the report data unattributable and therefore permanently
    // undeletable. Silent, and irreversible.
    expect(order.indexOf('read-profiles')).toBeLessThan(
      order.indexOf('delete-profiles')
    );
  });

  it('deletes the S3 objects, not just the rows that point at them', async () => {
    const storage = { bucket: 'media', key: 'users/abc/assets/one.jpg' };
    respond((sql) =>
      sql.includes('media_assets') && sql.startsWith('SELECT d.*')
        ? [{ userId: USER, storage }]
        : []
    );
    const store = {
      deleteObjects: vi.fn(async () => ({ deleted: 1, failed: [] })),
    };

    const plan = await purgeUserData({
      userId: USER,
      objectStore: store,
      dryRun: false,
    });

    // Dropping the metadata and leaving the image is the most plausible way to
    // ship a deletion that reports success and erases nothing.
    expect(store.deleteObjects).toHaveBeenCalledWith([storage]);
    expect(plan.objectsDeleted).toBe(1);
  });

  it('reports objects it could not delete rather than claiming success', async () => {
    const storage = { bucket: 'media', key: 'users/abc/assets/one.jpg' };
    respond((sql) =>
      sql.includes('media_assets') && sql.startsWith('SELECT d.*')
        ? [{ userId: USER, storage }]
        : []
    );

    const plan = await purgeUserData({
      userId: USER,
      dryRun: false,
      objectStore: {
        deleteObjects: async () => ({ deleted: 0, failed: [storage] }),
      },
    });

    expect(plan.objectsFailed).toEqual([storage]);
  });

  it('finds and removes the spend counters no query can reach', async () => {
    respond(() => []);
    // Present on exactly one of the ~45 candidate days.
    const hit = `spend::${subjectHash(USER)}::2026-08-08`;
    getDocument.mockImplementation(async (_d, _c, key: string) =>
      key === hit ? 42 : null
    );

    const plan = await purgeUserData({
      userId: USER,
      objectStore: noObjects,
      dryRun: false,
      now: Date.parse('2026-08-08T12:00:00Z'),
    });

    expect(deleteDocument).toHaveBeenCalledWith('ops', 'spend_counters', hit);
    expect(plan.deleted['ops_spend_counters']).toBe(1);
  });
});

describe('exportUserData', () => {
  it('redacts the stored Amazon credential', async () => {
    respond((sql) =>
      sql.includes('credentials_profiles') && sql.startsWith('SELECT d.*')
        ? [{ user_id: USER, encrypted_secrets: 'KMS-WRAPPED-REFRESH-TOKEN' }]
        : []
    );

    const result = await exportUserData({ userId: USER });

    // An export travels by email and lands in a downloads folder. Handing back
    // a live credential there strips every protection the running system gives
    // it, and answering an access request must not create a disclosure.
    expect(JSON.stringify(result)).not.toContain('KMS-WRAPPED-REFRESH-TOKEN');
    expect(
      (result.records['credentials_profiles'][0] as Record<string, unknown>)[
        'encrypted_secrets'
      ]
    ).toBe('[redacted — credential]');
  });

  it('exports trading data even for a SHARED seller account', async () => {
    // The mirror of the purge rule, and deliberately the opposite answer.
    // Exclusivity limits what may be destroyed; it must not limit what someone
    // can see about themselves.
    respond((sql) => {
      if (sql.includes('credentials_profiles') && sql.includes('seller_id')) {
        return [
          { sellerId: 'A1', userId: USER },
          { sellerId: 'A1', userId: OTHER },
        ];
      }
      return sql.includes('reports_rows') ? [{ sellerId: 'A1', qty: 1 }] : [];
    });

    const result = await exportUserData({ userId: USER });

    expect(result.records['reports_rows']).toHaveLength(1);
    expect(result.sellerAccounts[0].exclusive).toBe(false);
  });

  it('records what was excluded and why', async () => {
    respond(() => []);

    const result = await exportUserData({ userId: USER });

    // A subject is entitled to know the scope of the answer, and a reviewer
    // needs to see the exclusions were reasoned rather than forgotten.
    const cache = result.excluded.find(
      (e) => e.collection === 'sp_cache_catalog'
    );
    expect(cache?.because).toMatch(/Amazon/i);
  });

  it('lists object references without inlining the bytes', async () => {
    const storage = { bucket: 'media', key: 'users/abc/assets/one.jpg' };
    respond((sql) =>
      sql.includes('media_assets') && sql.startsWith('SELECT d.*')
        ? [{ userId: USER, storage }]
        : []
    );

    const result = await exportUserData({ userId: USER });

    // A JSON file with 380 base64 images in it is not "commonly used" in the
    // Art. 20 sense, and would be unusable at any real account size.
    expect(result.objects).toEqual([storage]);
  });
});
