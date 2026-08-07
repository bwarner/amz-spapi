import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import {
  credentialEncryptionContext,
  type CredentialContext,
  type CredentialSecrets,
} from '@farvisionllc/models';

/**
 * Unwrapping stored seller credentials, inside the function that owns them (#55).
 *
 * This is the whole point of the slice. The ciphertext has always been inert
 * without a KMS grant; what changes here is WHERE the grant lives. Until now the
 * Vercel runtime held it, so a plaintext refresh token existed there on every
 * request that touched a connection. Now the grant is on this function's role
 * and nowhere else, and the plaintext exists only for the moment it takes to
 * exchange it at Amazon.
 *
 * The context builder is imported rather than written here on purpose — see
 * `credentialEncryptionContext`. Two copies would agree until one was edited.
 */

/**
 * Module scope, and the exception that proves the rule in `aws-secrets`.
 *
 * A KMS *client* is not a secret and holds nothing per-user: it is a signer and
 * an HTTP connection pool, so reusing it across callers hands the second caller
 * nothing the first had. Decrypted secrets are never cached anywhere.
 */
let client: KMSClient | undefined;

function kms(): KMSClient {
  // No explicit credentials: the function's execution role is the grant, which
  // is the entire security argument for moving this here.
  client ??= new KMSClient({});
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
      'KMS_CREDENTIAL_KEY_ID is not set, so credentials cannot be re-encrypted. ' +
        'It is the CredentialsKeyAlias output of the credentials-key stack, ' +
        'e.g. alias/sellavant-dev-credentials.'
    );
  }
  return configured;
}

export async function decryptSecrets(
  ciphertext: string,
  context: CredentialContext
): Promise<CredentialSecrets> {
  const response = await kms().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      // No key id: KMS records which key — and which rotation of it — produced
      // the ciphertext, so rotation needs no re-encrypt step and no bookkeeping.
      EncryptionContext: credentialEncryptionContext(context),
    })
  );

  if (!response.Plaintext) {
    throw new Error('KMS returned no plaintext.');
  }

  return JSON.parse(
    Buffer.from(response.Plaintext).toString('utf-8')
  ) as CredentialSecrets;
}

export async function encryptSecrets(
  secrets: CredentialSecrets,
  context: CredentialContext
): Promise<string> {
  const response = await kms().send(
    new EncryptCommand({
      KeyId: keyId(),
      Plaintext: Buffer.from(JSON.stringify(secrets), 'utf-8'),
      EncryptionContext: credentialEncryptionContext(context),
    })
  );

  if (!response.CiphertextBlob) {
    throw new Error('KMS returned no ciphertext.');
  }

  return Buffer.from(response.CiphertextBlob).toString('base64');
}
