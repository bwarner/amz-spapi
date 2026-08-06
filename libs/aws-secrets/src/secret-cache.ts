import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

/**
 * One JSON secret from Secrets Manager, fetched at runtime and cached.
 *
 * Exists because a Lambda environment variable is NOT a secret: it is written
 * into the CloudFormation template, shown in the console, and returned by
 * `GetFunctionConfiguration` to anyone with read access on the function. Two
 * things now depend on that — the Couchbase login and the LWA/Ads client
 * secrets — so the caching, the TTL and the redaction rules live here once
 * rather than being reimplemented per secret, where they would drift and where
 * the second copy would be the one that logged a password.
 *
 * Separate from the domain libraries so `@aws-sdk/*` lives in a package the
 * Next.js app never imports.
 */

/**
 * Module scope, so entries survive between invocations.
 *
 * Lambda freezes and thaws the execution environment rather than tearing it
 * down, so anything at module scope is reused for the container's life — which
 * is what makes caching here worth doing at all. Without it, EVERY operation
 * would call Secrets Manager: a single `credentials` request does three, and a
 * `sync-worker` run does thousands.
 *
 * SAFE HERE, and the reason is specific rather than general. Everything cached
 * through this map is per STAGE — the cluster login, the LWA application's own
 * client secret — so one container reusing an entry across two users' requests
 * hands the second user exactly what it would have fetched anyway. That does
 * NOT generalise: caching anything per-user here (a seller's access token, a
 * decrypted profile) would bleed between requests, because Lambda reuses one
 * container for many callers. The test that matters is whether the cached value
 * depends on who is asking. Nothing here does.
 *
 * Keyed by secret id, because there is more than one secret now and a single
 * slot would have the two evicting each other on every alternating call.
 */
const cache = new Map<string, { fetchedAt: number; value: Promise<unknown> }>();

let client: SecretsManagerClient | undefined;

/**
 * How long a fetched secret is reused.
 *
 * The cost argument, so the number is not arbitrary. `GetSecretValue` is $0.05
 * per 10,000 calls. At this TTL a container alive for an hour makes six calls
 * per secret; fifty warm containers over a day is ~7,200 calls, about $0.04.
 * Without caching the same load is millions of calls and a per-operation round
 * trip added to every read. The cache is the whole saving; the TTL barely moves
 * it.
 *
 * What the TTL actually buys is rotation. Cached forever, a warm container
 * keeps presenting a rotated-away password until it happens to be recycled —
 * failing every request in the meantime with no way to recover. Ten minutes
 * bounds that. `invalidateSecret` is the better answer and makes the TTL a
 * backstop rather than the mechanism.
 */
const DEFAULT_TTL_MS = 10 * 60_000;

function ttlMs(): number {
  // One knob for every secret. They are all per-stage configuration fetched the
  // same way, so a per-secret TTL would be a setting nobody would ever want to
  // set differently.
  const override = Number(process.env['CB_SECRET_TTL_MS']);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_TTL_MS;
}

/**
 * Forget a cached secret so the next call refetches.
 *
 * Call this when the thing the secret authenticates against rejects it — a 401
 * from the Data API or from LWA after a rotation is exactly the signal that the
 * cached value is stale, and refetching once beats waiting out the TTL while
 * every request fails.
 */
export function invalidateSecret(secretId: string): void {
  cache.delete(secretId);
}

/** Drop everything. Tests only; a running Lambda has no reason to. */
export function clearSecretCache(): void {
  cache.clear();
}

async function fetchJson(secretId: string): Promise<unknown> {
  client ??= new SecretsManagerClient({});

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  if (!response.SecretString) {
    // A binary secret is a different thing stored under the same name, which
    // usually means the wrong secret id rather than a corrupt one.
    throw new Error(
      `Secret "${secretId}" has no SecretString. It must hold JSON.`
    );
  }

  try {
    return JSON.parse(response.SecretString);
  } catch {
    // Deliberately not including the parse error or the body. A JSON syntax
    // error quotes the text around the fault, and the text here is the
    // password.
    throw new Error(`Secret "${secretId}" is not valid JSON.`);
  }
}

/**
 * Every key a secret must carry, as strings, or a failure naming the absentees.
 *
 * Shared by both readers so the error is the same shape wherever it comes from,
 * and so neither one is tempted to print the value of the keys that WERE
 * present in order to explain the one that was not.
 */
export function requireStringFields<K extends string>(
  secretId: string,
  parsed: unknown,
  keys: readonly K[]
): Record<K, string> {
  const fields = (parsed ?? {}) as Record<string, unknown>;
  const missing = keys.filter(
    (key) => typeof fields[key] !== 'string' || !fields[key]
  );

  if (missing.length) {
    // Names the missing keys, never the value of the ones that were present.
    throw new Error(
      `Secret "${secretId}" is missing ${missing.join(', ')}. It must hold ` +
        `${keys.join(', ')} as strings.`
    );
  }

  return Object.fromEntries(keys.map((key) => [key, fields[key]])) as Record<
    K,
    string
  >;
}

/**
 * Resolve a secret, reusing an in-flight or recent fetch.
 *
 * The cached entry is the PROMISE, not the resolved value. On a cold container
 * several operations start concurrently and all of them ask; caching the value
 * would let every one of them miss and issue its own `GetSecretValue`, so the
 * first request after a cold start would pay for as many API calls as it makes
 * operations. Caching the promise collapses them to one.
 *
 * A failed fetch is not cached — the entry is cleared on rejection so a
 * transient Secrets Manager error does not poison the container for the rest of
 * the TTL.
 *
 * `parse` runs on every call rather than once per fetch, and that is on
 * purpose: it is pure validation over an already-resolved object, so running it
 * again costs nothing, and caching its OUTPUT would mean two callers wanting
 * different views of one secret could not share a fetch.
 */
export function getCachedSecret<T>(
  secretId: string,
  parse: (parsed: unknown) => T
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(secretId);
  if (hit && now - hit.fetchedAt < ttlMs()) {
    return hit.value.then(parse);
  }

  const value = fetchJson(secretId).catch((error) => {
    if (cache.get(secretId)?.value === value) cache.delete(secretId);
    throw error;
  });

  cache.set(secretId, { fetchedAt: now, value });
  return value.then(parse);
}
