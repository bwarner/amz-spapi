import { getCachedSecret, requireStringFields } from './secret-cache.js';

/**
 * The LWA application credentials, fetched from Secrets Manager at runtime (#55).
 *
 * `LWA_CLIENT_SECRET` and `ADS_CLIENT_SECRET` mint access tokens from EVERY
 * connected seller's refresh token. That is the whole reason they are here and
 * not in `process.env`: a Lambda environment variable is returned by
 * `GetFunctionConfiguration` to anyone with read access on the function, so
 * read-only Lambda access would otherwise reach every connected account. In the
 * Vercel runtime they were worse still — readable in a dashboard, present in
 * every build, and alongside the refresh tokens they unlock.
 *
 * These are OUR application's credentials, one pair per Amazon API, shared by
 * every seller. They are not the seller's credential: that is the refresh
 * token, which lives encrypted in Couchbase and is decrypted only inside the
 * credentials function.
 */

/** Both applications in one secret, because they are provisioned as one set. */
const REQUIRED_KEYS = [
  'spApiClientId',
  'spApiClientSecret',
  'adsClientId',
  'adsClientSecret',
] as const;

export type AmazonOAuthApp = {
  clientId: string;
  clientSecret: string;
};

/**
 * The application credentials for one Amazon API.
 *
 * One secret rather than two, keyed by API here: the two LWA applications are
 * registered together in the Amazon developer console and rotated together, and
 * splitting them would double the number of things a stage has to create before
 * anything works — while making it possible to have one and not the other,
 * which fails at the first refresh rather than at deploy.
 *
 * `client_id` is not secret and is already stored in the clear on every profile
 * document. It comes from here anyway so that the id and the secret are read as
 * one pair: taking the id from the profile and the secret from here would, for a
 * profile connected under a since-replaced application, present Amazon with a
 * mismatched pair and get back `invalid_client` — with nothing in the message
 * pointing at where the two halves diverged.
 */
export async function getAmazonOAuthApp(
  apiType: 'SP_API' | 'ADS_API'
): Promise<AmazonOAuthApp> {
  const secretId = process.env['AMAZON_OAUTH_SECRET_ID'];
  if (!secretId) {
    throw new Error(
      'AMAZON_OAUTH_SECRET_ID is not set, so no access token can be minted. ' +
        'It names the Secrets Manager secret holding ' +
        `${REQUIRED_KEYS.join(', ')} — create it with ` +
        'scripts/amazon-oauth-secret.sh.'
    );
  }

  const fields = await getCachedSecret(secretId, (parsed) =>
    requireStringFields(secretId, parsed, REQUIRED_KEYS)
  );

  return apiType === 'SP_API'
    ? {
        clientId: fields.spApiClientId,
        clientSecret: fields.spApiClientSecret,
      }
    : { clientId: fields.adsClientId, clientSecret: fields.adsClientSecret };
}
