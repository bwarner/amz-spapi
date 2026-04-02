#!/usr/bin/env node
/**
 * Couchbase Setup Script for Sellavant
 *
 * Creates the required scopes and collections in the Sellavant Couchbase bucket.
 * Safe to run multiple times (idempotent).
 *
 * Required scopes/collections:
 *   sp_cache.catalog       — SP-API catalog item cache (TTL: 24h)
 *   sp_cache.orders        — SP-API orders cache (TTL: 15min)
 *   sp_cache.inventory     — SP-API inventory cache (TTL: 30min)
 *   credentials.profiles   — Amazon OAuth credential profiles (no TTL)
 *
 * Usage:
 *   npx tsx scripts/setup-couchbase.ts
 *
 * Env vars (loaded from .env.local if using --env-file, or set in environment):
 *   COUCHBASE_CONNECTION_STRING
 *   COUCHBASE_USERNAME
 *   COUCHBASE_PASSWORD
 *   COUCHBASE_BUCKET
 */

import * as couchbase from 'couchbase';

const REQUIRED_STRUCTURES: Array<{ scope: string; collections: string[] }> = [
  {
    scope: 'sp_cache',
    collections: ['catalog', 'orders', 'inventory'],
  },
  {
    scope: 'credentials',
    collections: ['profiles'],
  },
];

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function scopeExists(
  bucket: couchbase.Bucket,
  scopeName: string
): Promise<boolean> {
  try {
    const mgr = bucket.collections();
    const scopes = await mgr.getAllScopes();
    return scopes.some((s) => s.name === scopeName);
  } catch {
    return false;
  }
}

async function collectionExists(
  bucket: couchbase.Bucket,
  scopeName: string,
  collectionName: string
): Promise<boolean> {
  try {
    const mgr = bucket.collections();
    const scopes = await mgr.getAllScopes();
    const scope = scopes.find((s) => s.name === scopeName);
    if (!scope) return false;
    return scope.collections.some((c) => c.name === collectionName);
  } catch {
    return false;
  }
}

async function createScopeIfNotExists(
  bucket: couchbase.Bucket,
  scopeName: string
): Promise<void> {
  const mgr = bucket.collections();
  const exists = await scopeExists(bucket, scopeName);
  if (exists) {
    console.log(`  ✓ Scope '${scopeName}' already exists`);
    return;
  }
  try {
    await mgr.createScope(scopeName);
    console.log(`  ✅ Created scope '${scopeName}'`);
  } catch (err: any) {
    // ScopeExists error code from Couchbase SDK
    if (err?.cause?.first_error_code === 0x0b0a || err?.message?.includes('already exists')) {
      console.log(`  ✓ Scope '${scopeName}' already exists (race condition)`);
    } else {
      throw err;
    }
  }
}

async function createCollectionIfNotExists(
  bucket: couchbase.Bucket,
  scopeName: string,
  collectionName: string
): Promise<void> {
  const mgr = bucket.collections();
  const exists = await collectionExists(bucket, scopeName, collectionName);
  if (exists) {
    console.log(`    ✓ Collection '${scopeName}.${collectionName}' already exists`);
    return;
  }
  try {
    await mgr.createCollection({ name: collectionName, scopeName });
    console.log(`    ✅ Created collection '${scopeName}.${collectionName}'`);
  } catch (err: any) {
    if (err?.cause?.first_error_code === 0x0b09 || err?.message?.includes('already exists')) {
      console.log(`    ✓ Collection '${scopeName}.${collectionName}' already exists (race condition)`);
    } else {
      throw err;
    }
  }
}

async function waitForCollection(
  bucket: couchbase.Bucket,
  scopeName: string,
  collectionName: string,
  timeoutMs = 10_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const exists = await collectionExists(bucket, scopeName, collectionName);
    if (exists) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for collection '${scopeName}.${collectionName}' to become available`);
}

async function createIndex(
  cluster: couchbase.Cluster,
  bucketName: string,
  scopeName: string,
  collectionName: string,
  indexName: string,
  fields: string[]
): Promise<void> {
  const fieldList = fields.join(', ');
  const n1ql = `
    CREATE INDEX \`${indexName}\`
    ON \`${bucketName}\`.\`${scopeName}\`.\`${collectionName}\`(${fieldList})
    WITH { "defer_build": false }
  `;
  try {
    await cluster.query(n1ql);
    console.log(`    ✅ Created index '${indexName}' on '${scopeName}.${collectionName}'`);
  } catch (err: any) {
    if (err?.message?.includes('already exists') || err?.cause?.message?.includes('already exists')) {
      console.log(`    ✓ Index '${indexName}' already exists`);
    } else {
      // Index creation failures are non-fatal — app still works without them (just slower queries)
      console.warn(`    ⚠ Could not create index '${indexName}': ${err.message}`);
    }
  }
}

async function createPrimaryIndex(
  cluster: couchbase.Cluster,
  bucketName: string,
  scopeName: string,
  collectionName: string
): Promise<void> {
  const n1ql = `
    CREATE PRIMARY INDEX ON \`${bucketName}\`.\`${scopeName}\`.\`${collectionName}\`
  `;
  try {
    await cluster.query(n1ql);
    console.log(`    ✅ Created primary index on '${scopeName}.${collectionName}'`);
  } catch (err: any) {
    if (err?.message?.includes('already exists') || err?.cause?.message?.includes('already exists')) {
      console.log(`    ✓ Primary index already exists on '${scopeName}.${collectionName}'`);
    } else {
      console.warn(`    ⚠ Could not create primary index on '${scopeName}.${collectionName}': ${err.message}`);
    }
  }
}

async function main() {
  const connectionString = getEnvVar('COUCHBASE_CONNECTION_STRING');
  const username = getEnvVar('COUCHBASE_USERNAME');
  const password = getEnvVar('COUCHBASE_PASSWORD');
  const bucketName = getEnvVar('COUCHBASE_BUCKET');

  const connStr = connectionString.startsWith('couchbases') && !connectionString.includes('?tls_verify=none')
    ? connectionString + '?tls_verify=none'
    : connectionString;

  console.log(`\n🔌 Connecting to Couchbase...`);
  console.log(`   Host: ${connectionString}`);
  console.log(`   Bucket: ${bucketName}\n`);

  let cluster: couchbase.Cluster;
  try {
    cluster = await couchbase.connect(connStr, { username, password });
  } catch (err: any) {
    console.error(`❌ Failed to connect to Couchbase: ${err.message}`);
    process.exit(1);
  }

  const bucket = cluster.bucket(bucketName);

  // Verify bucket is accessible
  try {
    await bucket.ping();
    console.log(`✅ Connected to bucket '${bucketName}'\n`);
  } catch {
    // ping may not be available on all editions — proceed anyway
    console.log(`✅ Connected (ping skipped)\n`);
  }

  console.log(`🏗  Creating scopes and collections...\n`);

  for (const { scope, collections } of REQUIRED_STRUCTURES) {
    console.log(`📁 Scope: ${scope}`);
    await createScopeIfNotExists(bucket, scope);

    for (const collection of collections) {
      await createCollectionIfNotExists(bucket, scope, collection);
      // Wait briefly for collection to be ready before creating indexes
      await waitForCollection(bucket, scope, collection);
    }
    console.log('');
  }

  console.log(`📑 Creating indexes...\n`);

  // sp_cache.catalog — primary index for TTL cleanup queries
  await createPrimaryIndex(cluster, bucketName, 'sp_cache', 'catalog');

  // sp_cache.orders — primary index
  await createPrimaryIndex(cluster, bucketName, 'sp_cache', 'orders');

  // sp_cache.inventory — primary index
  await createPrimaryIndex(cluster, bucketName, 'sp_cache', 'inventory');

  // credentials.profiles — lookup by userId + apiType (most common query pattern)
  await createPrimaryIndex(cluster, bucketName, 'credentials', 'profiles');
  await createIndex(
    cluster,
    bucketName,
    'credentials',
    'profiles',
    'idx_profiles_user_apitype',
    ['`user_id`', '`api_type`']
  );

  console.log('\n✅ Couchbase setup complete!\n');
  console.log('📋 Summary of structures created:');
  console.log('   sp_cache.catalog    — SP-API catalog item cache (TTL: 24h)');
  console.log('   sp_cache.orders     — SP-API orders cache (TTL: 15min)');
  console.log('   sp_cache.inventory  — SP-API inventory cache (TTL: 30min)');
  console.log('   credentials.profiles — Amazon OAuth credential profiles');
  console.log('');
  console.log('ℹ  Note: Document TTLs are set by the application, not Couchbase.');
  console.log('   PII data (buyer info) is never stored — complies with Amazon Developer Agreement.\n');

  await cluster.close();
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err.message ?? err);
  process.exit(1);
});
