import { executeQuery } from '@amz-spapi/couchbase-utils';
import { AmazonApiTypeSchema } from '@farvisionllc/models';
import { z } from 'zod';
import type { ServiceFailure } from './lwa.js';

/**
 * Unattended callers, and the one thing they may do (#152).
 *
 * The credential service's security argument is that identity comes from the
 * verified JWT and from nowhere else. A scheduled worker has no user: it runs at
 * 05:00 on behalf of many sellers, and none of them is present to authorise it.
 * That is a real hole in the model, and the choice here is to make it explicit
 * rather than to leave it implied.
 *
 * The transport needs nothing new. An Auth0 machine-to-machine token is issued
 * for the same audience as a user's, so the gateway verifies it identically and
 * `subjectOf` returns the machine's `sub` (`<client_id>@clients`). No IAM
 * bypass, no second authorizer, no shared secret between services.
 *
 * What is new is a principal that can mint for accounts it does not own. Four
 * things keep that narrow:
 *
 * 1. **The identity is allow-listed**, not merely machine-shaped. Any client in
 *    the tenant can obtain a token for this audience; being a machine is not a
 *    permission.
 * 2. **Mint-only, on a route of its own.** A service principal never connects,
 *    disconnects, lists or reads a profile — and because act-on-behalf lives on
 *    a separate route rather than being inferred from `sub`, a service token can
 *    never be quietly reinterpreted as a user token, nor a user token as a
 *    service one.
 * 3. **The subject is named, never defaulted.** There is no "the caller's own"
 *    fallback here, because for a machine there is no such thing.
 * 4. **The audit records both.** `actor` is the machine, `onBehalfOf` is the
 *    seller, so automated mints stay separable from human ones in the log that
 *    is already the only record a token was issued at all.
 */

/**
 * Act-on-behalf lives here and only here.
 *
 * Deliberately NOT the existing `POST /credentials/{apiType}/{profileName}/access-token`
 * with an extra body field. Sharing that route would mean one handler deciding,
 * per request, whether to trust a caller-supplied user id — and the failure mode
 * of getting that wrong is that any authenticated user mints tokens for any
 * other by adding a field. A separate route makes the two cases impossible to
 * confuse, at the cost of one line of configuration.
 */
export const SERVICE_MINT_ROUTE = 'POST /credentials/service/access-token';

/**
 * The scope a machine token must carry to mint.
 *
 * Defined on the API in the Auth0 tenant and granted per application. Deliberately
 * narrower than the route: it says "mint a token on behalf of a seller" and not
 * "manage credentials", so a later `credentials:connect` cannot be reached by a
 * principal granted this one.
 */
export const MINT_SCOPE = 'credentials:mint';

/**
 * Scopes from the verified token.
 *
 * API Gateway's JWT authorizer populates `jwt.scopes` only when the route
 * declares `authorizationScopes`; ours does not, because the check belongs here
 * where it can be reported with a usable message rather than as a bare 403 from
 * the gateway. So the raw `scope` claim is the reliable source, and it is a
 * space-delimited string. Both are read, because a route that later declares
 * scopes must not silently start refusing everything.
 */
export function scopesOf(jwt: {
  claims?: Record<string, string | undefined>;
  scopes?: string[] | null;
}): string[] {
  if (jwt.scopes?.length) return jwt.scopes;
  return (jwt.claims?.['scope'] ?? '').split(' ').filter(Boolean);
}

/**
 * The service principals this stage trusts, from configuration.
 *
 * An environment variable is right for this and wrong for the LWA client
 * secret, which the comments elsewhere in this function are emphatic about. The
 * difference is that these are *identifiers*, not credentials: publishing the
 * list grants nothing, because holding the id is not how a caller proves it is
 * that client. Reading it off the function is a diagnostic, not a leak.
 *
 * Per stage, not one constant: dev, staging and production are three different
 * Auth0 tenants with three different client ids, and a principal trusted in dev
 * must not be trusted in production.
 *
 * Empty means no service principal is configured, which refuses every service
 * request. That is the correct default for a stage that has not been set up.
 */
export function servicePrincipals(
  env: NodeJS.ProcessEnv = process.env
): Set<string> {
  return new Set(
    (env['SERVICE_PRINCIPALS'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function isServicePrincipal(
  subject: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return servicePrincipals(env).has(subject);
}

/**
 * What an unattended caller must state to mint on someone's behalf.
 *
 * Every field is required. A machine always knows all of them — the sync
 * dispatcher puts `userId`, `sellerId` and `domain` on the queue message it
 * enqueues — so there is no caller for whom a default would be a convenience,
 * and a defaulted field here would be an assumption about whose credentials to
 * hand out.
 */
export const ServiceMintRequestSchema = z.object({
  /** The Auth0 subject of the seller whose connection this is. */
  onBehalfOf: z.string().min(1),
  apiType: AmazonApiTypeSchema,
  profileName: z.string().min(1).max(200),
  /**
   * The seller account and sync domain this mint is for.
   *
   * Present for the shed check below, and required rather than optional: a
   * security check that the caller can switch off by omitting a field is not a
   * check. Both are on the message the worker is already handling.
   */
  sellerId: z.string().min(1),
  domain: z.string().min(1),
});

export type ServiceMintRequest = z.infer<typeof ServiceMintRequestSchema>;

/**
 * Failures beyond this many mean the authorization is dead, not the report.
 *
 * The same threshold the dispatcher sheds on. Duplicated as a constant rather
 * than imported because the two are only coincidentally equal today — the
 * dispatcher's is about queue noise, this one is about not issuing credentials
 * for a connection that has stopped working — and coupling them would make a
 * change to one silently change the other.
 */
export const FAILURE_SHED_THRESHOLD = 10;

/**
 * Whether the dispatcher would have refused to enqueue this work.
 *
 * Defence in depth, and a tripwire rather than the primary gate: the dispatcher
 * already skips a shed seller × domain, so a service mint arriving for one means
 * something enqueued work that should not have been enqueued. Refusing here
 * costs nothing in the normal case and turns a silent inconsistency into a
 * logged refusal.
 *
 * Keyed on seller × domain, exactly the dispatcher's unit. Not "any failing
 * domain for this seller": one report failing repeatedly must not stop the
 * domains that work from syncing.
 */
export async function isShed(
  sellerId: string,
  domain: string
): Promise<boolean> {
  const { rows } = await executeQuery<{ failures: number }>(
    'sync',
    `SELECT consecutiveFailures AS failures
       FROM sync_cursors
      WHERE sellerId = $sellerId
        AND domain = $domain
        AND consecutiveFailures >= $threshold`,
    {
      parameters: { sellerId, domain, threshold: FAILURE_SHED_THRESHOLD },
      readonly: true,
    }
  );
  return rows.length > 0;
}

/**
 * The decision, without the minting.
 *
 * Separated from `mintAccessToken` so every refusal reason is testable without a
 * Couchbase document, a KMS key or a call to Amazon — and so the order of the
 * checks is visible in one place. Identity is settled before the body is read,
 * because a caller who is not a service principal has no business having its
 * `onBehalfOf` parsed, let alone honoured.
 */
export type ServiceMintAuthorization =
  | { ok: true; request: ServiceMintRequest }
  | { ok: false; failure: ServiceFailure };

export async function authorizeServiceMint(params: {
  /** The verified `sub` from the gateway. */
  subject: string;
  /** The verified scopes from the same token. */
  scopes: string[];
  body: unknown;
  env?: NodeJS.ProcessEnv;
}): Promise<ServiceMintAuthorization> {
  if (!isServicePrincipal(params.subject, params.env ?? process.env)) {
    // 403 and not 404: the caller authenticated fine and this route exists. The
    // message says what is missing without naming the allow-list's contents.
    return {
      ok: false,
      failure: {
        status: 403,
        error: 'Forbidden',
        detail:
          'This route is for configured service principals. A user token ' +
          'mints for its own connections on the per-profile route instead.',
      },
    };
  }

  // Both, not either. The allow-list says which client we trust; the scope says
  // what that client was granted, and the two are administered in different
  // places — the list here, the grant in the Auth0 tenant. Requiring both means
  // revoking the client grant is sufficient to stop the mints without a deploy,
  // and that adding a principal to the list does not by itself grant anything.
  if (!params.scopes.includes(MINT_SCOPE)) {
    return {
      ok: false,
      failure: {
        status: 403,
        error: 'Forbidden',
        detail:
          `This token carries no "${MINT_SCOPE}" scope. The application needs ` +
          'a client grant for it on the API — a grant on user-delegated ' +
          'access rather than client access presents as exactly this.',
      },
    };
  }

  const parsed = ServiceMintRequestSchema.safeParse(params.body);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        status: 400,
        error: 'BadRequest',
        // Field paths only, matching the connect route: the body names a user
        // and a seller, and an error formatted with its input would put both
        // into the response and then into whatever logs it.
        detail:
          'Malformed service mint request: ' +
          parsed.error.issues
            .map((issue) => issue.path.join('.') || '(root)')
            .join(', '),
      },
    };
  }

  if (await isShed(parsed.data.sellerId, parsed.data.domain)) {
    return {
      ok: false,
      failure: {
        status: 409,
        error: 'Shed',
        detail:
          `${parsed.data.sellerId} has failed ${FAILURE_SHED_THRESHOLD} or more ` +
          `consecutive ${parsed.data.domain} runs and is no longer dispatched. ` +
          'Reconnect the account rather than retrying.',
      },
    };
  }

  return { ok: true, request: parsed.data };
}
