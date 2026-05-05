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

export async function getDocument<T>(
  scopeName: string,
  collectionName: string,
  key: string
): Promise<T | null> {
  const { rows } = await executeDataApiQuery<T>({
    scopeName,
    statement: `SELECT RAW doc
      FROM ${escapeIdentifier(collectionName)} AS doc
      USE KEYS $key`,
    options: {
      parameters: { key },
      readonly: true,
    },
  });

  return rows[0] ?? null;
}

export async function upsertDocument<T>(
  scopeName: string,
  collectionName: string,
  key: string,
  document: T,
  expirySeconds?: number
): Promise<void> {
  const statement = expirySeconds
    ? `UPSERT INTO ${escapeIdentifier(collectionName)} (KEY, VALUE, OPTIONS)
       VALUES ($key, $document, {"expiration": $expiry})
       RETURNING RAW META().id`
    : `UPSERT INTO ${escapeIdentifier(collectionName)} (KEY, VALUE)
       VALUES ($key, $document)
       RETURNING RAW META().id`;

  await executeDataApiQuery<string>({
    scopeName,
    statement,
    options: {
      parameters: {
        key,
        document,
        ...(expirySeconds ? { expiry: expirySeconds } : {}),
      },
    },
  });
}

export async function deleteDocument(
  scopeName: string,
  collectionName: string,
  key: string
): Promise<boolean> {
  const { rows } = await executeDataApiQuery<string>({
    scopeName,
    statement: `DELETE FROM ${escapeIdentifier(collectionName)}
      USE KEYS $key
      RETURNING RAW META().id`,
    options: {
      parameters: { key },
    },
  });

  return rows.length > 0;
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
