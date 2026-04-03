#!/usr/bin/env npx tsx
/**
 * Couchbase Database Migration Script
 *
 * Creates required scopes and collections for the Sellavant application.
 * This script is idempotent - safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/db-migrate.ts
 *
 * Required environment variables:
 *   COUCHBASE_CONNECTION_STRING
 *   COUCHBASE_USERNAME
 *   COUCHBASE_PASSWORD
 *   COUCHBASE_BUCKET
 */

import * as couchbase from 'couchbase';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../apps/web/.env') });
dotenv.config({ path: path.join(__dirname, '../apps/web/.env.local') });

interface ScopeConfig {
  name: string;
  collections: string[];
}

const SCHEMA: ScopeConfig[] = [
  {
    name: 'sp_cache',
    collections: ['catalog', 'orders', 'inventory'],
  },
  {
    name: 'credentials',
    collections: ['profiles'],
  },
];

async function migrate() {
  const connStr = process.env.COUCHBASE_CONNECTION_STRING;
  const username = process.env.COUCHBASE_USERNAME;
  const password = process.env.COUCHBASE_PASSWORD;
  const bucketName = process.env.COUCHBASE_BUCKET;

  if (!connStr || !username || !password || !bucketName) {
    console.error('❌ Missing required environment variables:');
    console.error('   COUCHBASE_CONNECTION_STRING:', connStr ? '✓' : '✗');
    console.error('   COUCHBASE_USERNAME:', username ? '✓' : '✗');
    console.error('   COUCHBASE_PASSWORD:', password ? '✓' : '✗');
    console.error('   COUCHBASE_BUCKET:', bucketName ? '✓' : '✗');
    process.exit(1);
  }

  // Add TLS verification bypass for development
  let connectionString = connStr;
  if (
    connectionString.startsWith('couchbases') &&
    !connectionString.includes('?tls_verify=none')
  ) {
    connectionString = connectionString + '?tls_verify=none';
  }

  console.log('🔗 Connecting to Couchbase...');
  console.log(`   Bucket: ${bucketName}`);

  let cluster: couchbase.Cluster;
  try {
    cluster = await couchbase.connect(connectionString, { username, password });
    console.log('✓ Connected to cluster');
  } catch (err: any) {
    console.error('❌ Failed to connect:', err.message);
    process.exit(1);
  }

  const bucket = cluster.bucket(bucketName);
  const collMgr = bucket.collections();

  // Get existing scopes
  let existingScopes: couchbase.ScopeSpec[] = [];
  try {
    existingScopes = await collMgr.getAllScopes();
  } catch (err: any) {
    console.error('❌ Failed to get scopes:', err.message);
    process.exit(1);
  }

  const existingScopeNames = new Set(existingScopes.map((s) => s.name));
  const existingCollections = new Map<string, Set<string>>();
  for (const scope of existingScopes) {
    existingCollections.set(
      scope.name,
      new Set(scope.collections.map((c) => c.name))
    );
  }

  console.log('\n📦 Migrating schema...\n');

  for (const scopeConfig of SCHEMA) {
    const scopeName = scopeConfig.name;

    // Create scope if it doesn't exist
    if (existingScopeNames.has(scopeName)) {
      console.log(`📁 Scope "${scopeName}" already exists`);
    } else {
      console.log(`📁 Creating scope "${scopeName}"...`);
      try {
        await collMgr.createScope(scopeName);
        console.log(`   ✓ Created`);
        // Wait for scope to be ready
        await new Promise((r) => setTimeout(r, 2000));
        existingCollections.set(scopeName, new Set());
      } catch (err: any) {
        if (err.message?.includes('already exists')) {
          console.log(`   ✓ Already exists`);
          existingCollections.set(scopeName, new Set());
        } else {
          console.error(`   ❌ Error: ${err.message}`);
          continue;
        }
      }
    }

    // Create collections
    const scopeColls = existingCollections.get(scopeName) || new Set();

    for (const collName of scopeConfig.collections) {
      if (scopeColls.has(collName)) {
        console.log(`   📄 Collection "${collName}" already exists`);
      } else {
        console.log(`   📄 Creating collection "${collName}"...`);
        try {
          await collMgr.createCollection({
            name: collName,
            scopeName: scopeName,
          });
          console.log(`      ✓ Created`);
        } catch (err: any) {
          if (err.message?.includes('already exists')) {
            console.log(`      ✓ Already exists`);
          } else {
            console.error(`      ❌ Error: ${err.message}`);
          }
        }
      }
    }
  }

  console.log('\n✅ Migration complete!\n');

  // Verify by listing all scopes
  console.log('📋 Current schema:');
  const finalScopes = await collMgr.getAllScopes();
  for (const scope of finalScopes) {
    if (SCHEMA.some((s) => s.name === scope.name)) {
      console.log(`   📁 ${scope.name}`);
      for (const coll of scope.collections) {
        console.log(`      📄 ${coll.name}`);
      }
    }
  }

  await cluster.close();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
