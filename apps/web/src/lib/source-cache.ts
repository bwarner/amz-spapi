import crypto from 'node:crypto';
import { getDocument, upsertDocument } from '@amz-spapi/couchbase-utils';

const SCOPE = 'a_plus';
const COLLECTION = 'source_cache';
const SCHEMA_VERSION = 1;

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_AMAZON_TTL_SECONDS = 6 * 60 * 60;

function readPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function defaultSourceCacheTtl(host?: string): number {
  if (host && host.toLowerCase().includes('amazon.')) {
    return (
      readPositiveInt('SOURCE_CACHE_TTL_AMAZON_SECONDS') ??
      DEFAULT_AMAZON_TTL_SECONDS
    );
  }
  return readPositiveInt('SOURCE_CACHE_TTL_SECONDS') ?? DEFAULT_TTL_SECONDS;
}

type CachedSourceDoc<TFacts> = {
  schemaVersion: number;
  url: string;
  facts: TFacts;
  cachedAt: number;
};

function cacheKey(url: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(url)
    .digest('hex')
    .slice(0, 32);
  return `source::${hash}`;
}

export async function getCachedSourceFacts<T>(url: string): Promise<T | null> {
  try {
    const doc = await getDocument<CachedSourceDoc<T>>(
      SCOPE,
      COLLECTION,
      cacheKey(url)
    );
    if (!doc || doc.schemaVersion !== SCHEMA_VERSION) return null;
    return doc.facts;
  } catch {
    return null;
  }
}

export async function setCachedSourceFacts<T>(
  url: string,
  facts: T,
  ttlSeconds?: number
): Promise<void> {
  let host: string | undefined;
  try {
    host = new URL(url).hostname;
  } catch {
    /* leave host undefined */
  }
  const ttl = ttlSeconds ?? defaultSourceCacheTtl(host);
  try {
    await upsertDocument<CachedSourceDoc<T>>(
      SCOPE,
      COLLECTION,
      cacheKey(url),
      {
        schemaVersion: SCHEMA_VERSION,
        url,
        facts,
        cachedAt: Date.now(),
      },
      ttl
    );
  } catch {
    // Cache write failure should never break extraction.
  }
}
