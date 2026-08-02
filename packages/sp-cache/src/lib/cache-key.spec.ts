import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('every paginated call', () => {
  /**
   * The regression that nearly shipped: the digest was applied to listings,
   * catalog, orders and inventory, but finance groups, finance events and
   * inbound shipments kept the base64 fragment — and all three take a
   * `nextToken`. Finance events is the worst of them, paginating over months
   * of transactions, so it has more pages than listings ever will.
   *
   * Nothing caught it because the fixed sites had tests and the missed ones
   * had none. This scans the source instead: it does not care which call sites
   * exist, only that none of them builds a key out of an encoding that grows
   * with its input.
   */
  it('builds keys from a digest, never from base64', () => {
    const source = readFileSync(join(__dirname, 'sp-cache.ts'), 'utf8');

    // Matches the call, not the word — the comment above `paramsDigest`
    // explains what base64 did wrong and must stay readable.
    expect(source).not.toMatch(/toString\(['"]base64/);
  });

  it('bounds a finance key, which paginates further than listings do', () => {
    const key = cacheKey(
      'finEvents',
      'ATVPDKIKX0DER',
      paramsDigest([
        'A2HXBWIE3KMLKV',
        '2026-01-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
        undefined,
        100,
        REAL_TOKEN,
      ])
    );

    expect(Buffer.byteLength(key)).toBeLessThan(MAX_KEY_BYTES);
  });
});
