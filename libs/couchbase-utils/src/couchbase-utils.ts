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
  defaultScope?: string;
};

type DataApiQueryResponse<T> = {
  status?: string;
  results?: T[];
  errors?: Array<{ msg?: string }>;
  [key: string]: unknown;
};

function getDataApiConfig(): DataApiConfig {
  const baseUrl = process.env['CB_DATA_API_URL'];
  const username = process.env['CB_USERNAME'];
  const password = process.env['CB_PASSWORD'];
  const bucket = process.env['CB_BUCKET'];
  const defaultScope = process.env['CB_SCOPE'];

  if (!baseUrl || !username || !password || !bucket) {
    throw new Error(
      'Couchbase Data API is not configured. Set CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, and CB_BUCKET.'
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    username,
    password,
    bucket,
    defaultScope,
  };
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

async function executeDataApiQuery<T>(params: {
  scopeName: string;
  statement: string;
  options?: QueryOptions;
}): Promise<{ rows: T[]; meta: DataApiQueryResponse<T> }> {
  const config = getDataApiConfig();
  const { parameters, ...restOptions } = params.options ?? {};
  const scopeName = params.scopeName || config.defaultScope;

  if (!scopeName) {
    throw new Error(
      'Couchbase scope is required for Data API queries. Set CB_SCOPE.'
    );
  }

  const body: Record<string, unknown> = {
    statement: params.statement,
    query_context: getQueryContext(config.bucket, scopeName),
    ...restOptions,
  };

  for (const [key, value] of Object.entries(parameters ?? {})) {
    body[`$${key}`] = value;
  }

  const response = await fetch(`${config.baseUrl}/_p/query/query/service`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(config.username, config.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

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
  const config = getDataApiConfig();
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
  scopeName: string,
  collectionName: string,
  key: string
): string {
  return (
    `${config.baseUrl}/v1/buckets/${encodeURIComponent(config.bucket)}` +
    `/scopes/${encodeURIComponent(scopeName)}` +
    `/collections/${encodeURIComponent(collectionName)}` +
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
  scopeName: string,
  collectionName: string,
  key: string
): Promise<T | null> {
  const config = getDataApiConfig();
  const response = await fetch(
    documentUrl(config, scopeName, collectionName, key),
    {
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        Accept: 'application/json',
      },
    }
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await failureMessage(response));
  return (await response.json()) as T;
}

export async function upsertDocument<T>(
  scopeName: string,
  collectionName: string,
  key: string,
  document: T,
  expirySeconds?: number
): Promise<void> {
  const config = getDataApiConfig();
  const response = await fetch(
    documentUrl(config, scopeName, collectionName, key),
    {
      method: 'PUT',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        ...expiresHeader(expirySeconds),
      },
      body: JSON.stringify(document),
    }
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
  scopeName: string,
  collectionName: string,
  key: string,
  document: T,
  expirySeconds?: number
): Promise<boolean> {
  const config = getDataApiConfig();
  const response = await fetch(
    documentUrl(config, scopeName, collectionName, key),
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        ...expiresHeader(expirySeconds),
      },
      body: JSON.stringify(document),
    }
  );
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(await failureMessage(response));
  return true;
}

export async function deleteDocument(
  scopeName: string,
  collectionName: string,
  key: string
): Promise<boolean> {
  const config = getDataApiConfig();
  const response = await fetch(
    documentUrl(config, scopeName, collectionName, key),
    {
      method: 'DELETE',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
      },
    }
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
  scopeName: string,
  collectionName: string,
  key: string,
  delta: number,
  expirySeconds?: number
): Promise<number> {
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new Error('incrementCounter requires a positive delta.');
  }
  const amount = Math.round(delta);
  const config = getDataApiConfig();
  const response = await fetch(
    `${documentUrl(config, scopeName, collectionName, key)}/increment`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(config.username, config.password),
        'Content-Type': 'application/json',
        ...expiresHeader(expirySeconds),
      },
      body: JSON.stringify({ initial: amount, delta: amount }),
    }
  );
  if (!response.ok) throw new Error(await failureMessage(response));
  return Number(await response.text());
}

export async function executeQuery<T>(
  scopeName: string,
  query: string,
  options?: QueryOptions
): Promise<{ rows: T[]; meta?: Record<string, unknown> }> {
  const { rows, meta } = await executeDataApiQuery<T>({
    scopeName,
    statement: query,
    options,
  });

  return { rows, meta };
}
