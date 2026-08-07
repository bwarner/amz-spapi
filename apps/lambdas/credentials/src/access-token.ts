import { getDocument, upsertDocument } from '@amz-spapi/couchbase-utils';
import { getAmazonOAuthApp } from '@amz-spapi/aws-secrets';
import {
  CREDENTIALS_COLLECTION,
  CREDENTIALS_DOMAIN,
  credentialDocKey,
  type AmazonApiType,
  type CredentialSecrets,
  type StoredCredentialProfile,
} from '@farvisionllc/models';
import { decryptSecrets, encryptSecrets } from './kms.js';
import { refreshGrant, type ServiceFailure } from './lwa.js';
import { refreshLockKey, singleFlight } from './refresh-lock.js';

/**
 * Minting SP-API and Ads access tokens, inside the private API (#55).
 *
 * The step that actually moves the credential slice off Vercel. A caller that
 * needs to call Amazon asks here and gets back a token that expires in an hour;
 * it never sees the refresh token that produced it, and it never holds the
 * client secret that would let it produce another. Both of those exist only
 * inside this function's memory, for the length of one exchange.
 *
 * What the caller loses, and it is deliberate: a client built from a bare access
 * token cannot refresh itself when Amazon returns 401 mid-request. The caller
 * has to come back here. That is the correct trade — self-refresh is exactly the
 * capability that requires holding the long-lived secret.
 */

/**
 * How much life a stored token must have left to be handed out.
 *
 * Five minutes, matching what the credential store has always used, so moving
 * the decision here changes no behaviour. It is also the caller's safety
 * margin: a token returned from here always has at least this long to run, so a
 * caller that starts a request immediately cannot be handed something that
 * expires mid-flight.
 */
const MIN_REMAINING_MS = 5 * 60_000;

export type MintedToken = {
  access_token: string;
  /** Unix ms. The caller schedules its own re-request from this. */
  expires_at: number;
  token_type: 'bearer';
  /** True when this call exchanged a refresh token; false when it was cached. */
  refreshed: boolean;
};

export type MintResult =
  | { ok: true; token: MintedToken }
  | { ok: false; failure: ServiceFailure };

/**
 * An access token for one of the caller's own connections.
 *
 * `userId` comes from the verified JWT and is never a parameter the caller
 * chose — see `subjectOf` in main.ts. It is part of the document key, so a
 * request for another user's profile reads a key that does not exist rather than
 * one belonging to someone else.
 */
export async function mintAccessToken(
  userId: string,
  apiType: AmazonApiType,
  profileName: string
): Promise<MintResult> {
  const key = credentialDocKey(profileName, apiType, userId);

  /**
   * The cached token, if it still has enough life to be worth handing out.
   *
   * Checked against the CLEAR `access_token_expires_at` before anything is
   * decrypted, so the polling loop below costs a document read rather than a
   * KMS call per poll. It runs on the fast path, on every wait, and again under
   * the lock, which is why it must stay cheap.
   *
   * `null` means "not usable" — absent, deleted, expiring, or no token stored.
   * It deliberately does not distinguish those: the caller re-reads the document
   * itself when it needs to say why.
   */
  const readCached = async (): Promise<MintedToken | null> => {
    const doc = await getDocument<StoredCredentialProfile>(
      CREDENTIALS_DOMAIN,
      CREDENTIALS_COLLECTION,
      key
    );
    if (!doc || doc.deleted || !doc.encrypted_secrets) return null;

    const expiresAt = doc.access_token_expires_at ?? 0;
    if (expiresAt - Date.now() <= MIN_REMAINING_MS) return null;

    const secrets = await decryptSecrets(doc.encrypted_secrets, contextOf(doc));
    if (!secrets.access_token) return null;

    return {
      access_token: secrets.access_token,
      expires_at: expiresAt,
      token_type: 'bearer',
      refreshed: false,
    };
  };

  const stored = await getDocument<StoredCredentialProfile>(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    key
  );

  if (!stored || stored.deleted) {
    return notFound();
  }

  if (!stored.encrypted_secrets) {
    // Written before #11. Reading it would mean handling plaintext secrets on a
    // path that has none, so refuse and say what fixes it.
    return {
      ok: false,
      failure: {
        status: 409,
        error: 'Unencrypted',
        detail:
          'This profile predates credential encryption and has no ' +
          'encrypted_secrets. Reconnect the account.',
      },
    };
  }

  const context = contextOf(stored);
  const secrets = await decryptSecrets(stored.encrypted_secrets, context);

  // The fast path: a usable token, no lock, no exchange. This is the common
  // case by a wide margin — a token lasts an hour — so it must not pay for the
  // coordination the refresh needs.
  const expiresAt = stored.access_token_expires_at ?? 0;
  if (secrets.access_token && expiresAt - Date.now() > MIN_REMAINING_MS) {
    return {
      ok: true,
      token: {
        access_token: secrets.access_token,
        expires_at: expiresAt,
        token_type: 'bearer',
        refreshed: false,
      },
    };
  }

  if (!secrets.refresh_token) {
    // A profile with no refresh token cannot mint anything, ever. 409 rather
    // than 404 or 502: the profile exists and nothing failed — the connection
    // is simply incomplete, and the fix is to reconnect, not to retry.
    return {
      ok: false,
      failure: {
        status: 409,
        error: 'NotConnected',
        detail:
          'This profile holds no refresh token, so no access token can be ' +
          'minted. Reconnect the account.',
      },
    };
  }

  const app = await getAmazonOAuthApp(apiType);

  if (stored.client_id && stored.client_id !== app.clientId) {
    // Amazon's answer to a mismatched pair is `invalid_client`, which says
    // nothing about which half is wrong. Catch it here, where both halves are
    // in hand and can be named. Before the lock: this can never succeed, so
    // there is nothing to serialise.
    return {
      ok: false,
      failure: {
        status: 409,
        error: 'ClientMismatch',
        detail:
          `This profile was connected under LWA client ${stored.client_id}, ` +
          `but the configured ${apiType} application is ${app.clientId}. ` +
          'Reconnect the account, or correct AMAZON_OAUTH_SECRET_ID.',
      },
    };
  }

  // One exchange at a time for this connection. Amazon may rotate the refresh
  // token, and two concurrent exchanges can race to write — storing one that
  // the other already superseded, which breaks the connection permanently.
  // See `refresh-lock.ts`.
  let result;
  try {
    result = await singleFlight<MintedToken>(
      refreshLockKey(userId, apiType, profileName),
      {
        read: readCached,
        work: () => exchange(key, context, secrets, app, stored),
      }
    );
  } catch (error) {
    // An LWA rejection travels out as a throw so the lock is released on the
    // way. Its classification is the useful part — 409 means the seller must
    // reconnect, 502 means retry — and letting it become a generic 502 here
    // would throw that away.
    if (error instanceof LwaFailure) {
      return { ok: false, failure: error.failure };
    }
    throw error;
  }

  return result.ok
    ? { ok: true, token: result.value }
    : { ok: false, failure: result.failure };
}

/** Non-secret, and identical on the encrypt and decrypt paths. */
function contextOf(stored: StoredCredentialProfile) {
  return {
    userId: stored.user_id,
    apiType: stored.api_type,
    profileName: stored.profile_name,
  };
}

/**
 * The critical section: exchange the refresh token and store what comes back.
 *
 * Only ever called under the lock, and only after the double-check found no
 * usable token. Throws rather than returning a failure result, because
 * `singleFlight` propagates a throw to the caller unchanged and the lock is
 * released either way.
 */
async function exchange(
  key: string,
  context: ReturnType<typeof contextOf>,
  secrets: CredentialSecrets,
  app: { clientId: string; clientSecret: string },
  stored: StoredCredentialProfile
): Promise<MintedToken> {
  const exchanged = await refreshGrant(
    stored.region,
    app.clientId,
    app.clientSecret,
    secrets.refresh_token as string
  );
  if (!exchanged.ok) throw new LwaFailure(exchanged.failure);

  const token: MintedToken = {
    access_token: exchanged.tokens.accessToken,
    expires_at: exchanged.tokens.expiresAt,
    token_type: 'bearer',
    refreshed: true,
  };

  // Written back so the next caller gets the cache rather than another
  // exchange. Amazon rate-limits the token endpoint, and a chat turn can touch
  // several connections.
  //
  // Amazon MAY rotate the refresh token on exchange; when it does, the new one
  // replaces the old, because the old one stops working. That rotation is the
  // whole reason this runs under a lock.
  const rotated = exchanged.tokens.refreshToken ?? secrets.refresh_token;
  const updated: StoredCredentialProfile = {
    ...stored,
    encrypted_secrets: await encryptSecrets(
      {
        ...secrets,
        refresh_token: rotated,
        access_token: token.access_token,
      },
      context
    ),
    has_refresh_token: true,
    access_token_expires_at: token.expires_at,
    updated_at: Date.now(),
  };
  await upsertDocument(
    CREDENTIALS_DOMAIN,
    CREDENTIALS_COLLECTION,
    key,
    updated
  );

  return token;
}

/**
 * An LWA failure, carried out through `singleFlight` as a throw.
 *
 * `singleFlight` is generic over a success value and has no opinion about this
 * domain’s failure shape, so the alternative would be making it generic over
 * both — which buys nothing except a second type parameter at every call site.
 */
class LwaFailure extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.detail);
    this.name = 'LwaFailure';
  }
}

function notFound(): MintResult {
  return {
    ok: false,
    failure: {
      status: 404,
      error: 'NotFound',
      detail: 'No such credential profile.',
    },
  };
}
