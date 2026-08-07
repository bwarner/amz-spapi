import crypto from 'node:crypto';
import { AmazonApiTypeSchema, type AmazonApiType } from '@farvisionllc/models';
import { z } from 'zod';

/**
 * Starting an Amazon OAuth flow — with no client secret anywhere (#55).
 *
 * Replaces `amazon-oauth.ts`, which built an `AmazonOAuthFlow` and therefore
 * demanded `LWA_CLIENT_SECRET` and `ADS_CLIENT_SECRET` from the Vercel
 * environment, on routes that only ever wanted an authorization URL. Sending a
 * user to Amazon's consent screen needs the client **id** and the redirect URI,
 * both of which appear in the URL bar and neither of which is secret. The
 * secret is needed exactly once, to redeem the code, and that now happens in
 * the credentials Lambda.
 *
 * `credential-store`'s `AmazonOAuthFlow` still exists and still holds both
 * halves. That is for the CLI, which has its own credentials in `config.toml`
 * and no private API to call; the web app must not use it.
 */

/**
 * The `state` parameter: CSRF protection, and a note to our future selves.
 *
 * It travels through Amazon and comes back on the callback, where it is
 * compared against an httpOnly cookie set here. **It is not evidence of
 * anything.** `userId` is in it because the CLI's version puts it there and the
 * shape is the same, but the callback ignores it and the Lambda never sees it —
 * identity comes from the Auth0 session, and then from the verified JWT. A
 * state blob is chosen by whoever holds it, so treating one as a claim about
 * who is connecting would be the whole boundary undone.
 */
export const OAuthStateSchema = z.object({
  apiType: AmazonApiTypeSchema,
  profileName: z.string().min(1),
  userId: z.string().optional(),
  nonce: z.string().min(1),
  createdAt: z.number(),
});

export type OAuthState = z.infer<typeof OAuthStateSchema>;

/** Amazon's own limit on how long a consent screen may sit open. */
const MAX_STATE_AGE_MS = 15 * 60_000;

export const SP_API_SCOPES = [
  'sellingpartnerapi::notifications',
  'sellingpartnerapi::migration',
];

export const ADS_API_SCOPES = ['advertising::campaign_management'];

function clientId(apiType: AmazonApiType): string {
  const key = apiType === 'SP_API' ? 'LWA_CLIENT_ID' : 'ADS_CLIENT_ID';
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} is not set, so the Amazon consent screen cannot be built. It is ` +
        'the LWA application id — not a secret; the client SECRET lives in ' +
        'Secrets Manager and is read only by the credentials Lambda.'
    );
  }
  return value;
}

export function redirectUri(): string {
  const value = process.env['AMAZON_OAUTH_REDIRECT_URI'];
  if (!value) {
    throw new Error(
      'AMAZON_OAUTH_REDIRECT_URI is not set. It must match a redirect URI ' +
        'registered on the LWA application, and it is sent to the credentials ' +
        'API so the code is redeemed against the same one.'
    );
  }
  return value;
}

/** A fresh state blob, base64url-encoded the way the callback expects it. */
export function createState(
  apiType: AmazonApiType,
  profileName: string,
  userId?: string
): string {
  const state: OAuthState = {
    apiType,
    profileName,
    userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    createdAt: Date.now(),
  };

  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

/**
 * Decode a state that came back from Amazon.
 *
 * Throws rather than returning null, because every caller treats an unreadable
 * state as a failed connection — and validated with the schema rather than cast,
 * since this string made a round trip through a third party and a browser.
 */
export function parseState(encoded: string): OAuthState {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('The OAuth state parameter could not be decoded.');
  }

  const parsed = OAuthStateSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error('The OAuth state parameter was not in the expected shape.');
  }

  if (Date.now() - parsed.data.createdAt > MAX_STATE_AGE_MS) {
    throw new Error(
      'The Amazon authorisation took too long and has expired. Please try again.'
    );
  }

  return parsed.data;
}

/** The consent screen to send the user to. Ads only; SP-API uses Seller Central. */
export function buildAuthUrl(apiType: AmazonApiType, state: string): string {
  const url = new URL('https://www.amazon.com/ap/oa');
  url.searchParams.set('client_id', clientId(apiType));
  url.searchParams.set(
    'scope',
    (apiType === 'SP_API' ? SP_API_SCOPES : ADS_API_SCOPES).join(' ')
  );
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  return url.toString();
}
