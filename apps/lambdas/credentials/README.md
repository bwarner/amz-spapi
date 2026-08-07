# credentials

The credential slice, off Vercel (#55). Seller connections are described,
created and used from here — and the long-lived material never leaves.

| Route                                                    | Does                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /credentials`                                       | Every connection the caller has, plus the default per API   |
| `GET /credentials/{apiType}/{profileName}`               | One connection                                              |
| `DELETE /credentials/{apiType}/{profileName}`            | Forget a connection — a real delete, not a tombstone        |
| `POST /credentials/connect`                              | Redeem an OAuth authorization code and store the connection |
| `POST /credentials/{apiType}/{profileName}/access-token` | Mint a short-lived Amazon access token                      |

## What never leaves

- The **LWA refresh token**. It is decrypted here, used here, re-encrypted here.
- The **LWA client secret**. Read from Secrets Manager at runtime, never in an
  environment variable and never in a response.

A caller gets an access token that expires within the hour, or a description of
a connection. There is no route that returns either of the two above, and that
is a design constraint rather than an omission — `PublicCredentialProfileSchema`
is an allow-list, so a field added to storage cannot ride out in a response.

**The trade:** a client built from a bare access token cannot refresh itself on
a mid-request 401, because self-refresh needs the refresh token and the client
secret. The caller must re-request. That is the capability being removed from
the Vercel runtime, so paying for it here is the point.

## Identity

From the JWT the gateway verified, and from nowhere else — see `subjectOf` in
`main.ts`. Never from a path parameter, a query string or a request body, each
of which the caller chooses. The user id is part of the document key, so a
request for someone else's profile reads a key that does not exist.

The OAuth `state` blob carries a `userId` too. This function never sees it:
state is a CSRF token the BFF checks against its own cookie, not a claim about
who is connecting.

## Why the OAuth callback is still in the BFF

The redirect URI is registered with Amazon and is a browser redirect target, so
moving it here would mean re-registering it in both LWA applications and giving
the gateway a public unauthenticated route — the one route that cannot carry an
Auth0 token, since the user is arriving from Amazon. Staying in the BFF keeps
the session cookie that identifies the user.

The BFF therefore holds the authorization **code**: single-use, minutes-long,
and worthless without the client secret. It posts that to `/credentials/connect`
and the refresh token is minted here.

## Files

| File              | Holds                                                           |
| ----------------- | --------------------------------------------------------------- |
| `main.ts`         | Identity, routing, logging, and what may be logged              |
| `connect.ts`      | Code redemption, the Ads advertiser fan-out, first write        |
| `access-token.ts` | Cache-or-refresh, and the write-back                            |
| `disconnect.ts`   | Deleting a connection, and its default pointer                  |
| `refresh-lock.ts` | One refresh at a time per connection                            |
| `lwa.ts`          | Both LWA grants — one transport, so one set of redaction rules  |
| `kms.ts`          | Encrypt and decrypt, bound to the profile by encryption context |

## One refresh at a time

A cached token is served straight from the document — no lock, no coordination,
which is the overwhelming majority of calls since a token lasts an hour.

A **refresh** runs under a single-flight lock keyed to the one connection
(`credentials_locks`, a create-only `POST` per #44, with a TTL so a crashed
holder recovers on its own). Losers wait for the winner and are served its
token; a loser that waits past the budget gets **503 `RefreshInProgress`** and
must retry — it never exchanges on its own.

That refusal is the whole design. A duplicated _access_ token would be harmless.
The danger is the **refresh** token: Amazon may rotate it on exchange, so two
concurrent exchanges can race to write, and the second write can store one the
first already superseded — breaking the connection permanently, with no retry
that recovers it. A recoverable 503 is strictly better than that.

Verified against dev: six concurrent callers on an expired token produced
**one** exchange, six identical tokens, and no 503s.

## Configuration

Set by CDK from `metadata.lambda.couchbase` and
`metadata.lambda.amazonCredentials` — see `apps/lambdas/README.md`.

| Variable                   | Holds                                            |
| -------------------------- | ------------------------------------------------ |
| `CB_CREDENTIALS_SECRET_ID` | Name of the Couchbase connection secret          |
| `AMAZON_OAUTH_SECRET_ID`   | Name of the secret holding both LWA applications |
| `KMS_CREDENTIAL_KEY_ID`    | Alias of the key stored credentials are under    |
