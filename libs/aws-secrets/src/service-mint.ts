import { getAuth0ServicePrincipal } from './auth0-service-principal.js';

/**
 * How an unattended worker gets an Amazon access token (#152).
 *
 * Two hops, and the split is the whole point:
 *
 *   1. **Auth0** — a client-credentials grant proves this worker is the
 *      allow-listed service principal. Cacheable, because the token identifies
 *      the MACHINE and is the same regardless of which seller is being synced.
 *   2. **The credential service** — presents that token and names a seller. It
 *      holds the refresh token and the LWA client secret and returns only a
 *      short-lived Amazon access token.
 *
 * What this file deliberately does not do is hold seller material. The refresh
 * token never enters this runtime, which is the property #55 moved the slice out
 * of Vercel to establish and the reason this indirection exists at all instead
 * of the worker simply reading the credential document itself.
 */

/** How long before expiry a cached Auth0 token stops being handed out. */
const RENEW_BEFORE_MS = 60_000;

/**
 * The machine token, cached for the container's life.
 *
 * SAFE to cache, and the reason is specific: this token says who the WORKER is,
 * not who it is acting for. It does not vary by seller, so one container reusing
 * it across two sellers' messages hands the second exactly what it would have
 * fetched anyway.
 *
 * The seller's Amazon token is NOT cached here for precisely the inverse reason
 * — it is per seller, and a cache keyed wrongly would hand one seller's token to
 * another's sync, which authenticates successfully and returns the wrong
 * account's data. The credential service already caches those per profile, where
 * the key includes the user.
 */
let machineToken: { token: string; expiresAt: number } | undefined;

/** Tests only; a running Lambda has no reason to. */
export function clearMachineToken(): void {
  machineToken = undefined;
}

export class ServiceTokenError extends Error {}

async function fetchMachineToken(): Promise<string> {
  const now = Date.now();
  if (machineToken && machineToken.expiresAt - RENEW_BEFORE_MS > now) {
    return machineToken.token;
  }

  const principal = await getAuth0ServicePrincipal();
  const response = await fetch(`https://${principal.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: principal.clientId,
      client_secret: principal.clientSecret,
      audience: principal.audience,
    }),
  });

  if (!response.ok) {
    // The body is NOT included. Auth0 echoes request parameters in some error
    // responses, and the request body here contains the client secret.
    throw new ServiceTokenError(
      `Auth0 refused the client-credentials grant (${response.status}). ` +
        'Check that the application has a client grant for ' +
        `"${principal.audience}" — a missing grant presents as this.`
    );
  }

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new ServiceTokenError('Auth0 returned no access_token.');
  }

  machineToken = {
    token: body.access_token,
    // Default short rather than long. Treating an absent `expires_in` as
    // generous would keep presenting a dead token; treating it as one minute
    // costs an extra round trip and recovers on its own.
    expiresAt: now + (body.expires_in ?? 60) * 1000,
  };
  return machineToken.token;
}

export type SellerTokenRequest = {
  /** The seller's Auth0 subject — whose connection this is. */
  onBehalfOf: string;
  apiType: 'SP_API' | 'ADS_API';
  profileName: string;
  /** For the credential service's shed tripwire. */
  sellerId: string;
  domain: string;
};

/**
 * A short-lived Amazon access token for one seller.
 *
 * Called per refresh rather than per message, because `SpApiClient` asks only
 * when it has none or the one it holds was rejected. That is also why nothing
 * here retries: a 401 means this worker's own identity is wrong, which retrying
 * cannot fix, and every other failure is already handled by the message going
 * back on the queue with its own backoff.
 */
export async function mintSellerAccessToken(
  request: SellerTokenRequest
): Promise<string> {
  const baseUrl = process.env['CREDENTIALS_API_BASE_URL'];
  if (!baseUrl) {
    throw new ServiceTokenError(
      'CREDENTIALS_API_BASE_URL is not set, so this worker has no credential ' +
        'service to ask. It is the private API base URL for the stage.'
    );
  }

  const machine = await fetchMachineToken();
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/credentials/service/access-token`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${machine}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    }
  );

  if (!response.ok) {
    // This body is safe to surface and is the whole diagnostic: the credential
    // service answers with `{error, detail}` and never with credential
    // material. "Shed", "Forbidden" and "Reconnect" are different problems with
    // different fixes, and collapsing them into one message would hide which.
    const detail = await response.text().catch(() => '');
    throw new ServiceTokenError(
      `Credential service refused to mint for ${request.sellerId} ` +
        `(${response.status}): ${detail.slice(0, 500)}`
    );
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    // Distinct from a refusal on purpose. A 200 with no token means the
    // contract changed, and reporting it as a credential failure would send
    // somebody looking at Amazon instead of at this response.
    throw new ServiceTokenError(
      'Credential service returned 200 with no access_token.'
    );
  }
  return body.access_token;
}
