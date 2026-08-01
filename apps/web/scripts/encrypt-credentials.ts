#!/usr/bin/env node
/**
 * One-way conversion of stored credentials to KMS ciphertext (#11).
 *
 * Run once per environment, after deploying the credentials-key stack and
 * before deploying the application that reads these documents. It is not a
 * compatibility layer and there is no reverse: the store reads `encrypted_secrets`
 * and nothing else, so a profile this misses stops working loudly rather than
 * silently continuing to serve plaintext.
 *
 * Idempotent. A document that already has `encrypted_secrets` is left alone, so
 * a partial run can simply be repeated.
 *
 * Usage:
 *   npx tsx apps/web/scripts/encrypt-credentials.ts                # plan (default)
 *   npx tsx apps/web/scripts/encrypt-credentials.ts --apply
 *   npx tsx apps/web/scripts/encrypt-credentials.ts --verify       # exit 1 if any plaintext remains
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET, CB_SCOPE,
 *      KMS_CREDENTIAL_KEY_ID, AWS_REGION
 *   set -a && . apps/web/.env.local && set +a
 */

import {
  collectionName,
  executeQuery,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  encryptSecrets,
  isEncryptionConfigured,
} from '../src/lib/credential-encryption.js';

const DOMAIN = 'credentials';
const COLLECTION = 'profiles';

/** Anything holding a secret in the clear. */
const PLAINTEXT_FIELDS = [
  'client_secret',
  'refresh_token',
  'access_token',
] as const;

type StoredDoc = {
  id: string;
  profile_name?: string;
  api_type?: string;
  user_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
  encrypted_secrets?: string;
  [key: string]: unknown;
};

async function allProfiles(): Promise<StoredDoc[]> {
  const { rows } = await executeQuery<StoredDoc>(
    DOMAIN,
    `SELECT META(p).id AS id, p.*
     FROM \`${collectionName(DOMAIN, COLLECTION)}\` p`
  );
  return rows;
}

/**
 * Whether this document is a credential profile at all.
 *
 * The collection also holds `DEFAULT::…` pointers, which are a profile name and
 * nothing else. They carry no secret and must not be rewritten.
 */
function isProfile(doc: StoredDoc): boolean {
  return Boolean(doc.profile_name && doc.api_type);
}

function hasPlaintext(doc: StoredDoc): boolean {
  return PLAINTEXT_FIELDS.some((field) => typeof doc[field] === 'string');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const verifyOnly = process.argv.includes('--verify');

  const docs = await allProfiles();
  const profiles = docs.filter(isProfile);
  const pointers = docs.length - profiles.length;
  const plaintext = profiles.filter(hasPlaintext);
  const encrypted = profiles.filter(
    (d) => d.encrypted_secrets && !hasPlaintext(d)
  );

  console.log(
    `${docs.length} documents: ${profiles.length} profiles ` +
      `(${encrypted.length} already encrypted, ${plaintext.length} with plaintext), ` +
      `${pointers} default-pointers.`
  );

  if (verifyOnly) {
    for (const doc of plaintext) {
      console.error(
        `  PLAINTEXT ${doc.id}: ${PLAINTEXT_FIELDS.filter(
          (f) => typeof doc[f] === 'string'
        ).join(', ')}`
      );
    }
    if (plaintext.length) {
      console.error(`\n${plaintext.length} document(s) still hold plaintext.`);
      process.exit(1);
    }
    console.log('\nNo plaintext credentials remain.');
    return;
  }

  if (!plaintext.length) {
    console.log('Nothing to convert.');
    return;
  }

  if (!isEncryptionConfigured()) {
    console.error(
      '\nKMS_CREDENTIAL_KEY_ID is not set. Deploy the credentials-key stack and ' +
        'use its CredentialsKeyAlias output.'
    );
    process.exit(1);
  }

  for (const doc of plaintext) {
    if (!doc.client_secret) {
      // The schema requires it, so its absence means this document is not what
      // it claims to be. Encrypting a partial secret set would lose the rest.
      console.error(`  SKIP ${doc.id}: no client_secret to encrypt.`);
      continue;
    }

    if (!apply) {
      console.log(`  would convert ${doc.id}`);
      continue;
    }

    const { client_secret, refresh_token, access_token, id, ...metadata } = doc;

    // Every plaintext field is dropped by construction: the rewritten document
    // is built from `metadata`, which the destructuring above already excludes
    // them from.
    await upsertDocument(DOMAIN, COLLECTION, id, {
      ...metadata,
      encrypted_secrets: await encryptSecrets(
        { client_secret, refresh_token, access_token },
        {
          userId: doc.user_id,
          apiType: doc.api_type as string,
          profileName: doc.profile_name as string,
        }
      ),
    });

    console.log(`  converted ${id}`);
  }

  console.log(
    apply
      ? `\nConverted ${plaintext.length}. Re-run with --verify to confirm.`
      : `\n${plaintext.length} to convert. Re-run with --apply.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
