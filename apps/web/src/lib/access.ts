import type { WorkspaceMember } from '@farvisionllc/models';
import {
  acceptInvitation,
  listMembershipsForUser,
  listPendingInvitationsForEmail,
} from '@amz-spapi/identity';
import { loggerFor } from './logger';

const log = loggerFor('access');

/**
 * Who is allowed to use Sellavant, and whether they have somewhere to work yet.
 *
 * ## Two questions, deliberately separated
 *
 * ADMISSION — may this person use the product? Signup is open, so the answer is
 * yes for anyone who authenticated. This is not a gate any more.
 *
 * PROVISIONING — do they have a workspace? A brand-new account does not, and
 * gets `needs-onboarding` rather than a refusal. Conflating these was the
 * previous design's mistake: it had no way to give somebody a workspace, so it
 * grew `PLATFORM_OWNER_EMAILS` — an environment variable listing the people
 * allowed to have one. That is a stand-in for a flow, and this is the flow.
 *
 * ## Provisioning is never a side effect
 *
 * `resolveAccess` does NOT create a workspace, even though it now could for
 * anyone. Creating one happens only when somebody submits the onboarding form.
 *
 * The difference matters because this function runs on API routes too. If it
 * provisioned, a curl to `/api/chat` from any fresh Auth0 account would silently
 * mint a workspace and start spending, and the first record of the account would
 * be its bill. Reads decide; the deliberate act writes.
 *
 * ## What still refuses
 *
 * Routes that spend money refuse until the caller has a workspace. With open
 * signup that is no longer an admission control — it is a consistency one: an
 * account mid-onboarding, or one whose provisioning failed, has nowhere to bill
 * the work to.
 *
 * Read-only routes stay ungated. Every collection is keyed on the Auth0 `sub`,
 * so a caller without a workspace reads their own empty data and nothing else.
 * That changes when documents re-key to `workspaceId`, and the check moves into
 * the data layer then.
 *
 * ## Fails closed
 *
 * A Couchbase error is `lookup-failed`, not "no workspace". The distinction is
 * the difference between sending an existing customer to a form that would
 * create them a SECOND workspace, and telling them to try again.
 */

export type AccessDecision =
  | { allowed: true; memberships: WorkspaceMember[] }
  /** Authenticated, entitled to be here, but has no workspace yet. */
  | { allowed: false; reason: 'needs-onboarding' }
  /** We could not tell. Never treated as "no workspace" — see the note above. */
  | { allowed: false; reason: 'lookup-failed' };

/**
 * Where this user stands. Reads only — see the module note on why nothing here
 * writes.
 *
 * Two ways to already have a workspace, checked in order:
 *
 *  1. They are a member of one. The common path, and one query.
 *  2. They hold a pending invitation for their email — accept it.
 *
 * Case 2 accepts without the user clicking the emailed link, which is the one
 * write this function does make. It is not provisioning: the workspace already
 * exists and its owner already decided to admit them. Turning somebody away
 * because they typed the address instead of clicking the link would be a
 * support ticket, not a security control. The session email is still checked
 * against the invitation.
 *
 * Anyone left over gets `needs-onboarding` — they are entitled to be here and
 * simply have nowhere to work yet.
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
      // An invitation can only be matched by address. Without one there is
      // nothing to look up, so they go and create their own workspace — which
      // needs no email.
      log.warn({ userId: params.userId }, 'session carries no email claim');
      return { allowed: false, reason: 'needs-onboarding' };
    }

    const pending = await listPendingInvitationsForEmail(email);
    if (pending.length > 0) {
      // The list arrives newest-first, so the last element is the oldest. If
      // several workspaces invited the same contractor, the one that has been
      // waiting longest is the one they were most likely coming here for. The
      // rest stay pending and are surfaced on the Team page.
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

    // Info, not warn. Under open signup this is the ordinary first minute of a
    // new account, not a problem — logging it at warn would train everyone to
    // ignore the level.
    log.info(
      { userId: params.userId },
      'no workspace yet — sending to onboarding'
    );
    return { allowed: false, reason: 'needs-onboarding' };
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
 * The check for routes that spend money.
 *
 * Under open signup this is no longer an admission control — anyone may have a
 * workspace. It is a consistency one: work that costs money has to belong to a
 * workspace, and an account mid-onboarding does not have one to bill it to.
 *
 * It is also what stops provisioning becoming a side effect. Because
 * `resolveAccess` deliberately does not create anything, a fresh Auth0 account
 * pointed straight at `/api/chat` is refused rather than quietly given a
 * workspace and a bill.
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
        'Finish setting up your workspace before using this. Open Sellavant ' +
        'and complete onboarding.',
      // Machine-readable, so a client can route to onboarding rather than
      // pattern-matching prose that will be reworded.
      reason: 'needs-onboarding',
    },
    { status: 403 }
  );
}
