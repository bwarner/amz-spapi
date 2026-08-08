import type { WorkspaceMember } from '@farvisionllc/models';
import {
  acceptInvitation,
  createWorkspace,
  listMembershipsForUser,
  listPendingInvitationsForEmail,
} from '@amz-spapi/identity';
import { loggerFor } from './logger';

const log = loggerFor('access');

/**
 * Who is allowed to use Sellavant.
 *
 * ## The hole this closes
 *
 * Auth0 signup was open. Anyone who created an account reached an authenticated
 * chat, and chat spends real money against the AI Gateway on the first message.
 * That is the whole exposure, and it is worth being precise about why it is
 * only that: every collection is keyed on the Auth0 `sub`, so an uninvited
 * account can read nothing but its own empty data. There is no other tenant's
 * information to reach. What it can do is cost money.
 *
 * So the gate is applied in two places rather than everywhere:
 *
 *  - the signed-in layout, so an uninvited account sees a dead end instead of
 *    a product;
 *  - every route that spends, so the dead end cannot be walked around with
 *    curl.
 *
 * Read-only routes are deliberately not gated. They would return an uninvited
 * user their own empty results, and threading a check through forty-odd
 * handlers to achieve that is cost without a corresponding risk. When documents
 * are re-keyed from `userId` to `workspaceId` that calculus changes, and the
 * check moves into the data layer where it belongs.
 *
 * ## Fails closed
 *
 * A Couchbase error denies access. This is the opposite of the spend cap, which
 * fails open on purpose — an outage that stops chat is an outage, and an outage
 * that admits everybody is a breach.
 */

export type AccessDecision =
  | { allowed: true; memberships: WorkspaceMember[] }
  | { allowed: false; reason: 'not-invited' | 'lookup-failed' };

/**
 * Addresses that get a workspace on first sign-in, comma-separated.
 *
 * The bootstrap problem: invitations can only be sent by a member, so without
 * this the very first account has nobody to invite it and the product is
 * unreachable. Kept as an env var rather than a database row so that recovering
 * from an empty or broken `identity` scope does not itself require database
 * access.
 */
function platformOwnerEmails(): string[] {
  return (process.env['PLATFORM_OWNER_EMAILS'] ?? '')
    .split(',')
    .map((value) => value.toLowerCase().trim())
    .filter(Boolean);
}

/**
 * Resolve what this user may do, provisioning on first sign-in where the rules
 * say to.
 *
 * Three ways in, checked in order:
 *
 *  1. They are already a member of something. The common path, one query.
 *  2. They are a platform owner — bootstrap them a workspace.
 *  3. They hold a pending invitation for their verified email — accept it.
 *
 * Case 3 accepts without the user clicking the emailed link. The link exists so
 * an invitee can be told what they are joining, but an invitation is a decision
 * the *inviter* already made, and refusing entry to someone who was invited
 * merely because they navigated to the site directly is a support ticket, not
 * a security control. The email is still checked against the invitation.
 */
export async function resolveAccess(params: {
  userId: string;
  email?: string;
}): Promise<AccessDecision> {
  const email = params.email?.toLowerCase().trim();

  try {
    const memberships = await listMembershipsForUser(params.userId);
    if (memberships.length > 0) return { allowed: true, memberships };

    if (!email) {
      // No email claim means neither remaining route can be evaluated: both key
      // on the address. Denied rather than guessed.
      log.warn({ userId: params.userId }, 'session carries no email claim');
      return { allowed: false, reason: 'not-invited' };
    }

    const owners = platformOwnerEmails();

    if (owners.includes(email)) {
      const workspace = await createWorkspace({
        name: 'Sellavant',
        ownerUserId: params.userId,
        ownerEmail: email,
      });
      log.info(
        { workspaceId: workspace.workspaceId },
        'bootstrapped platform owner workspace'
      );
      return {
        allowed: true,
        memberships: await listMembershipsForUser(params.userId),
      };
    }

    const pending = await listPendingInvitationsForEmail(email);
    if (pending.length > 0) {
      // The list arrives newest-first, so the last element is the oldest. If
      // several workspaces invited the same contractor, the one that has been
      // waiting longest is the one they were most likely coming here for. The
      // rest stay pending and can still be accepted by link.
      const invitation = pending[pending.length - 1];
      await acceptInvitation({
        invitationId: invitation.invitationId,
        userId: params.userId,
        sessionEmail: email,
      });
      return {
        allowed: true,
        memberships: await listMembershipsForUser(params.userId),
      };
    }

    /**
     * Say WHY, at warn level.
     *
     * Written after locking the product's owner out of their own dev
     * environment and having nothing in the logs to explain it. A refusal is
     * the single most confusing outcome this function has — the person is
     * signed in, so from their side everything worked — and it was the one
     * outcome that produced no record at all.
     *
     * `ownerListConfigured` is the field that actually resolves it. An empty
     * list almost always means the process predates the environment variable
     * rather than that the address is wrong, and those two have identical
     * symptoms and completely different fixes.
     */
    log.warn(
      {
        userId: params.userId,
        email,
        ownerListConfigured: owners.length > 0,
        matchesOwnerList: owners.includes(email),
        pendingInvitations: pending.length,
      },
      'access denied — signed in, but no membership, owner entry or invitation'
    );
    return { allowed: false, reason: 'not-invited' };
  } catch (error) {
    // Fails CLOSED. See the module note: the failure mode of guessing "allowed"
    // here is unbounded.
    log.error(
      {
        userId: params.userId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'access lookup failed — denying'
    );
    return { allowed: false, reason: 'lookup-failed' };
  }
}

/**
 * The access check for routes that spend money.
 *
 * Returns null when the caller may proceed, or the `Response` to return when
 * they may not — shaped that way so a handler adds two lines rather than a
 * try/catch, and so the refusal cannot be forgotten by catching too broadly.
 */
export async function denyIfWithoutAccess(session: {
  user?: { sub?: string; email?: string };
}): Promise<Response | null> {
  const userId = session.user?.sub;
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await resolveAccess({
    userId,
    email: session.user?.email,
  });
  if (decision.allowed) return null;

  if (decision.reason === 'lookup-failed') {
    // 503, not 403: the user may well have access and we could not tell. Saying
    // "forbidden" would send them to support with a question nobody can answer.
    return Response.json(
      { error: 'Access could not be verified. Please try again shortly.' },
      { status: 503 }
    );
  }

  return Response.json(
    {
      error:
        'Sellavant is currently invite-only. Ask your workspace owner for an ' +
        'invitation, or contact us to request access.',
    },
    { status: 403 }
  );
}
