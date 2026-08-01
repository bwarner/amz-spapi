/**
 * The BFF's half of the private-API seam (#54).
 *
 * A service holds an `apiUrl` and the caller's `accessToken` and does nothing
 * else clever: route handlers construct one and call a method, instead of
 * importing the data layer directly. The token is the user's own Auth0 access
 * token, forwarded unchanged — API Gateway validates it, so the hop invents no
 * service-to-service credential.
 *
 * Constructor-injected rather than reaching for the session itself, so a
 * service is testable without a request context and a caller cannot
 * accidentally use one user's token on another user's behalf.
 */

/**
 * A failed call, carrying the status the BFF should answer with.
 *
 * The distinction that matters is *whose* fault it is. An upstream 401 means
 * the user's token was rejected and they should re-authenticate; an upstream
 * 500 or a connection failure is our problem and must not be reported as an
 * auth error. Collapsing both into a generic 500 — the default when a fetch
 * result goes unchecked — makes the difference invisible exactly when someone
 * is trying to debug it.
 */
export class ApiError extends Error {
  constructor(
    /** What the BFF should return to the browser. */
    readonly status: number,
    message: string,
    /** The upstream status, when there was one. Absent for transport failures. */
    readonly upstreamStatus?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ApiError';
  }

  /** True when re-authenticating could plausibly fix it. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export type ApiServiceOptions = {
  /** Base URL of the private API, no trailing slash. */
  apiUrl: string;
  /** The caller's Auth0 access token, forwarded as a bearer credential. */
  accessToken: string;
  /**
   * Injected so tests do not need a network, and so a caller can pass a fetch
   * with its own timeout or instrumentation.
   */
  fetchImpl?: typeof fetch;
};

export abstract class ApiService {
  protected readonly apiUrl: string;
  protected readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiServiceOptions) {
    if (!options.apiUrl) {
      throw new Error(
        'No private API URL configured. Set SELLAVANT_API_URL to the HTTP API ' +
          'endpoint from the lambdas stack output.'
      );
    }
    if (!options.accessToken) {
      // Sending `Authorization: Bearer undefined` gets a 401 that reads like a
      // rejected token rather than a missing one, which is a long detour.
      throw new Error(
        'No access token supplied. The session must be able to mint one for ' +
          'the API audience — see AUTH0_AUDIENCE.'
      );
    }

    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * One authenticated call, with the failure modes turned into `ApiError`.
   *
   * `path` is absolute from the API root, e.g. `/me`.
   */
  protected async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch (cause) {
      // DNS, TLS, connection refused, timeout. The user did nothing wrong and
      // signing in again will not help, so this is 502 and never 401.
      throw new ApiError(
        502,
        `Could not reach the private API at ${this.apiUrl}${path}.`,
        undefined,
        { cause }
      );
    }

    if (!response.ok) {
      throw await this.toApiError(response, path);
    }

    return (await this.parseJson(response, path)) as T;
  }

  /**
   * The upstream status, translated into what the BFF should answer.
   *
   * 401 and 403 pass through because they are about the caller. Everything
   * else becomes 502: a 404 from the API is a routing mistake on our side, not
   * a missing page for the user, and reporting an upstream 500 as our 500
   * hides which side actually failed.
   */
  private async toApiError(
    response: Response,
    path: string
  ): Promise<ApiError> {
    const detail = await this.readErrorBody(response);

    if (response.status === 401 || response.status === 403) {
      // API Gateway's rejection body is `{"message":"Unauthorized"}` and says
      // nothing about the cause. Everything needed to tell the causes apart is
      // in the token, so describe it rather than leaving the next person to
      // guess between a wrong audience, a wrong issuer and an expired session.
      console.error(
        '[api-service] the API rejected the token:',
        describeToken(this.accessToken)
      );

      return new ApiError(
        response.status,
        detail ||
          (response.status === 401
            ? 'The private API rejected the access token.'
            : 'The private API refused this request.'),
        response.status
      );
    }

    return new ApiError(
      502,
      `The private API failed on ${path} with ${response.status}` +
        (detail ? `: ${detail}` : '.'),
      response.status
    );
  }

  /** A useful line from the error body, or nothing. Never throws. */
  private async readErrorBody(response: Response): Promise<string | undefined> {
    try {
      const text = await response.text();
      if (!text) return undefined;

      try {
        const parsed = JSON.parse(text) as {
          error?: unknown;
          detail?: unknown;
          message?: unknown;
        };
        // `message` is what API Gateway itself uses — its rejection body is
        // exactly `{"message":"Unauthorized"}`. Omitting it meant the gateway's
        // own errors fell through to the raw-text branch and surfaced as a
        // JSON blob inside the message field.
        const parts = [parsed.error, parsed.detail, parsed.message].filter(
          (part): part is string => typeof part === 'string' && part.length > 0
        );
        if (parts.length) return parts.join(' — ');
      } catch {
        // Not JSON. API Gateway's own errors are, but a proxy in front of it
        // may return HTML; the raw text is still more use than nothing.
      }

      return text.slice(0, 200);
    } catch {
      return undefined;
    }
  }

  private async parseJson(response: Response, path: string): Promise<unknown> {
    try {
      return await response.json();
    } catch (cause) {
      // A 200 that is not JSON usually means something answered in place of the
      // API — a login page from a proxy, most often.
      throw new ApiError(
        502,
        `The private API returned a non-JSON body on ${path}.`,
        response.status,
        { cause }
      );
    }
  }
}

/**
 * What a rejected token looks like, for the log only.
 *
 * **Deliberately does not verify the signature.** Verification is API Gateway's
 * job and it has already happened — and already failed. The question here is
 * *why*, and the answer is in claims that are readable without the key. Nothing
 * here is trusted for any decision, and the token itself is never logged.
 *
 * The case worth naming: if `AUTH0_AUDIENCE` was not applied when the session
 * was created, Auth0 issues an **opaque** access token rather than a JWT. It
 * looks like a perfectly good credential, and API Gateway rejects it without
 * being able to say that it was never a JWT at all.
 */
export function describeToken(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      problem:
        'Not a JWT — probably an opaque Auth0 token, which means the session ' +
        'was created without an audience. Check AUTH0_AUDIENCE and sign in again.',
      segments: parts.length,
    };
  }

  try {
    const claims = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const exp = typeof claims['exp'] === 'number' ? claims['exp'] : undefined;

    return {
      // Compare against the authorizer's jwtAudience and issuerUrl. The issuer
      // must match including its trailing slash.
      aud: claims['aud'],
      iss: claims['iss'],
      alg: header['alg'],
      expired: exp ? exp * 1000 < Date.now() : 'no exp claim',
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
    };
  } catch {
    return { problem: 'Three segments, but the payload did not decode.' };
  }
}

/**
 * The configured API base URL.
 *
 * Deliberately not defaulted to localhost: a wrong-but-plausible default turns
 * a missing configuration into a connection error at request time, several
 * layers from the cause.
 */
export function privateApiUrl(): string {
  return process.env.SELLAVANT_API_URL ?? '';
}

/**
 * A failed service call, as the response the browser should get.
 *
 * Route handlers use this so a rejected token arrives as 401 — which the UI can
 * act on by sending the user to sign in again — rather than as the 500 an
 * unhandled throw would produce. Anything that is not an `ApiError` is a bug in
 * our own code, so it stays a 500 and says nothing further: the message could
 * name internal hosts or tokens, and the detail belongs in the log.
 */
export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    // A 502 means the API itself failed; the message names the path and the
    // upstream status, and it is the only record of them once this returns.
    if (error.status >= 500) {
      console.error('[api-service]', error.message, {
        upstreamStatus: error.upstreamStatus,
        cause: error.cause,
      });
    }

    return Response.json(
      {
        error: error.message,
        // Lets the UI distinguish "sign in again" from "the backend is down"
        // without parsing prose.
        retryable: error.status >= 500,
      },
      { status: error.status }
    );
  }

  // Not an ApiError, so a bug in our own code. The response says nothing —
  // the message could name internal hosts or tokens — which makes the log the
  // only place the detail survives.
  console.error('[api-service] unexpected error', error);
  return Response.json({ error: 'Internal error.' }, { status: 500 });
}
