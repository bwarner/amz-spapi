import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { awsCredentials } from './aws-credentials';

/**
 * Envelope for the secret fields of a credential profile (#11).
 *
 * LWA refresh tokens are long-lived and grant access to a seller's Amazon
 * account, so they must not sit in Couchbase in a form that is useful to
 * whoever reads the database. Encrypting under KMS separates the two
 * authorisations: the ciphertext is inert without an AWS principal permitted to
 * decrypt, which Couchbase neither holds nor knows about.
 *
 * All three secrets travel as one JSON blob rather than three ciphertexts, so a
 * read costs one KMS call instead of three. They are always written and read
 * together, so there is nothing to gain from separating them.
 */

/** The fields never written in the clear. */
export type CredentialSecrets = {
  client_secret: string;
  refresh_token?: string;
  access_token?: string;
};

/**
 * What the ciphertext is bound to.
 *
 * Passed to KMS as the encryption context, which is authenticated but not
 * secret: decryption fails unless the same context is supplied. That makes a
 * ciphertext non-transferable. Without it, anyone who can write to Couchbase
 * could copy another seller's `encrypted_secrets` into their own profile
 * document and the store would decrypt it for them — the data would be
 * encrypted and still stolen. The binding costs nothing and closes that.
 */
export type CredentialContext = {
  userId?: string;
  apiType: string;
  profileName: string;
};

/** Non-secret, stable, and identical on the encrypt and decrypt paths. */
function encryptionContext(context: CredentialContext): Record<string, string> {
  return {
    // Matches the document key's own notion of an absent user, so a profile
    // saved before sign-in still decrypts.
    userId: context.userId || 'default',
    apiType: context.apiType,
    profileName: context.profileName,
    purpose: 'amazon-credential',
  };
}

let client: KMSClient | null = null;

function kms(): KMSClient {
  client ??= new KMSClient({
    region: process.env['AWS_REGION'] || 'us-east-1',
    credentials: awsCredentials(),
  });
  return client;
}

/**
 * The configured key.
 *
 * Required to encrypt and deliberately un-defaulted: a fallback would mean a
 * misconfigured deployment silently writing under the wrong key, or worse,
 * appearing to work while writing something nothing else can read.
 */
function keyId(): string {
  const configured = process.env['KMS_CREDENTIAL_KEY_ID'];
  if (!configured) {
    throw new Error(
      'KMS_CREDENTIAL_KEY_ID is not set, so credentials cannot be encrypted. ' +
        'Use the CredentialsKeyAlias output of the credentials-key stack, e.g. ' +
        'alias/sellavant-dev-credentials.'
    );
  }
  return configured;
}

export async function encryptSecrets(
  secrets: CredentialSecrets,
  context: CredentialContext
): Promise<string> {
  const response = await kms().send(
    new EncryptCommand({
      KeyId: keyId(),
      Plaintext: Buffer.from(JSON.stringify(secrets), 'utf-8'),
      EncryptionContext: encryptionContext(context),
    })
  );

  if (!response.CiphertextBlob) {
    throw new Error('KMS returned no ciphertext.');
  }

  return Buffer.from(response.CiphertextBlob).toString('base64');
}

/**
 * The secrets back.
 *
 * No key id: KMS records which key — and which rotation of it — produced the
 * ciphertext, so rotation needs no re-encrypt step and no bookkeeping here.
 * That is the whole of "key rotation supported".
 */
export async function decryptSecrets(
  ciphertext: string,
  context: CredentialContext
): Promise<CredentialSecrets> {
  const response = await kms().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      EncryptionContext: encryptionContext(context),
    })
  );

  if (!response.Plaintext) {
    throw new Error('KMS returned no plaintext.');
  }

  return JSON.parse(
    Buffer.from(response.Plaintext).toString('utf-8')
  ) as CredentialSecrets;
}

/** Whether encryption is configured, for the migration script's pre-flight. */
export function isEncryptionConfigured(): boolean {
  return Boolean(process.env['KMS_CREDENTIAL_KEY_ID']);
}
