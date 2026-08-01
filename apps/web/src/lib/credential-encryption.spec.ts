import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These pin the shape of what we ask KMS for, not KMS itself.
 *
 * The property that matters is the encryption context: it is what stops a
 * ciphertext being moved from one seller's document to another's, and it is
 * invisible in the stored data, so nothing but a test will notice if it is
 * dropped.
 */

const send = vi.fn();

vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send = send;
  },
  EncryptCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DecryptCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

const secrets = {
  client_secret: 'shh',
  refresh_token: 'Atzr|refresh',
  access_token: 'Atza|access',
};

const context = {
  userId: 'auth0|abc',
  apiType: 'SP_API',
  profileName: 'default',
};

async function subject() {
  // Imported per test so the module-level KMS client and the env are fresh.
  return import('./credential-encryption');
}

describe('encryptSecrets', () => {
  beforeEach(() => {
    vi.resetModules();
    send.mockReset();
    process.env['KMS_CREDENTIAL_KEY_ID'] = 'alias/sellavant-dev-credentials';
  });

  it('refuses without a configured key rather than picking one', async () => {
    delete process.env['KMS_CREDENTIAL_KEY_ID'];
    const { encryptSecrets } = await subject();

    await expect(encryptSecrets(secrets, context)).rejects.toThrow(
      /KMS_CREDENTIAL_KEY_ID/
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('binds the ciphertext to the profile it belongs to', async () => {
    send.mockResolvedValue({ CiphertextBlob: Buffer.from('cipher') });
    const { encryptSecrets } = await subject();

    await encryptSecrets(secrets, context);

    expect(send.mock.calls[0][0].input.EncryptionContext).toEqual({
      userId: 'auth0|abc',
      apiType: 'SP_API',
      profileName: 'default',
      purpose: 'amazon-credential',
    });
  });

  it('treats an absent user the way the document key does', async () => {
    send.mockResolvedValue({ CiphertextBlob: Buffer.from('cipher') });
    const { encryptSecrets } = await subject();

    await encryptSecrets(secrets, { ...context, userId: undefined });

    expect(send.mock.calls[0][0].input.EncryptionContext.userId).toBe(
      'default'
    );
  });

  it('sends all three secrets as one payload, so a read costs one call', async () => {
    send.mockResolvedValue({ CiphertextBlob: Buffer.from('cipher') });
    const { encryptSecrets } = await subject();

    await encryptSecrets(secrets, context);

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(send.mock.calls[0][0].input.Plaintext.toString('utf-8'))
    ).toEqual(secrets);
  });

  it('returns base64, which is what the document stores', async () => {
    send.mockResolvedValue({ CiphertextBlob: Buffer.from('cipher') });
    const { encryptSecrets } = await subject();

    expect(await encryptSecrets(secrets, context)).toBe(
      Buffer.from('cipher').toString('base64')
    );
  });

  it('throws when KMS returns no ciphertext instead of storing undefined', async () => {
    send.mockResolvedValue({});
    const { encryptSecrets } = await subject();

    await expect(encryptSecrets(secrets, context)).rejects.toThrow(
      /no ciphertext/
    );
  });
});

describe('decryptSecrets', () => {
  beforeEach(() => {
    vi.resetModules();
    send.mockReset();
    process.env['KMS_CREDENTIAL_KEY_ID'] = 'alias/sellavant-dev-credentials';
  });

  it('supplies the same context, or KMS refuses', async () => {
    send.mockResolvedValue({
      Plaintext: Buffer.from(JSON.stringify(secrets)),
    });
    const { decryptSecrets } = await subject();

    await decryptSecrets('Y2lwaGVy', context);

    expect(send.mock.calls[0][0].input.EncryptionContext).toEqual({
      userId: 'auth0|abc',
      apiType: 'SP_API',
      profileName: 'default',
      purpose: 'amazon-credential',
    });
  });

  it('names no key, which is what makes rotation free', async () => {
    // KMS records the key and its rotation in the ciphertext, so decrypt needs
    // no key id and rotated data needs no re-encrypt step.
    send.mockResolvedValue({
      Plaintext: Buffer.from(JSON.stringify(secrets)),
    });
    const { decryptSecrets } = await subject();

    await decryptSecrets('Y2lwaGVy', context);

    expect(send.mock.calls[0][0].input.KeyId).toBeUndefined();
  });

  it('returns the secrets it was given', async () => {
    send.mockResolvedValue({
      Plaintext: Buffer.from(JSON.stringify(secrets)),
    });
    const { decryptSecrets } = await subject();

    expect(await decryptSecrets('Y2lwaGVy', context)).toEqual(secrets);
  });

  it('propagates a KMS refusal rather than returning empty secrets', async () => {
    // A mismatched context lands here. Swallowing it would turn "this
    // ciphertext is not yours" into "this profile has no token".
    send.mockRejectedValue(new Error('InvalidCiphertextException'));
    const { decryptSecrets } = await subject();

    await expect(decryptSecrets('Y2lwaGVy', context)).rejects.toThrow(
      /InvalidCiphertext/
    );
  });
});
