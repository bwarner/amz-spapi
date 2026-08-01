import type { IHttpRouteAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { StageConfig } from '../config/stages.js';

/**
 * The Auth0 authorizer for the private API (#54).
 *
 * API Gateway validates the user's own Auth0 access token: it fetches the
 * tenant's public JWKS, checks the RS256 signature, and checks `iss`, `aud` and
 * `exp` before the integration is invoked. No service-to-service credential is
 * invented for the hop, which is the point — the token the browser already
 * holds is the one that authorizes it.
 *
 * This is the platform's own JWT authorizer rather than a Lambda authorizer.
 * For plain token validation a Lambda would be strictly more: another function
 * to build, deploy, warm and pay for, on the critical path of every request,
 * doing what the gateway already does. Reach for `HttpLambdaAuthorizer` when
 * there is logic the gateway cannot express — mapping a subject to a tenant,
 * enriching claims from the database, consulting a revocation list. That change
 * is one argument here, because `LambdaHttpApi` takes an `IHttpRouteAuthorizer`
 * and does not care which kind it is.
 *
 * What the function receives either way is
 * `event.requestContext.authorizer.jwt.claims`, so handlers are unaffected by
 * the choice.
 */
export function createAuth0Authorizer(
  config: StageConfig
): IHttpRouteAuthorizer | undefined {
  const { auth0Domain, auth0Audience, stageName } = config;

  // One without the other is a half-finished configuration, and the failure it
  // causes is silent: the API deploys open, looks configured, and is not. Two
  // undefined values mean "not wired yet", which is a stage that has not
  // reached #54 and is warned about elsewhere.
  if (Boolean(auth0Domain) !== Boolean(auth0Audience)) {
    throw new Error(
      `Stage "${stageName}" sets only one of auth0Domain / auth0Audience. ` +
        `An authorizer needs both — set SELLAVANT_${stageName.toUpperCase()}_AUTH0_DOMAIN ` +
        `and SELLAVANT_${stageName.toUpperCase()}_AUTH0_AUDIENCE, or neither.`
    );
  }

  if (!auth0Domain || !auth0Audience) return undefined;

  return new HttpJwtAuthorizer('Auth0', issuerUrl(auth0Domain), {
    authorizerName: `auth0-${stageName}`,
    jwtAudience: [auth0Audience],
  });
}

/**
 * The issuer exactly as Auth0 writes it into `iss`: `https://<domain>/`, with
 * the trailing slash.
 *
 * API Gateway compares `iss` as a string. Configure `https://tenant.auth0.com`
 * and every token Auth0 issues is rejected, because the token says
 * `https://tenant.auth0.com/` — a one-character difference that presents as
 * "401 on every request with a token that decodes perfectly". Accepting a
 * domain with or without the scheme, and forcing the slash, makes the
 * configuration hard to get wrong from `AUTH0_DOMAIN`, which conventionally
 * has neither.
 */
export function issuerUrl(domain: string): string {
  const withScheme = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}
