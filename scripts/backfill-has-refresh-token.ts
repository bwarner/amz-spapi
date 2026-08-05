#!/usr/bin/env node
/**
 * Record on each credential profile whether it holds a refresh token (#55).
 *
 * ONE-TIME. Profiles written before #55 carry no `has_refresh_token`, and the
 * credentials Lambda deliberately reports the state as UNKNOWN rather than
 * guessing — a wrong `false` shows a working connection as broken, a wrong
 * `true` sends the user into a flow that fails at Amazon.
 *
 * The flag is stored in the clear on purpose. A caller needs to know whether a
 * connection is usable, and the alternative is decrypting every profile to
 * answer a yes/no. **The fact that a secret exists is not the secret.**
 *
 * Reading it requires KMS, which is why this runs here and not in the Lambda:
 * the credentials function holds no KMS grant, by design.
 *
 *   npx tsx --env-file=apps/web/.env.local scripts/backfill-has-refresh-token.ts
 *   npx tsx --env-file=apps/web/.env.local scripts/backfill-has-refresh-token.ts --apply
 *
 * Dry by default. `--apply` writes.
 *
 * IDEMPOTENT: profiles that already carry the flag are skipped, so a partial
 * run can simply be repeated. Once every environment is migrated this file has
 * no remaining purpose and should be deleted rather than kept as documentation
 * of a move that already happened.
 *
 * Env: CB_DATA_API_URL, CB_USERNAME, CB_PASSWORD, CB_BUCKET, CB_SCOPE,
 *      plus AWS credentials able to Decrypt with the credentials KMS key.
 */
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import {
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  CREDENTIALS_COLLECTION,
  CREDENTIALS_DOMAIN,
  credentialDocKey,
  type AmazonApiType,
  type StoredCredentialProfile,
} from '@farvisionllc/models';

const APPLY = process.argv.includes('--apply');
const kms = new KMSClient({ region: process.env['AWS_REGION'] || 'us-east-1' });

/**
 * Must match `encryptionContext()` in apps/web/src/lib/credential-encryption.ts
 * exactly. KMS authenticates it, so a mismatch fails the decrypt outright
 * rather than returning wrong plaintext — which is the good failure mode, but
 * it does mean this is a second copy of a contract that has to stay in step.
 */
function encryptionContext(profile: StoredCredentialProfile) {
  return {
    userId: profile.user_id || 'default',
    apiType: profile.api_type,
    profileName: profile.profile_name,
    purpose: 'amazon-credential',
  };
}

/** True when the encrypted blob holds a non-empty refresh token. */
async function hasRefreshToken(
  profile: StoredCredentialProfile
): Promise<boolean> {
  const result = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(profile.encrypted_secrets, 'base64'),
      EncryptionContext: encryptionContext(profile),
    })
  );

  // Scoped as tightly as possible: the plaintext exists only long enough to
  // answer a boolean, and nothing derived from it is returned or logged.
  const secrets = JSON.parse(
    Buffer.from(result.Plaintext as Uint8Array).toString('utf8')
  ) as { refresh_token?: string };

  return Boolean(secrets.refresh_token);
}

async function main() {
  const scope = process.env['CB_SCOPE'];
  console.log(
    `scope ${scope} — ${
      APPLY ? 'APPLYING' : 'dry run, nothing will be written'
    }\n`
  );

  const { rows } = await executeQuery<StoredCredentialProfile>(
    CREDENTIALS_DOMAIN,
    `SELECT p.* FROM \`${CREDENTIALS_DOMAIN}_${CREDENTIALS_COLLECTION}\` AS p
      WHERE p.api_type IS NOT MISSING
        AND p.\`deleted\` IS MISSING`
  );

  const pending = rows.filter((p) => typeof p.has_refresh_token !== 'boolean');
  console.log(
    `${rows.length} profiles, ${
      rows.length - pending.length
    } already flagged, ${pending.length} to do\n`
  );

  let withToken = 0;
  let without = 0;
  let failed = 0;

  for (const profile of pending) {
    const key = credentialDocKey(
      profile.profile_name,
      profile.api_type as AmazonApiType,
      profile.user_id
    );

    let flag: boolean;
    try {
      flag = await hasRefreshToken(profile);
    } catch (error) {
      // Named, not swallowed. A profile that cannot be decrypted keeps its
      // absent flag and stays reported as UNKNOWN, which is the honest state.
      failed++;
      console.log(
        `  SKIP  ${profile.profile_name.slice(0, 52).padEnd(52)} ` +
          `${(error as Error).name}: ${(error as Error).message.slice(0, 60)}`
      );
      continue;
    }

    if (flag) withToken++;
    else without++;
    console.log(
      `  ${flag ? 'HAS  ' : 'NONE '} ${profile.profile_name
        .slice(0, 52)
        .padEnd(52)} ${profile.api_type}`
    );

    if (!APPLY) continue;

    // Re-read before writing rather than reusing the query row: `SELECT p.*`
    // is a projection and a document could have changed since. This is a
    // read-modify-write on a document with no concurrent writer during a
    // migration, but re-reading keeps the window as small as it can be without
    // a CAS helper.
    const current = await getDocument<StoredCredentialProfile>(
      CREDENTIALS_DOMAIN,
      CREDENTIALS_COLLECTION,
      key
    );
    if (!current) {
      failed++;
      console.log(`  SKIP  ${key} vanished between query and write`);
      continue;
    }

    await upsertDocument(CREDENTIALS_DOMAIN, CREDENTIALS_COLLECTION, key, {
      ...current,
      has_refresh_token: flag,
    });
  }

  console.log(
    `\n${withToken} with a refresh token, ${without} without` +
      (failed ? `, ${failed} skipped` : '')
  );
  if (!APPLY && pending.length) {
    console.log('\nRe-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(`\nfailed: ${(error as Error).message}`);
  process.exit(1);
});
