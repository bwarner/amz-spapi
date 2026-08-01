import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectionName,
  deleteDocument,
  executeQuery,
  getDocument,
  incrementCounter,
  insertDocument,
  upsertDocument,
} from './couchbase-utils.js';

/**
 * Contract tests for the Couchbase Data API.
 *
 * These are not unit tests. Every assertion here is a claim about someone
 * else's HTTP service, and each one was initially assumed wrong — a stale CAS
 * answers 409 rather than the RFC's 412, `If-None-Match: *` is not create-only,
 * the counter endpoint ignores `delta` when it creates the document, and an
 * expiry over 30 days is a Go duration string rather than a seconds count. The
 * helpers in this package are shaped around those four answers, so nothing
 * mockable can defend them; only the live service can.
 *
 * Running them:
 *
 *   set -a && . apps/web/.env.local && set +a && npx nx test couchbase-utils
 *
 * Without CB_DATA_API_URL / CB_USERNAME / CB_PASSWORD / CB_BUCKET the suite
 * skips rather than fails, so `nx affected -t test` stays green in CI, where no
 * cluster credentials are present. A skipped suite proves nothing — when you
 * change this package, run it against a real cluster.
 *
 * The suite provisions its own collections (`itest_*`, override the prefix with
 * CB_TEST_DOMAIN) inside the environment scope, and deletes every key it
 * writes. It never touches an application collection: the cost ledger is an
 * auditable record and test rows have no business in it.
 */

const REQUIRED_ENV = [
  'CB_DATA_API_URL',
  'CB_USERNAME',
  'CB_PASSWORD',
  'CB_BUCKET',
  // The package refuses to build a config without it, so a suite that omitted
  // it would fail inside the first helper rather than skip.
  'CB_SCOPE',
] as const;

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
const configured = missingEnv.length === 0;

/**
 * The test domain — a name prefix, not a scope (ADR-0005).
 *
 * There is one scope per environment and collections are flat inside it, so
 * isolation from application data is the `itest_` prefix rather than a scope of
 * its own. The suite used to create a scope called `itest`, which no longer
 * matched where either the KV helpers or the query context actually looked.
 */
const DOMAIN = process.env['CB_TEST_DOMAIN'] || 'itest';
const DOCS = 'docs';
/** Deliberately a N1QL reserved word — that is the behaviour it pins. */
const ROWS = 'rows';

/** What the collections are really called: `itest_docs`, `itest_rows`. */
const DOCS_COLLECTION = collectionName(DOMAIN, DOCS);
const ROWS_COLLECTION = collectionName(DOMAIN, ROWS);

const DAY_SECONDS = 24 * 60 * 60;

const suiteName = configured
  ? 'Couchbase Data API contracts'
  : `Couchbase Data API contracts [skipped: set ${missingEnv.join(', ')}]`;

type DataApiConfig = {
  baseUrl: string;
  auth: string;
  bucket: string;
  environmentScope: string;
};

function config(): DataApiConfig {
  return {
    baseUrl: (process.env['CB_DATA_API_URL'] ?? '').replace(/\/+$/, ''),
    auth: `Basic ${Buffer.from(
      `${process.env['CB_USERNAME']}:${process.env['CB_PASSWORD']}`
    ).toString('base64')}`,
    bucket: process.env['CB_BUCKET'] ?? '',
    // The same scope the package uses. The raw requests below must address
    // exactly what the helpers address, or a test that writes raw and reads
    // through the helper is comparing two different documents.
    environmentScope: process.env['CB_SCOPE'] ?? '',
  };
}

/**
 * Raw KV requests, because the assertions below are about headers the package
 * deliberately does not expose — ETag, If-Match, If-None-Match, Expires. The
 * package's own helpers are exercised alongside them, so each trap is pinned
 * both at the wire and at the surface that has to survive it.
 */
function documentUrl(collection: string, key: string): string {
  const { baseUrl, bucket, environmentScope } = config();
  return (
    `${baseUrl}/v1/buckets/${encodeURIComponent(bucket)}` +
    `/scopes/${encodeURIComponent(environmentScope)}` +
    `/collections/${encodeURIComponent(collection)}` +
    `/documents/${encodeURIComponent(key)}`
  );
}

function rawGet(key: string): Promise<Response> {
  return fetch(documentUrl(DOCS_COLLECTION, key), {
    headers: { Authorization: config().auth, Accept: 'application/json' },
  });
}

function rawWrite(
  method: 'PUT' | 'POST',
  key: string,
  document: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(documentUrl(DOCS_COLLECTION, key), {
    method,
    headers: {
      Authorization: config().auth,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(document),
  });
}

function rawIncrement(
  key: string,
  body: { initial?: number; delta?: number }
): Promise<Response> {
  return fetch(`${documentUrl(DOCS_COLLECTION, key)}/increment`, {
    method: 'POST',
    headers: {
      Authorization: config().auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** One run's keys, all prefixed so a crashed run is identifiable and sweepable. */
const runId = randomUUID().slice(0, 8);
const writtenKeys = new Set<string>();

function testKey(name: string): string {
  const key = `itest:${runId}:${name}`;
  writtenKeys.add(key);
  return key;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe.skipIf(!configured)(suiteName, () => {
  beforeAll(async () => {
    const { bucket, environmentScope } = config();
    const quoted = (name: string) => `\`${name.replace(/`/g, '``')}\``;

    // Into the environment scope, which already exists. The suite no longer
    // creates a scope of its own: there is one scope per environment and
    // `itest` is a name prefix inside it (ADR-0005). Creating `itest` as a
    // scope put these collections somewhere neither the KV helpers nor the
    // query context ever looked.
    for (const collection of [DOCS_COLLECTION, ROWS_COLLECTION]) {
      await executeQuery(
        DOMAIN,
        `CREATE COLLECTION ${quoted(bucket)}.${quoted(
          environmentScope
        )}.${quoted(collection)} IF NOT EXISTS`
      );
    }

    // A new collection is not queryable the instant DDL returns. USE KEYS makes
    // the probe a direct KV fetch, so readiness is all it measures — no primary
    // index required, and none of these collections has one.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await executeQuery(
          DOMAIN,
          `SELECT RAW 1 FROM ${quoted(
            ROWS_COLLECTION
          )} USE KEYS "readiness-probe"`
        );
        return;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }, 60_000);

  afterAll(async () => {
    await Promise.all(
      [...writtenKeys].map((key) =>
        deleteDocument(DOMAIN, DOCS, key).catch(() => false)
      )
    );
  }, 60_000);

  describe('CAS through ETag', () => {
    it('carries the CAS on an unquoted ETag, and rejects a stale If-Match with 409 — not the RFC 412', async () => {
      const key = testKey('cas');

      const created = await rawWrite('PUT', key, { v: 1 });
      expect(created.status).toBe(200);
      const staleEtag = created.headers.get('etag');
      expect(staleEtag).toMatch(/^[0-9a-f]{16}$/);

      // A GET is how a caller learns the CAS it must echo back.
      const read = await rawGet(key);
      expect(read.status).toBe(200);
      expect(read.headers.get('etag')).toBe(staleEtag);

      const updated = await rawWrite('PUT', key, { v: 2 });
      const currentEtag = updated.headers.get('etag');
      expect(currentEtag).not.toBe(staleEtag);

      const conflict = await rawWrite(
        'PUT',
        key,
        { v: 3 },
        {
          'If-Match': staleEtag as string,
        }
      );
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: 'CasMismatch' });

      const accepted = await rawWrite(
        'PUT',
        key,
        { v: 4 },
        {
          'If-Match': currentEtag as string,
        }
      );
      expect(accepted.status).toBe(200);
      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({ v: 4 });
    });

    it('treats an RFC-style quoted ETag as malformed (400), so the CAS must be echoed verbatim', async () => {
      const key = testKey('cas-quoted');
      const created = await rawWrite('PUT', key, { v: 1 });
      const etag = created.headers.get('etag') as string;

      // Wrapping the value in quotes is what the ETag spec suggests, and it is
      // a 400 here — a caller that "fixes" the format loses CAS entirely, and
      // gets an argument error rather than the conflict it was guarding against.
      const quoted = await rawWrite(
        'PUT',
        key,
        { v: 2 },
        {
          'If-Match': `"${etag}"`,
        }
      );
      expect(quoted.status).toBe(400);
      expect(await quoted.json()).toMatchObject({ code: 'InvalidArgument' });
    });

    it('answers a stale If-Match on DELETE with 409 as well', async () => {
      const key = testKey('cas-delete');
      const created = await rawWrite('PUT', key, { v: 1 });
      const staleEtag = created.headers.get('etag') as string;
      await rawWrite('PUT', key, { v: 2 });

      const conflict = await fetch(documentUrl(DOCS_COLLECTION, key), {
        method: 'DELETE',
        headers: { Authorization: config().auth, 'If-Match': staleEtag },
      });
      expect(conflict.status).toBe(409);
      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({ v: 2 });
    });
  });

  describe('create-only semantics', () => {
    it('does NOT honour If-None-Match: * as create-only — it returns 200 and overwrites', async () => {
      const key = testKey('if-none-match');
      await rawWrite('PUT', key, { v: 'original' });

      const overwrite = await rawWrite(
        'PUT',
        key,
        { v: 'overwritten' },
        {
          'If-None-Match': '*',
        }
      );

      // The header is accepted and ignored. Used as insert-if-absent it is a
      // silent lost update, which is why POST is the create-only verb below.
      expect(overwrite.status).toBe(200);
      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({
        v: 'overwritten',
      });
    });

    it('creates with POST and answers 409 DocumentExists on a second POST', async () => {
      const key = testKey('post-create-only');

      const first = await rawWrite('POST', key, { v: 'first' });
      expect(first.status).toBe(200);

      const second = await rawWrite('POST', key, { v: 'second' });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: 'DocumentExists' });
      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({ v: 'first' });
    });

    it('reports the loser of an insert race as false through insertDocument', async () => {
      const key = testKey('insert-race');

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          insertDocument(DOMAIN, DOCS, key, { winner: index })
        )
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({
        winner: results.indexOf(true),
      });
    });

    it('reads a missing document as null rather than throwing', async () => {
      expect(await getDocument(DOMAIN, DOCS, testKey('absent'))).toBeNull();
    });
  });

  describe('counter creation', () => {
    it('stores `initial` and IGNORES `delta` on creation, so initial: 0 silently drops the first increment', async () => {
      const key = testKey('counter-initial-zero');

      const created = await rawIncrement(key, { initial: 0, delta: 5 });
      expect(created.status).toBe(200);
      // The delta is gone. For a daily spend counter this makes the first paid
      // call of each UTC day free — cap evasion, not rounding.
      expect(Number(await created.text())).toBe(0);

      const second = await rawIncrement(key, { initial: 0, delta: 5 });
      expect(Number(await second.text())).toBe(5);
    });

    it('does not create the counter at all when `initial` is omitted', async () => {
      const absent = await rawIncrement(testKey('counter-no-initial'), {
        delta: 5,
      });
      expect(absent.status).toBe(404);
      expect(await absent.json()).toMatchObject({ code: 'DocumentNotFound' });
    });

    it('counts the first increment because incrementCounter sends initial = delta', async () => {
      const key = testKey('counter-lib');

      expect(await incrementCounter(DOMAIN, DOCS, key, 7)).toBe(7);
      expect(await incrementCounter(DOMAIN, DOCS, key, 7)).toBe(14);
    });

    it('increments atomically once the counter exists, so concurrent callers cannot lose a unit', async () => {
      const key = testKey('counter-atomic');
      await incrementCounter(DOMAIN, DOCS, key, 1);

      await Promise.all(
        Array.from({ length: 10 }, () => incrementCounter(DOMAIN, DOCS, key, 1))
      );

      expect(await getDocument<number>(DOMAIN, DOCS, key)).toBe(11);
    });
  });

  describe('expiry', () => {
    it('takes a Go duration string on Expires and rejects a bare seconds count', async () => {
      const duration = await rawWrite(
        'PUT',
        testKey('ttl-duration'),
        { v: 1 },
        {
          Expires: '60s',
        }
      );
      expect(duration.status).toBe(200);

      // The bare number is what the KV protocol takes. Here it is an argument
      // error, which is the good outcome — a rejected write is visible, and the
      // hand-rolled 30-day conversion it replaced was not.
      const bare = await rawWrite(
        'PUT',
        testKey('ttl-bare'),
        { v: 1 },
        {
          Expires: '60',
        }
      );
      expect(bare.status).toBe(400);
      expect(await bare.json()).toMatchObject({ code: 'InvalidArgument' });
    });

    it('keeps a 180-day TTL 180 days in the future instead of wrapping it into 1970', async () => {
      const key = testKey('ttl-180d');
      const expirySeconds = 180 * DAY_SECONDS;

      await upsertDocument(
        DOMAIN,
        DOCS,
        key,
        { v: 'long-lived' },
        expirySeconds
      );

      const before = nowSeconds();
      const { rows } = await executeQuery<{ expiration: number }>(
        DOMAIN,
        `SELECT META(d).expiration AS expiration FROM ${DOCS_COLLECTION} AS d USE KEYS $key`,
        { parameters: { key } }
      );

      expect(rows).toHaveLength(1);
      // The regression this guards: a value past the 30-day threshold read as an
      // absolute Unix timestamp, expiring the document at epoch.
      expect(rows[0].expiration).toBeGreaterThan(before);
      expect(rows[0].expiration).toBeGreaterThanOrEqual(
        before + expirySeconds - 120
      );
      expect(rows[0].expiration).toBeLessThanOrEqual(
        before + expirySeconds + 120
      );
      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({ v: 'long-lived' });
    });

    it('leaves a document with no expiry when no TTL is given', async () => {
      const key = testKey('ttl-none');
      await upsertDocument(DOMAIN, DOCS, key, { v: 'permanent' });

      const { rows } = await executeQuery<{ expiration: number }>(
        DOMAIN,
        `SELECT META(d).expiration AS expiration FROM ${DOCS_COLLECTION} AS d USE KEYS $key`,
        { parameters: { key } }
      );

      expect(rows[0].expiration).toBe(0);
    });
  });

  describe('N1QL through the query endpoint', () => {
    it('runs a mutation inside an implicit transaction with tximplicit', async () => {
      const key = testKey('tximplicit');

      await executeQuery(
        DOMAIN,
        `UPSERT INTO ${DOCS_COLLECTION} (KEY, VALUE) VALUES ($key, {"v": "tximplicit"})`,
        { parameters: { key }, tximplicit: true }
      );

      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({
        v: 'tximplicit',
      });
    });

    it('threads an explicit transaction through the txid from BEGIN WORK to COMMIT', async () => {
      const key = testKey('txn-commit');

      const begin = await executeQuery<{ txid?: string }>(DOMAIN, 'BEGIN WORK');
      const txid = begin.rows[0]?.txid;
      expect(txid).toMatch(/^[0-9a-f-]{36}$/);

      await executeQuery(
        DOMAIN,
        `UPSERT INTO ${DOCS_COLLECTION} (KEY, VALUE) VALUES ($key, {"v": "committed"})`,
        { parameters: { key }, txid }
      );
      await executeQuery(DOMAIN, 'COMMIT WORK', { txid });

      expect(await getDocument(DOMAIN, DOCS, key)).toEqual({ v: 'committed' });
    });

    it('discards a rolled-back transaction, leaving the document absent', async () => {
      const key = testKey('txn-rollback');

      const begin = await executeQuery<{ txid?: string }>(DOMAIN, 'BEGIN WORK');
      const txid = begin.rows[0]?.txid;

      await executeQuery(
        DOMAIN,
        `UPSERT INTO ${DOCS_COLLECTION} (KEY, VALUE) VALUES ($key, {"v": "rolled-back"})`,
        { parameters: { key }, txid }
      );
      await executeQuery(DOMAIN, 'ROLLBACK WORK', { txid });

      expect(await getDocument(DOMAIN, DOCS, key)).toBeNull();
    });

    it('needs backticks around a reserved word used as a keyspace', async () => {
      // Found twice, one runtime error at a time: `rows` and `options` are
      // reserved, and an unbackticked keyspace fails at parse time — before the
      // keyspace is resolved, so this holds whether or not one exists.
      await expect(
        executeQuery(DOMAIN, 'SELECT RAW 1 FROM rows USE KEYS "any"')
      ).rejects.toThrow(/reserved word/i);

      // And the reason the flat name retires the problem (ADR-0005): the real
      // collection is `itest_rows`, which is not reserved and needs no
      // backticks. That is the whole benefit of the prefix, so pin it.
      const { rows } = await executeQuery(
        DOMAIN,
        `SELECT RAW 1 FROM ${ROWS_COLLECTION} USE KEYS "any"`
      );
      expect(rows).toEqual([]);
    });

    it('surfaces a query-service error as a thrown Error rather than an empty result set', async () => {
      await expect(
        executeQuery(
          DOMAIN,
          'SELECT RAW 1 FROM `no_such_collection` USE KEYS "any"'
        )
      ).rejects.toThrow();
    });
  });
});
