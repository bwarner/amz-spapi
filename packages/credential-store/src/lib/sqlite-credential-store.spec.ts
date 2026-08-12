import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteCredentialStore } from './sqlite-credential-store';
import type { AmazonCredentialProfile } from '@farvisionllc/models';

/**
 * The key must NOT depend on machine identity.
 *
 * The original design derived it from `hostname-username`, and macOS rewrites
 * the hostname from the network: unplugging an Ethernet cable renamed the
 * machine and made every stored credential undecryptable (seen live). The fix
 * is a random key file beside the database; these tests pin the file, the
 * one-way migration of legacy rows, and the error a truly dead row produces.
 */

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cred-store-'));
}

function profile(
  overrides: Partial<AmazonCredentialProfile> = {}
): AmazonCredentialProfile {
  return {
    profile_name: 'default',
    api_type: 'SP_API',
    client_id: 'amzn1.application-oa2-client.test',
    client_secret: 'shh-client-secret',
    refresh_token: 'Atzr|refresh-token',
    marketplace_id: 'ATVPDKIKX0DER',
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

/** Encrypt a row exactly the way the pre-key-file versions did. */
function legacyEncrypt(machineInfo: string, data: string) {
  const keySource = crypto
    .createHash('sha256')
    .update(machineInfo)
    .digest('hex');
  const key = crypto.scryptSync(keySource, 'amazon-seller-assistant-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function insertLegacyRow(dir: string, machineInfo: string): void {
  // Let the store create the schema, then plant a legacy-encrypted row the
  // way an old version would have left it.
  const setup = new Database(path.join(dir, 'credentials.db'));
  const secrets = legacyEncrypt(
    machineInfo,
    JSON.stringify({
      client_secret: 'legacy-secret',
      refresh_token: 'legacy-refresh',
    })
  );
  setup
    .prepare(
      `INSERT INTO profiles (
         profile_name, api_type, client_id, encrypted_secrets, secrets_iv,
         secrets_auth_tag, marketplace_id, created_at, updated_at
       ) VALUES ('default', 'SP_API', 'client', ?, ?, ?, 'ATVPDKIKX0DER', 1, 1)`
    )
    .run(secrets.encrypted, secrets.iv, secrets.authTag);
  setup.close();
}

describe('SqliteCredentialStore key handling', () => {
  it('round-trips a profile and creates an owner-only key file', async () => {
    const dir = tempDir();
    const store = new SqliteCredentialStore(undefined, dir);
    await store.setProfile(profile());

    const read = await store.getProfile('default', 'SP_API');
    expect(read?.client_secret).toBe('shh-client-secret');
    expect(read?.refresh_token).toBe('Atzr|refresh-token');

    const keyPath = path.join(dir, 'store.key');
    expect(fs.readFileSync(keyPath, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it('survives a hostname change: a second store instance reads what the first wrote', async () => {
    // With the machine-derived key this was the failing case — nothing about
    // the key file involves the hostname, so a rename cannot matter.
    const dir = tempDir();
    await new SqliteCredentialStore(undefined, dir).setProfile(profile());

    const reopened = new SqliteCredentialStore(undefined, dir);
    const read = await reopened.getProfile('default', 'SP_API');
    expect(read?.refresh_token).toBe('Atzr|refresh-token');
  });

  it('migrates a row the legacy machine key can still read, one way', async () => {
    const dir = tempDir();
    // Create schema (and key file) first, then plant the legacy row.
    new SqliteCredentialStore(undefined, dir);
    insertLegacyRow(dir, `${os.hostname()}-${os.userInfo().username}`);

    // A fresh construction migrates it under the key file…
    const store = new SqliteCredentialStore(undefined, dir);
    const read = await store.getProfile('default', 'SP_API');
    expect(read?.refresh_token).toBe('legacy-refresh');

    // …verifiably: the row now decrypts with the key file's key alone.
    const key = Buffer.from(
      fs.readFileSync(path.join(dir, 'store.key'), 'utf8').trim(),
      'hex'
    );
    const row = new Database(path.join(dir, 'credentials.db'))
      .prepare(
        `SELECT encrypted_secrets, secrets_iv, secrets_auth_tag FROM profiles`
      )
      .get() as {
      encrypted_secrets: string;
      secrets_iv: string;
      secrets_auth_tag: string;
    };
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(row.secrets_iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(row.secrets_auth_tag, 'hex'));
    const plain =
      decipher.update(row.encrypted_secrets, 'hex', 'utf8') +
      decipher.final('utf8');
    expect(JSON.parse(plain).refresh_token).toBe('legacy-refresh');
  });

  it('explains a row saved under a hostname that is gone, instead of a crypto error', async () => {
    const dir = tempDir();
    new SqliteCredentialStore(undefined, dir);
    insertLegacyRow(dir, 'some-other-hostname-someone');

    const store = new SqliteCredentialStore(undefined, dir);
    await expect(store.getProfile('default', 'SP_API')).rejects.toThrow(
      /Re-add them with `credentials add`/
    );
  });

  it('still honours an explicit password, unchanged', async () => {
    const dir = tempDir();
    await new SqliteCredentialStore('hunter2', dir).setProfile(profile());

    const right = new SqliteCredentialStore('hunter2', dir);
    expect((await right.getProfile('default', 'SP_API'))?.client_secret).toBe(
      'shh-client-secret'
    );

    const wrong = new SqliteCredentialStore('wrong', dir);
    await expect(wrong.getProfile('default', 'SP_API')).rejects.toThrow();
  });
});
