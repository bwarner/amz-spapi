import * as couchbase from 'couchbase';

const { connect } = couchbase;

/**
 * Global cached connection to survive hot reloads in development.
 */
let cached = (globalThis as any).__couchbase;

if (!cached) {
  cached = (globalThis as any).__couchbase = { conn: null };
}

export async function createCouchbaseCluster(
  connectionString: string | undefined,
  username: string | undefined,
  password: string | undefined
): Promise<couchbase.Cluster> {
  if (cached.conn) {
    return cached.conn;
  }
  if (!connectionString || !username || !password) {
    throw new Error('Couchbase connection string, username, and password are required');
  }

  if (
    connectionString.startsWith('couchbases') &&
    !connectionString.includes('?tls_verify=none')
  ) {
    connectionString = connectionString + '?tls_verify=none';
  }

  cached.conn = await connect(connectionString, { username, password });
  return cached.conn;
}

export async function connectToDatabase(
  connectionString: string | undefined,
  username: string | undefined,
  password: string | undefined,
  bucketName: string | undefined
) {
  const cluster = await createCouchbaseCluster(connectionString, username, password);
  if (!bucketName) {
    throw new Error('Couchbase bucket name is required');
  }
  const bucket = cluster.bucket(bucketName);
  return { cluster, bucket };
}

export async function getContext() {
  return connectToDatabase(
    process.env['COUCHBASE_CONNECTION_STRING'],
    process.env['COUCHBASE_USERNAME'],
    process.env['COUCHBASE_PASSWORD'],
    process.env['COUCHBASE_BUCKET']
  );
}

/**
 * Get a document by key, returning null if not found.
 */
export async function getDocument<T>(
  scopeName: string,
  collectionName: string,
  key: string
): Promise<T | null> {
  const { bucket } = await getContext();
  const collection = bucket.scope(scopeName).collection(collectionName);
  try {
    const result = await collection.get(key);
    return result.content as T;
  } catch (err: any) {
    if (err instanceof couchbase.DocumentNotFoundError) {
      return null;
    }
    throw err;
  }
}

/**
 * Upsert a document with optional TTL (expiry in seconds).
 */
export async function upsertDocument<T>(
  scopeName: string,
  collectionName: string,
  key: string,
  document: T,
  expirySeconds?: number
): Promise<void> {
  const { bucket } = await getContext();
  const collection = bucket.scope(scopeName).collection(collectionName);
  const options: couchbase.UpsertOptions = {};
  if (expirySeconds) {
    options.expiry = expirySeconds;
  }
  await collection.upsert(key, document, options);
}

/**
 * Delete a document by key. Returns true if deleted, false if not found.
 */
export async function deleteDocument(
  scopeName: string,
  collectionName: string,
  key: string
): Promise<boolean> {
  const { bucket } = await getContext();
  const collection = bucket.scope(scopeName).collection(collectionName);
  try {
    await collection.remove(key);
    return true;
  } catch (err: any) {
    if (err instanceof couchbase.DocumentNotFoundError) {
      return false;
    }
    throw err;
  }
}

/**
 * Execute a N1QL/SQL++ query against a scope.
 */
export async function executeQuery<T>(
  scopeName: string,
  query: string,
  options?: couchbase.QueryOptions
) {
  const { bucket } = await getContext();
  const scope = bucket.scope(scopeName);
  return scope.query<T>(query, options);
}
