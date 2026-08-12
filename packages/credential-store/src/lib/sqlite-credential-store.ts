import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AmazonApiType,
  AmazonCredentialProfile,
  AmazonCredentialProfileSchema,
  ICredentialRepository,
} from '@farvisionllc/models';

const CREDENTIALS_DIR = path.join(os.homedir(), '.amazon-seller-assistant');
const KEY_FILE = 'store.key';
const ALGORITHM = 'aes-256-gcm';

/**
 * SQLite-based credential store for CLI tools
 * Stores credentials locally with encryption for sensitive fields
 */
export class SqliteCredentialStore implements ICredentialRepository {
  private db: Database.Database;
  private encryptionKey: Buffer;
  private readonly dir: string;

  constructor(password?: string, dir?: string) {
    this.dir = dir ?? CREDENTIALS_DIR;
    this.ensureCredentialsDir();
    this.db = new Database(path.join(this.dir, 'credentials.db'));
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.initializeSchema();
    if (password) {
      this.encryptionKey = crypto.scryptSync(
        password,
        'amazon-seller-assistant-salt',
        32
      );
    } else {
      this.encryptionKey = this.loadOrCreateKeyFile();
      // Rows written by older versions were encrypted under a key derived
      // from the HOSTNAME, which macOS rewrites whenever the network changes
      // — unplugging an Ethernet cable made credentials undecryptable. Any
      // row still readable under that legacy key is re-encrypted under the
      // key file now, while the machine identity that can read it is present.
      this.migrateLegacyRows();
    }
  }

  /**
   * The encryption key lives in a file beside the database, created once from
   * randomness. Deliberately NOT derived from machine identity: a key that
   * moves with the hostname dies with it. File permissions (0600, in a 0700
   * directory) are the protection — the same model as an SSH private key.
   */
  private loadOrCreateKeyFile(): Buffer {
    const keyPath = path.join(this.dir, KEY_FILE);
    try {
      const key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
      if (key.length === 32) return key;
      throw new Error(
        `${keyPath} is corrupt (expected 64 hex characters). Delete it and ` +
          're-add credentials, or restore it from a backup.'
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('hex') + '\n', { mode: 0o600 });
    return key;
  }

  /**
   * The key the pre-key-file versions derived. Kept ONLY so their rows can be
   * converted one way; nothing is ever written under it again.
   */
  private legacyMachineKey(): Buffer {
    const machineInfo = `${os.hostname()}-${os.userInfo().username}`;
    const keySource = crypto
      .createHash('sha256')
      .update(machineInfo)
      .digest('hex');
    return crypto.scryptSync(keySource, 'amazon-seller-assistant-salt', 32);
  }

  /** Re-encrypt any row the legacy machine key can still read. */
  private migrateLegacyRows(): void {
    const rows = this.db
      .prepare(
        `SELECT profile_name, api_type, encrypted_secrets, secrets_iv,
                secrets_auth_tag FROM profiles`
      )
      .all() as Array<{
      profile_name: string;
      api_type: string;
      encrypted_secrets: string;
      secrets_iv: string;
      secrets_auth_tag: string;
    }>;
    if (!rows.length) return;

    let legacy: Buffer | undefined;
    const update = this.db.prepare(
      `UPDATE profiles SET encrypted_secrets = ?, secrets_iv = ?,
              secrets_auth_tag = ? WHERE profile_name = ? AND api_type = ?`
    );
    for (const row of rows) {
      if (
        this.tryDecrypt(
          this.encryptionKey,
          row.encrypted_secrets,
          row.secrets_iv,
          row.secrets_auth_tag
        ) !== undefined
      ) {
        continue; // Already on the current key.
      }
      legacy ??= this.legacyMachineKey();
      const plain = this.tryDecrypt(
        legacy,
        row.encrypted_secrets,
        row.secrets_iv,
        row.secrets_auth_tag
      );
      if (plain === undefined) continue; // Unreadable here; reported on use.
      const { encrypted, iv, authTag } = this.encrypt(plain);
      update.run(encrypted, iv, authTag, row.profile_name, row.api_type);
    }
  }

  private tryDecrypt(
    key: Buffer,
    encrypted: string,
    ivHex: string,
    authTagHex: string
  ): string | undefined {
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(ivHex, 'hex')
      );
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return undefined;
    }
  }

  private ensureCredentialsDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { mode: 0o700, recursive: true });
    }
  }

  /**
   * Create database schema
   * For CLI, user_id is always null (single-user mode)
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        profile_name TEXT NOT NULL,
        api_type TEXT NOT NULL,

        -- LWA OAuth (encrypted fields stored as JSON)
        client_id TEXT NOT NULL,
        encrypted_secrets TEXT NOT NULL, -- {client_secret, refresh_token, access_token}
        secrets_iv TEXT NOT NULL,
        secrets_auth_tag TEXT NOT NULL,

        access_token_expires_at INTEGER,

        -- Amazon identifiers
        marketplace_id TEXT NOT NULL,
        region TEXT,
        seller_id TEXT,
        advertiser_profile_id TEXT,

        -- Metadata
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,

        PRIMARY KEY (profile_name, api_type)
      );

      CREATE TABLE IF NOT EXISTS default_profiles (
        api_type TEXT NOT NULL PRIMARY KEY,
        profile_name TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_api
        ON profiles(api_type);
    `);
  }

  /**
   * Encrypt sensitive fields
   */
  private encrypt(data: string): {
    encrypted: string;
    iv: string;
    authTag: string;
  } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt sensitive fields
   */
  private decrypt(
    encrypted: string,
    ivHex: string,
    authTagHex: string
  ): string {
    const plain = this.tryDecrypt(
      this.encryptionKey,
      encrypted,
      ivHex,
      authTagHex
    );
    if (plain === undefined) {
      // The raw crypto error ("Unsupported state or unable to authenticate
      // data") reads as corruption. Say what actually happened and what to do.
      throw new Error(
        'Stored credentials could not be decrypted with the current key. ' +
          'They were saved by an older version under a hostname-derived key ' +
          'on a machine identity that is no longer present. Re-add them with ' +
          '`credentials add` — new credentials use a stable key file and do ' +
          'not have this problem.'
      );
    }
    return plain;
  }

  async setProfile(profile: AmazonCredentialProfile): Promise<void> {
    // Validate with Zod
    const validated = AmazonCredentialProfileSchema.parse(profile);

    // Encrypt sensitive fields
    const secrets = {
      client_secret: validated.client_secret,
      refresh_token: validated.refresh_token,
      access_token: validated.access_token,
    };
    const { encrypted, iv, authTag } = this.encrypt(JSON.stringify(secrets));

    // Upsert into database (ignore user_id for CLI single-user mode)
    const stmt = this.db.prepare(`
      INSERT INTO profiles (
        profile_name, api_type,
        client_id, encrypted_secrets, secrets_iv, secrets_auth_tag,
        access_token_expires_at,
        marketplace_id, region, seller_id, advertiser_profile_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_name, api_type)
      DO UPDATE SET
        client_id = excluded.client_id,
        encrypted_secrets = excluded.encrypted_secrets,
        secrets_iv = excluded.secrets_iv,
        secrets_auth_tag = excluded.secrets_auth_tag,
        access_token_expires_at = excluded.access_token_expires_at,
        marketplace_id = excluded.marketplace_id,
        region = excluded.region,
        seller_id = excluded.seller_id,
        advertiser_profile_id = excluded.advertiser_profile_id,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      validated.profile_name,
      validated.api_type,
      validated.client_id,
      encrypted,
      iv,
      authTag,
      validated.access_token_expires_at || null,
      validated.marketplace_id,
      validated.region || null,
      validated.seller_id || null,
      validated.advertiser_profile_id || null,
      validated.created_at,
      validated.updated_at
    );

    // Set as default if it's the first profile for this API type
    const profileCount = this.db
      .prepare(`SELECT COUNT(*) as count FROM profiles WHERE api_type = ?`)
      .get(validated.api_type) as { count: number };

    if (profileCount.count === 1) {
      await this.setDefaultProfile(validated.profile_name, validated.api_type);
    }
  }

  async getProfile(
    profileName: string,
    apiType: AmazonApiType,
    _userId?: string // Ignored: this store is single-user (CLI)
  ): Promise<AmazonCredentialProfile | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM profiles
      WHERE profile_name = ? AND api_type = ?
    `);

    const row = stmt.get(profileName, apiType) as any;

    if (!row) {
      return null;
    }

    // Decrypt sensitive fields
    const secrets = JSON.parse(
      this.decrypt(row.encrypted_secrets, row.secrets_iv, row.secrets_auth_tag)
    );

    return AmazonCredentialProfileSchema.parse({
      profile_name: row.profile_name,
      api_type: row.api_type,
      ...(row.user_id && { user_id: row.user_id }),
      client_id: row.client_id,
      client_secret: secrets.client_secret,
      ...(secrets.refresh_token && { refresh_token: secrets.refresh_token }),
      ...(secrets.access_token && { access_token: secrets.access_token }),
      ...(row.access_token_expires_at && {
        access_token_expires_at: row.access_token_expires_at,
      }),
      marketplace_id: row.marketplace_id,
      ...(row.region && { region: row.region }),
      ...(row.seller_id && { seller_id: row.seller_id }),
      ...(row.advertiser_profile_id && {
        advertiser_profile_id: row.advertiser_profile_id,
      }),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  async updateAccessToken(
    profileName: string,
    apiType: AmazonApiType,
    accessToken: string,
    expiresIn: number,
    userId?: string
  ): Promise<void> {
    // Get existing profile to preserve other secrets
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile) {
      throw new Error(`Profile ${profileName} (${apiType}) not found`);
    }

    // Update the profile with new token
    profile.access_token = accessToken;
    profile.access_token_expires_at = Date.now() + expiresIn * 1000;
    profile.updated_at = Date.now();

    await this.setProfile(profile);
  }

  async isTokenExpired(
    profileName: string,
    apiType: AmazonApiType,
    userId?: string
  ): Promise<boolean> {
    const profile = await this.getProfile(profileName, apiType, userId);
    if (!profile?.access_token_expires_at) {
      return true;
    }

    const bufferTime = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= profile.access_token_expires_at - bufferTime;
  }

  async listProfiles(
    apiType?: AmazonApiType,
    _userId?: string // Ignored: this store is single-user (CLI)
  ): Promise<string[]> {
    let query = 'SELECT DISTINCT profile_name FROM profiles WHERE 1=1';
    const params: any[] = [];

    if (apiType) {
      query += ' AND api_type = ?';
      params.push(apiType);
    }

    query += ' ORDER BY profile_name';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as { profile_name: string }[];
    return rows.map((r) => r.profile_name);
  }

  async getDefaultProfile(
    apiType: AmazonApiType,
    _userId?: string // Ignored: this store is single-user (CLI)
  ): Promise<string | null> {
    const stmt = this.db.prepare(`
      SELECT profile_name FROM default_profiles WHERE api_type = ?
    `);

    const row = stmt.get(apiType) as { profile_name: string } | undefined;
    return row?.profile_name || null;
  }

  async setDefaultProfile(
    profileName: string,
    apiType: AmazonApiType,
    _userId?: string // Ignored: this store is single-user (CLI)
  ): Promise<void> {
    // Verify profile exists
    const profile = await this.getProfile(profileName, apiType);
    if (!profile) {
      throw new Error(`Profile ${profileName} (${apiType}) not found`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO default_profiles (api_type, profile_name)
      VALUES (?, ?)
      ON CONFLICT(api_type)
      DO UPDATE SET profile_name = excluded.profile_name
    `);

    stmt.run(apiType, profileName);
  }

  async deleteProfile(
    profileName: string,
    apiType: AmazonApiType,
    _userId?: string // Ignored: this store is single-user (CLI)
  ): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM profiles
      WHERE profile_name = ? AND api_type = ?
    `);

    stmt.run(profileName, apiType);

    // Clear default if this was the default profile
    const defaultProfile = await this.getDefaultProfile(apiType);
    if (defaultProfile === profileName) {
      const deleteDefault = this.db.prepare(`
        DELETE FROM default_profiles WHERE api_type = ?
      `);
      deleteDefault.run(apiType);

      // Set a new default if other profiles exist
      const remaining = await this.listProfiles(apiType);
      if (remaining.length > 0) {
        await this.setDefaultProfile(remaining[0], apiType);
      }
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
