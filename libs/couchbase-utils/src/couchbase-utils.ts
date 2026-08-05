type QueryOptions = {
  parameters?: Record<string, unknown>;
  readonly?: boolean;
  preserve_expiry?: boolean;
  [key: string]: unknown;
};

type DataApiConfig = {
  baseUrl: string;
  username: string;
  password: string;
  bucket: string;
  /** The environment — `dev`, `staging`, `prod`. One scope holds everything. */
  environmentScope: string;
};

type DataApiQueryResponse<T> = {
  status?: string;
  results?: T[];
  errors?: Array<{ msg?: string }>;
  [key: string]: unknown;
};

/**
 * Everything needed to reach one environment's data.
 *
 * Deliberately one unit rather than "config plus a secret". All five change
 * together when a cluster is rebuilt — a new cluster has a new hostname AND new
 * users — so splitting them across a template and a secret creates a window
 * where a function holds the new host with the old login, or the reverse.
 */
export type CouchbaseConnection = {
  dataApiUrl: string;
  bucket: string;
  /** The environment — `dev`, `staging`, `prod`. One scope holds everything. */
  scope: string;
  username: string;
  password: string;
};

/**
 * Where the connection comes from.
 *
 * Async because the AWS implementation calls Secrets Manager. Consulted per
 * operation, so an implementation is expected to cache.
 */
export type ConnectionProvider = () => Promise<CouchbaseConnection>;

const CONNECTION_ENV = [
  'CB_DATA_API_URL',
  'CB_BUCKET',
  'CB_SCOPE',
  'CB_USERNAME',
  'CB_PASSWORD',
] as const;

/**
 * The environment, which is what Vercel, the CLIs and the scripts use.
 *
 * Kept as the default so that registering nothing behaves exactly as this
 * library always has.
 */
const envConnection: ConnectionProvider = async () => {
  const missing = CONNECTION_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Couchbase is not configured. Missing ${missing.join(', ')}. Set them, ` +
        'or register a provider with setConnectionProvider() — on AWS that is ' +
        'useSecretsManagerConnection() from @amz-spapi/couchbase-secrets, ' +
        'which reads all five from one Secrets Manager secret.'
    );
  }

  return {
    dataApiUrl: process.env['CB_DATA_API_URL'] as string,
    bucket: process.env['CB_BUCKET'] as string,
    scope: process.env['CB_SCOPE'] as string,
    username: process.env['CB_USERNAME'] as string,
    password: process.env['CB_PASSWORD'] as string,
  };
};

let resolveConnection: ConnectionProvider = envConnection;

/**
 * Take the connection from somewhere other than the environment.
 *
 * The seam exists because a Lambda environment variable is NOT a secret — it is
 * written into the CloudFormation template and returned by
 * `GetFunctionConfiguration` to anyone with read access on the function. AWS
 * therefore fetches the whole connection at runtime, while Vercel keeps reading
 * it from the environment.
 *
 * Injected rather than branched on inside this library: the AWS path needs
 * `@aws-sdk/client-secrets-manager`, and even a dynamic `import()` of it would
 * be resolved by Next's bundler whether or not the branch ever runs — pulling
 * the AWS SDK into the web bundle, which is exactly what must not happen.
 * See `@amz-spapi/couchbase-secrets`.
 */
export function setConnectionProvider(provider: ConnectionProvider): void {
  resolveConnection = provider;
}

/** Restore the environment default. For tests. */
export function resetConnectionProvider(): void {
  resolveConnection = envConnection;
}

async function getDataApiConfig(): Promise<DataApiConfig> {
  const connection = await resolveConnection();

  return {
    baseUrl: connection.dataApiUrl.replace(/\/+$/, ''),
    username: connection.username,
    password: connection.password,
    bucket: connection.bucket,
    environmentScope: connection.scope,
  };
}

/**
 * The flat collection name for a domain's entity (ADR-0005).
 *
 * The scope is the ENVIRONMENT, so domains survive only as a naming prefix:
 * `a_plus` + `drafts` is the collection `a_plus_drafts` inside scope `dev`.
 * Because scope-plus-collection was already unique, so is the joined name —
 * which is what keeps `sp_cache.listings` and `catalog.listings` apart.
 *
 * Exported because N1QL statements have to name collections themselves; the KV
 * helpers below apply it for you.
 */
export function collectionName(domain: string, collection: string): string {
  return `${domain}_${collection}`;
}

/**
 * Every identifier this statement uses as a keyspace.
 *
 * Only these positions can name a collection, which is the whole reason this is
 * matched rather than every backtick-quoted token: N1QL escapes *field* names
 * the same way, so `p.\`deleted\`` — the soft-delete guard on nearly every read
 * — is syntactically identical to a collection reference and is not one.
 *
 * `FROM` also covers `DELETE FROM`; `INTO` covers `INSERT INTO` and
 * `UPSERT INTO`.
 */
function keyspaceNames(statement: string): string[] {
  return [
    ...statement.matchAll(
      /\b(?:from|join|into|update)\s+`([a-z][a-z0-9_]*)`/gi
    ),
  ].map(([, name]) => name);
}

/**
 * Catch a statement that still names a collection the old way.
 *
 * After ADR-0005 there is one scope per environment and collections are
 * `<domain>_<entity>`, so `FROM \`drafts\`` resolves to nothing. Couchbase
 * answers that with "keyspace not found", which is recoverable but arrives at
 * runtime, in whichever code path happened to run. This turns it into an error
 * that names the fix.
 */
function assertQualified(domain: string, statement: string): void {
  const prefix = `${domain}_`;
  for (const name of keyspaceNames(statement)) {
    // A flattened name always contains the joining underscore; a bare entity
    // name never does.
    if (name.includes('_')) continue;
    throw new Error(
      `Statement names collection \`${name}\`, which no longer exists. ` +
        `Collections are flat per environment: use collectionName('${domain}', '${name}') ` +
        `→ \`${prefix}${name}\`. See docs/adr/0005-environment-scopes.md.`
    );
  }
}

function getAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function escapeIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

function getQueryContext(bucket: string, scopeName: string): string {
  return `default:${escapeIdentifier(bucket)}.${escapeIdentifier(scopeName)}`;
}

/**
 * How long a Data API call may take before it is abandoned.
 *
 * Every call here used to run with no timeout and no abort signal, so a stalled
 * Data API did not fail — it hung. Locally that is forever; on Vercel the
 * platform kills the request at 300 seconds and the user sees a spinner until
 * then, with nothing in the logs to say what was waited on.
 *
 * A hang is the worst failure available: no error, no retry, no signal. These
 * bounds turn it into an ordinary error that names the operation, which callers
 * already know how to report.
 *
 * Key-value operations are single-document lookups against a hosted service —
 * they are sub-second in practice, so ten seconds is already pathological.
 * Queries get longer because a scan legitimately can be, and because failing a
 * slow-but-working query is worse than waiting for it.
 */
const DATA_API_TIMEOUT_MS = {
  document: 10_000,
  query: 30_000,
} as const;

/**
 * Transient 5xx retries.
 *
 * Capella's Data API intermittently answers a perfectly valid KV request with
 * `500 {"code":"Internal","message":"An unknown memcached error occurred
 * (status: 56)"}` — the HTTP layer failing to reach the KV engine. Observed
 * live: writes to one collection failed for roughly a minute, on every key
 * shape tried, while reads on the same collection kept working; sixty
 * sequential writes immediately afterwards all succeeded.
 *
 * With no retry, one blip inside a multi-write operation fails the whole thing
 * in front of the user. Three attempts over ~1.2s covers a window of that
 * length without holding a request open long enough to matter.
 *
 * Applied ONLY to calls that are safe to repeat. Deliberately excluded:
 *   - `incrementCounter` — a repeat that the first attempt actually applied
 *     burns a PO number.
 *   - `insertDocument` — a repeat lands as a spurious 409, replacing a real
 *     error with a misleading one.
 *   - non-SELECT N1QL — arbitrary statements, some of which mutate.
 */
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [200, 1000];

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Turn an abort into a message that says what timed out.
 *
 * `fetch` rejects an aborted request with a bare "This operation was aborted",
 * which tells a reader nothing about which call stalled or for how long.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  description: string,
  /**
   * Whether repeating this call is harmless. Off by default: the caller has to
   * assert it, because getting this wrong is silent duplicate work rather than
   * a visible error. See `RETRY_ATTEMPTS`.
   */
  idempotent = false
): Promise<Response> {
  let lastTransient: Response | undefined;

  for (
    let attempt = 0;
    attempt < (idempotent ? RETRY_ATTEMPTS : 1);
    attempt++
  ) {
    if (attempt > 0) await delay(RETRY_BACKOFF_MS[attempt - 1]);

    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // 5xx from the Data API is the cluster failing to reach the KV engine,
      // not a verdict on the request — the identical call succeeds moments
      // later. 4xx is a verdict, so it is returned as-is.
      if (response.status < 500) return response;
      lastTransient = response;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(
          `Couchbase Data API timed out after ${
            timeoutMs / 1000
          }s: ${description}`
        );
      }
      throw error;
    }
  }

  // Out of attempts. Hand back the last response so the caller's normal error
  // path reports the real status and body rather than a wrapper.
  return lastTransient as Response;
}

async function executeDataApiQuery<T>(params: {
  statement: string;
  options?: QueryOptions;
}): Promise<{ rows: T[]; meta: DataApiQueryResponse<T> }> {
  const config = await getDataApiConfig();
  const { parameters, ...restOptions } = params.options ?? {};

  const body: Record<string, unknown> = {
    statement: params.statement,
    query_context: getQueryContext(config.bucket, config.environmentScope),
    ...restOptions,
  };

  for (const [key, value] of Object.entries(parameters ?? {})) {
    body[`$${key}`] = value;
  }

  const response = await fetchWithTimeout(
    `${config.baseUrl}/_p/query/query/service`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    DATA_API_TIMEOUT_MS.query,
    'query',
    // Reads only. `executeQuery` takes arbitrary N1QL, and repeating an INSERT
    // or UPDATE that the first attempt already applied is a real mutation, not
    // a retry — so anything that is not plainly a SELECT is left to fail.
    /^\s*select\b/i.test(params.statement)
  );

  const payload = (await response.json()) as DataApiQueryResponse<T>;

  if (!response.ok || payload.status === 'errors') {
    const message =
      payload.errors
        ?.map((error) => error.msg)
        .filter(Boolean)
        .join('; ') ||
      `Couchbase Data API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return { rows: payload.results ?? [], meta: payload };
}

export async function createCouchbaseCluster(): Promise<never> {
  throw new Error(
    'Native Couchbase SDK access is disabled in the web runtime. Use the Couchbase Data API instead.'
  );
}

export async function connectToDatabase(): Promise<{
  mode: 'data-api';
  cluster: null;
  bucket: { name: string };
}> {
  const config = await getDataApiConfig();
  return {
    mode: 'data-api',
    cluster: null,
    bucket: {
      name: config.bucket,
    },
  };
}

export async function getContext() {
  return connectToDatabase();
}

/**
 * Document operations go to the Data API's KV endpoints, not the query service.
 *
 * These are single-key reads and writes. Expressing them as N1QL made every one
 * of them parse and plan a statement to reach a document it already had the key
 * for, and gave up what the KV endpoints provide for free: CAS through ETag,
 * create-only semantics, and atomic counters.
 */
function documentUrl(
  config: DataApiConfig,
  domain: string,
  collection: string,
  key: string
): string {
  return (
    `${config.baseUrl}/v1/buckets/${encodeURIComponent(config.bucket)}` +
    `/scopes/${encodeURIComponent(config.environmentScope)}` +
    `/collections/${encodeURIComponent(collectionName(domain, collection))}` +
    `/documents/${encodeURIComponent(key)}`
  );
}

/**
 * Expiry is a Go duration string on the Expires header.
 *
 * This replaces the KV protocol's trap where a value over 30 days is read as an
 * absolute Unix timestamp — passing 180 days as-is expired documents instantly,
 * in 1970. Seconds-with-a-suffix has no such threshold.
 */
function expiresHeader(expirySeconds?: number): Record<string, string> {
  return expirySeconds && expirySeconds > 0
    ? { Expires: `${Math.floor(expirySeconds)}s` }
    : {};
}

async function failureMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return body
    ? `Couchbase Data API ${response.status}: ${body.slice(0, 300)}`
    : `Couchbase Data API request failed with status ${response.status}`;
}

export async function getDocument<T>(
  domain: string,
  collection: string,
  key: string
): Promise<T | null> {
  const config = await getDataApiConfig();
  const response = await fetchWithTimeout(
    documentUrl(config, domain, collection, key),
    {
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        Accept: 'application/json',
      },
    },
    DATA_API_TIMEOUT_MS.document,
    `get ${collectionName(domain, collection)}/${key}`,
    true
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await failureMessage(response));
  return (await response.json()) as T;
}

export async function upsertDocument<T>(
  domain: string,
  collection: string,
  key: string,
  document: T,
  expirySeconds?: number
): Promise<void> {
  const config = await getDataApiConfig();
  const response = await fetchWithTimeout(
    documentUrl(config, domain, collection, key),
    {
      method: 'PUT',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        ...expiresHeader(expirySeconds),
      },
      body: JSON.stringify(document),
    },
    DATA_API_TIMEOUT_MS.document,
    `upsert ${collectionName(domain, collection)}/${key}`,
    // Upsert writes the same body to the same key — a repeat is the same
    // end state, which is exactly what makes it safe to repeat.
    true
  );
  if (!response.ok) throw new Error(await failureMessage(response));
}

/**
 * Write only if the key is absent. Returns false when it already exists.
 *
 * The race this closes: two callers both find no document, both write, and one
 * write is lost. POST answers 409 for the loser instead.
 */
export async function insertDocument<T>(
  domain: string,
  collection: string,
  key: string,
  document: T,
  expirySeconds?: number
): Promise<boolean> {
  const config = await getDataApiConfig();
  const response = await fetchWithTimeout(
    documentUrl(config, domain, collection, key),
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        ...expiresHeader(expirySeconds),
      },
      body: JSON.stringify(document),
    },
    DATA_API_TIMEOUT_MS.document,
    `insert ${collectionName(domain, collection)}/${key}`
  );
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(await failureMessage(response));
  return true;
}

export async function deleteDocument(
  domain: string,
  collection: string,
  key: string
): Promise<boolean> {
  const config = await getDataApiConfig();
  const response = await fetchWithTimeout(
    documentUrl(config, domain, collection, key),
    {
      method: 'DELETE',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
      },
    },
    DATA_API_TIMEOUT_MS.document,
    `delete ${collectionName(domain, collection)}/${key}`,
    // A repeat of a delete that landed answers 404, which this already maps to
    // "was not there" — the same result the caller would have got.
    true
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(await failureMessage(response));
  return true;
}

/**
 * Atomically add to a counter document, creating it if absent.
 *
 * CAREFUL: on creation the endpoint stores `initial` and IGNORES `delta`.
 * Passing initial: 0 therefore drops the first increment silently — for a spend
 * counter that makes the first paid call of each day free. `initial` is set to
 * the delta here for that reason, so creation and increment agree.
 */
export async function incrementCounter(
  domain: string,
  collection: string,
  key: string,
  delta: number,
  expirySeconds?: number
): Promise<number> {
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new Error('incrementCounter requires a positive delta.');
  }
  const amount = Math.round(delta);
  const config = await getDataApiConfig();
  const response = await fetchWithTimeout(
    `${documentUrl(config, domain, collection, key)}/increment`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        ...expiresHeader(expirySeconds),
      },
      body: JSON.stringify({ initial: amount, delta: amount }),
    },
    DATA_API_TIMEOUT_MS.document,
    `increment ${collectionName(domain, collection)}/${key}`
  );
  if (!response.ok) throw new Error(await failureMessage(response));
  return Number(await response.text());
}

/**
 * Run a statement against the environment scope.
 *
 * `domain` is not a scope any more — it is the prefix that turns a bare entity
 * name into the flat collection (ADR-0005). Statements name their own
 * collections, so build them with `collectionName(domain, entity)`; passing the
 * domain here keeps the call sites self-describing and lets this function say
 * so when a statement still uses a bare name.
 */
export async function executeQuery<T>(
  domain: string,
  query: string,
  options?: QueryOptions
): Promise<{ rows: T[]; meta?: Record<string, unknown> }> {
  assertQualified(domain, query);
  const { rows, meta } = await executeDataApiQuery<T>({
    statement: query,
    options,
  });

  return { rows, meta };
}
