import { getCachedSecret, requireStringFields } from './secret-cache.js';

/**
 * The machine identity an unattended worker authenticates as (#152).
 *
 * A scheduled worker has no user, so it cannot carry a user's token. It
 * authenticates as itself against Auth0 with a client-credentials grant and
 * presents the resulting token to the credential service, which mints a seller
 * access token on a named seller's behalf.
 *
 * This client secret is NOT the Amazon material. It buys a token for our own
 * private API and nothing else — the refresh tokens and the LWA secret stay
 * inside the credentials function, which is the property #55 exists to protect.
 * It is still a credential that reaches an endpoint able to mint for any
 * connected seller, which is why it is here rather than in an environment
 * variable: a Lambda env var is written into the CloudFormation template and
 * returned by `GetFunctionConfiguration` to anyone with read access.
 */

/**
 * All four together, because they change as one unit.
 *
 * Rotating the application changes `clientId` and `clientSecret`; moving tenants
 * changes `domain` too. Taking the id from configuration and the secret from
 * here would, after a rotation, present Auth0 with a mismatched pair and get
 * back `invalid_client` — with nothing in the message pointing at which half was
 * stale. The same argument as `getAmazonOAuthApp`, for the same reason.
 *
 * `audience` is included because a token minted for the wrong audience is
 * rejected by the API gateway, not by Auth0: the failure surfaces as a 401 on a
 * token that decodes perfectly, one of the least legible failures in this stack.
 */
const REQUIRED_KEYS = [
  'domain',
  'audience',
  'clientId',
  'clientSecret',
] as const;

export type Auth0ServicePrincipal = {
  /** Tenant domain, no scheme — e.g. `sellavant-dev.us.auth0.com`. */
  domain: string;
  /** The API identifier tokens must be addressed to. */
  audience: string;
  clientId: string;
  clientSecret: string;
};

export const AUTH0_SERVICE_PRINCIPAL_SECRET_ENV =
  'AUTH0_SERVICE_PRINCIPAL_SECRET_ID';

export async function getAuth0ServicePrincipal(): Promise<Auth0ServicePrincipal> {
  const secretId = process.env[AUTH0_SERVICE_PRINCIPAL_SECRET_ENV];
  if (!secretId) {
    throw new Error(
      `${AUTH0_SERVICE_PRINCIPAL_SECRET_ENV} is not set, so this worker cannot ` +
        'authenticate to the credential service. It names the Secrets Manager ' +
        `secret holding ${REQUIRED_KEYS.join(', ')} — create it with ` +
        'scripts/auth0-service-principal-secret.sh.'
    );
  }

  return getCachedSecret(secretId, (parsed) =>
    requireStringFields(secretId, parsed, REQUIRED_KEYS)
  );
}
