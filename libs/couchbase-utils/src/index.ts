export {
  createCouchbaseCluster,
  connectToDatabase,
  getContext,
  collectionName,
  getDocument,
  upsertDocument,
  insertDocument,
  deleteDocument,
  incrementCounter,
  executeQuery,
  setConnectionProvider,
  resetConnectionProvider,
} from './couchbase-utils.js';

export type {
  CouchbaseConnection,
  ConnectionProvider,
} from './couchbase-utils.js';
