import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { IKmsEncryption } from './couchbase-credential-store.js';

/**
 * AWS KMS encryption implementation for Couchbase credential store
 */
export class AwsKmsEncryption implements IKmsEncryption {
  private kmsClient: KMSClient;

  constructor(region?: string) {
    this.kmsClient = new KMSClient({
      region: region || process.env['AWS_REGION'] || 'us-east-1',
    });
  }

  /**
   * Encrypt plaintext using AWS KMS
   * @param plaintext The text to encrypt
   * @param keyId The KMS key ID or ARN
   * @returns Base64-encoded ciphertext blob
   */
  async encrypt(plaintext: string, keyId: string): Promise<string> {
    const command = new EncryptCommand({
      KeyId: keyId,
      Plaintext: Buffer.from(plaintext, 'utf-8'),
    });

    const response = await this.kmsClient.send(command);

    if (!response.CiphertextBlob) {
      throw new Error('KMS encryption failed: no ciphertext returned');
    }

    // Return base64-encoded ciphertext
    return Buffer.from(response.CiphertextBlob).toString('base64');
  }

  /**
   * Decrypt ciphertext using AWS KMS
   * @param ciphertext Base64-encoded ciphertext blob
   * @returns Decrypted plaintext
   */
  async decrypt(ciphertext: string): Promise<string> {
    const command = new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    });

    const response = await this.kmsClient.send(command);

    if (!response.Plaintext) {
      throw new Error('KMS decryption failed: no plaintext returned');
    }

    return Buffer.from(response.Plaintext).toString('utf-8');
  }
}
