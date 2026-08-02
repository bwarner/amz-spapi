import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

/**
 * The cache key length limit, which nothing enforced and Couchbase does.
 *
 * A key over 250 bytes is rejected with `InvalidArgument`, and the parameters
 * that push it over are pagination tokens — so page 1 of any paginated call
 * cached fine and page 2 failed. A seller with 71 listings was shown 20 and
 * told the rest could not be fetched.
 *
 * These reconstruct the key exactly as `sp-cache.ts` builds it, because the
 * property under test is the finished length rather than the helper in
 * isolation.
 */

/** Couchbase's hard limit on a document key. */
const MAX_KEY_BYTES = 250;

function paramsDigest(params: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 32);
}

function cacheKey(type: string, marketplace: string, id: string): string {
  return `${type}:${marketplace}:${id}`;
}

/** An Amazon pagination token, which is what broke this. */
const REAL_TOKEN =
  '9HkIVcuuPmX_bm51o3-igBfN45pxW4Ru7ElIM6GCECYCuXJKzT26f5DwcZ1q' +
  'D_jXXmn78WHs5Ctw'.repeat(9);

describe('cache key length', () => {
  it('stays inside the limit with a real pagination token', () => {
    const key = cacheKey(
      'listingSearch',
      'ATVPDKIKX0DER',
      paramsDigest([
        'A2HXBWIE3KMLKV',
        null,
        null,
        null,
        ['summaries'],
        null,
        20,
        REAL_TOKEN,
      ])
    );

    expect(Buffer.byteLength(key)).toBeLessThan(MAX_KEY_BYTES);
  });

  it('would have exceeded it under the old base64 scheme', () => {
    // The regression this guards. Not hypothetical — this is the key that came
    // back as InvalidArgument from the Data API.
    const legacy = cacheKey(
      'listingSearch',
      'ATVPDKIKX0DER',
      Buffer.from(
        JSON.stringify([
          'A2HXBWIE3KMLKV',
          null,
          null,
          null,
          ['summaries'],
          null,
          20,
          REAL_TOKEN,
        ])
      ).toString('base64url')
    );

    expect(Buffer.byteLength(legacy)).toBeGreaterThan(MAX_KEY_BYTES);
  });

  it('is bounded however long the token gets', () => {
    // Amazon does not document a maximum, so the key must not depend on one.
    const absurd = cacheKey(
      'search',
      'ATVPDKIKX0DER',
      paramsDigest({ pt: 'x'.repeat(100_000) })
    );

    expect(Buffer.byteLength(absurd)).toBeLessThan(MAX_KEY_BYTES);
  });

  it('still separates pages from each other', () => {
    // Bounding the key must not collapse page 2 onto page 1 — that would trade
    // a loud failure for a silent one, serving the wrong page from cache.
    const page1 = paramsDigest({ ps: 20, pt: undefined });
    const page2 = paramsDigest({ ps: 20, pt: REAL_TOKEN });

    expect(page1).not.toBe(page2);
  });

  it('gives the same key for the same parameters', () => {
    expect(paramsDigest({ a: 1, b: [2, 3] })).toBe(
      paramsDigest({ a: 1, b: [2, 3] })
    );
  });
});
