/**
 * The caller, as the gateway verified them (#54).
 *
 * Proves the seam end to end: a Next.js route handler sends the user's own
 * Auth0 access token, API Gateway validates it against the tenant's JWKS, and
 * this function reads the resulting claims. No service-to-service credential
 * exists anywhere in that path.
 *
 * The claims arrive already verified — signature, `iss`, `aud` and `exp` were
 * all checked before this ran, and a request that failed any of them never
 * reached here. What this does is report them back, so the BFF can prove the
 * hop works without a database or a domain in the way.
 */

/**
 * What API Gateway puts on the event for a JWT-authorized route.
 *
 * Hand-written rather than pulled from `@types/aws-lambda`: this is the whole
 * of the contract this function depends on, and the app otherwise has no
 * dependencies at all. Every value is a string — API Gateway stringifies claims,
 * so `scope` arrives space-delimited rather than as an array.
 */
export type JwtAuthorizedEvent = {
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims?: Record<string, string | undefined>;
        scopes?: string[] | null;
      };
    };
  };
};

export type MeResponse = {
  /** The Auth0 subject: `auth0|…`, `google-oauth2|…`. The user's identity. */
  userId: string;
  /**
   * Present only if the tenant adds them to the access token. Auth0 puts
   * profile claims in the ID token by default, so a plain access token for a
   * custom API carries `sub` and not much else — absent here means "not in the
   * token", never "the user has no email".
   */
  email?: string;
  name?: string;
  /** Granted scopes, split from the space-delimited claim. */
  scopes: string[];
  service: string;
  stage: string;
  requestId?: string;
  at: string;
};

export type MinimalContext = { awsRequestId?: string };

/** The claims the gateway attached, or nothing if it did not run. */
export function readClaims(
  event: JwtAuthorizedEvent | undefined
): Record<string, string | undefined> | undefined {
  return event?.requestContext?.authorizer?.jwt?.claims;
}

/**
 * Scopes as a list, from either shape API Gateway might supply.
 *
 * The `scope` claim is one space-delimited string; `scopes` is the parsed array
 * the gateway adds when the route declares authorization scopes. Reading both
 * means this does not change when scopes are eventually declared on the route.
 */
export function readScopes(event: JwtAuthorizedEvent | undefined): string[] {
  const jwt = event?.requestContext?.authorizer?.jwt;
  if (jwt?.scopes?.length) return jwt.scopes;

  const scope = jwt?.claims?.['scope'];
  return scope ? scope.split(' ').filter(Boolean) : [];
}

/** Split out so the response can be asserted without faking a Lambda runtime. */
export function buildMeResponse(
  event: JwtAuthorizedEvent | undefined,
  env: NodeJS.ProcessEnv,
  context: MinimalContext | undefined,
  now: Date
): MeResponse | undefined {
  const claims = readClaims(event);
  const userId = claims?.['sub'];

  // No subject means the authorizer did not run — the route was left open, or
  // this was invoked directly. Answering with a body shaped like a verified
  // identity would be the worst possible response: every caller downstream
  // treats `userId` as proven. Refusing is the only safe reading.
  if (!userId) return undefined;

  return {
    userId,
    email: claims?.['email'],
    name: claims?.['name'],
    scopes: readScopes(event),
    service: env['SERVICE_NAME'] || 'me',
    stage: env['STAGE'] || 'dev',
    requestId: context?.awsRequestId,
    at: now.toISOString(),
  };
}

export async function handler(
  event?: JwtAuthorizedEvent,
  context?: MinimalContext
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const payload = buildMeResponse(event, process.env, context, new Date());

  if (!payload) {
    return {
      statusCode: 401,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: 'Unauthenticated',
        detail: 'No verified subject on the request.',
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
