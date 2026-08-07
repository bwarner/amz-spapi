import { deleteDocument, getDocument } from '@amz-spapi/couchbase-utils';
import {
  CREDENTIALS_COLLECTION,
  CREDENTIALS_DOMAIN,
  credentialDocKey,
  defaultProfileDocKey,
  type AmazonApiType,
} from '@farvisionllc/models';
import type { ServiceFailure } from './lwa.js';

/**
 * Disconnecting an Amazon account (#55, step 5).
 *
 * Here rather than in the BFF for the same reason as everything else in this
 * function: the document is the seller's credential, and the runtime that may
 * touch it is this one. The BFF asking "delete this connection" needs no access
 * to what it is deleting.
 *
 * **A real delete, not a tombstone.** The point of disconnecting is that the
 * refresh token stops existing — a soft-deleted document still holds it, and
 * "we kept your Amazon credential after you told us to disconnect" is not a
 * defensible answer. Reads already treat `deleted: true` as absent, so
 * tombstones written before this still behave; nothing new creates one.
 */

export type DisconnectResult =
  | { ok: true; deleted: boolean; clearedDefault: boolean }
  | { ok: false; failure: ServiceFailure };

export async function disconnect(
  userId: string,
  apiType: AmazonApiType,
  profileName: string
): Promise<DisconnectResult> {
  // Built from the verified subject, so a caller cannot name another user's
  // document however they spell the path.
  const key = credentialDocKey(profileName, apiType, userId);
  const deleted = await deleteDocument(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    key
  );

  // The default pointer is a separate document, so deleting the profile leaves
  // it dangling — pointing at a connection that no longer exists. Cleared only
  // when it named THIS profile: a user with several connections keeps the
  // default they chose.
  const defaultKey = defaultProfileDocKey(apiType, userId);
  const current = await getDocument<{ profileName?: string }>(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    defaultKey
  );

  let clearedDefault = false;
  if (current?.profileName === profileName) {
    await deleteDocument(
      CREDENTIALS_DOMAIN,
      CREDENTIALS_COLLECTION,
      defaultKey
    );
    clearedDefault = true;
  }

  // `deleted: false` means it was not there. Reported rather than raised as an
  // error: the caller asked for it to be gone, and it is gone. Repeating a
  // disconnect — a double-click, a retried request — must not fail.
  return { ok: true, deleted, clearedDefault };
}
