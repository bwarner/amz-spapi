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
  searchQuery,
  setConnectionProvider,
  resetConnectionProvider,
} from './couchbase-utils.js';

export type {
  CouchbaseConnection,
  ConnectionProvider,
  SearchHit,
  SearchResponse,
} from './couchbase-utils.js';
