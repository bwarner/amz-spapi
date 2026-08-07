import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Disconnecting an Amazon account (#55, step 5).
 *
 * The property that matters is that the credential actually stops existing —
 * "we kept your Amazon refresh token after you told us to disconnect" is not a
 * defensible answer — and that one user cannot disconnect another's account.
 */

const getDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock('@amz-spapi/couchbase-utils', () => ({
  getDocument: (...args: unknown[]) => getDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

const { disconnect } = await import('./disconnect.js');

const SUBJECT = 'auth0|69cf4c211c2242f800bcec09';

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue(null);
  deleteDocument.mockReset().mockResolvedValue(true);
});

describe('the credential is destroyed, not tombstoned', () => {
  it('deletes the document keyed to the token subject', async () => {
    const result = await disconnect(SUBJECT, 'SP_API', 'sp-1');

    expect(result).toMatchObject({ ok: true, deleted: true });
    expect(deleteDocument).toHaveBeenCalledWith(
      'credentials',
      'profiles',
      `SP_API::${SUBJECT}::sp-1`
    );
  });

  it('never writes anything — a soft delete would keep the refresh token', async () => {
    await disconnect(SUBJECT, 'SP_API', 'sp-1');

    // The module has no upsert available to it at all. This asserts the choice
    // rather than the absence of a call: a tombstone still holds the secret.
    const calls = deleteDocument.mock.calls.map(([, , key]) => key);
    expect(calls).toContain(`SP_API::${SUBJECT}::sp-1`);
  });

  it('cannot be aimed at another user', async () => {
    // The key is built from the verified subject, so naming someone else's
    // profile deletes a key that does not exist.
    await disconnect('auth0|attacker', 'SP_API', 'sp-1');

    expect(deleteDocument.mock.calls[0][2]).toBe(
      'SP_API::auth0|attacker::sp-1'
    );
  });
});

describe('the default pointer', () => {
  it('is cleared when it named the profile just removed', async () => {
    // Otherwise it dangles, pointing at a connection that no longer exists.
    getDocument.mockResolvedValue({ profileName: 'sp-1' });

    const result = await disconnect(SUBJECT, 'SP_API', 'sp-1');

    expect(result).toMatchObject({ clearedDefault: true });
    expect(deleteDocument).toHaveBeenCalledWith(
      'credentials',
      'profiles',
      `DEFAULT::SP_API::${SUBJECT}`
    );
  });

  it('is left alone when it named a different profile', async () => {
    // A user with several connections keeps the default they chose.
    getDocument.mockResolvedValue({ profileName: 'sp-other' });

    const result = await disconnect(SUBJECT, 'SP_API', 'sp-1');

    expect(result).toMatchObject({ clearedDefault: false });
    expect(deleteDocument.mock.calls.map(([, , key]) => key)).not.toContain(
      `DEFAULT::SP_API::${SUBJECT}`
    );
  });
});

describe('repeating a disconnect', () => {
  it('succeeds when there was nothing to delete', async () => {
    // A double-click or a retried request must not surface an error: the caller
    // asked for it to be gone, and it is gone.
    deleteDocument.mockResolvedValue(false);

    expect(await disconnect(SUBJECT, 'SP_API', 'sp-1')).toEqual({
      ok: true,
      deleted: false,
      clearedDefault: false,
    });
  });
});
