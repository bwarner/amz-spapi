import type { Metadata } from 'next';
import { canManageMembers } from '@farvisionllc/models';
import { auth0 } from '../../../lib/auth0';
import Link from 'next/link';
import {
  getWorkspace,
  listInvitations,
  listMembers,
  listMembershipsForUser,
  listPendingInvitationsForEmail,
} from '@amz-spapi/identity';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { TeamPanel } from './team-panel';
import { selectInvitationsToShow } from './pending-invitations';

export const metadata: Metadata = { title: 'Team' };

/**
 * Members and invitations for the caller's workspaces.
 *
 * A server component so the membership that decides what the page may show is
 * read on the server and never inferred from anything the browser sent. The
 * client panel receives only what this user is allowed to see; it has no
 * ability to widen that by asking differently, because every mutating route
 * re-checks membership anyway.
 *
 * Several workspaces are the normal case for a contractor or agency, so this
 * renders one section per workspace rather than assuming a single tenant.
 */
export default async function TeamPage() {
  const session = await auth0.getSession();
  // The layout already redirected an unauthenticated visitor; this is a type
  // narrow, not a second gate.
  if (!session?.user?.sub) return null;

  const memberships = await listMembershipsForUser(session.user.sub);

  /**
   * Invitations addressed to THIS person, as opposed to ones they sent.
   *
   * Without this a second invitation is unreachable. `resolveAccess` accepts a
   * pending invitation only for somebody with no membership at all — joining an
   * organisation should not happen as a silent side effect of signing in — so
   * an existing member who gets invited elsewhere has no route to it and it
   * expires after seven days.
   *
   * Ones for a workspace they are already in are filtered out: an invitation
   * that would change nothing is noise, and offering to "join" somewhere they
   * already are reads like a bug.
   */
  const invitationsToMe = selectInvitationsToShow({
    pending: session.user.email
      ? await listPendingInvitationsForEmail(session.user.email).catch(
          // A failed lookup hides the prompt; it must not break the page the
          // person came here to use.
          () => []
        )
      : [],
    memberOf: memberships.map((membership) => membership.workspaceId),
  });

  const invitingWorkspaces = await Promise.all(
    invitationsToMe.map(async (invitation) => ({
      invitationId: invitation.invitationId,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      workspaceName:
        (await getWorkspace(invitation.workspaceId))?.name ?? 'a workspace',
    }))
  );

  const workspaces = await Promise.all(
    memberships.map(async (membership) => {
      const manages = canManageMembers(membership.role);
      const [workspace, members, invitations] = await Promise.all([
        getWorkspace(membership.workspaceId),
        listMembers(membership.workspaceId),
        // Invitations are only readable by someone who could create them, so
        // this is skipped rather than fetched-and-hidden.
        manages ? listInvitations(membership.workspaceId) : Promise.resolve([]),
      ]);

      return {
        workspaceId: membership.workspaceId,
        name: workspace?.name ?? 'Workspace',
        role: membership.role,
        canManage: manages,
        members: members.map((member) => ({
          userId: member.userId,
          email: member.email,
          role: member.role,
          joinedAt: member.joinedAt,
        })),
        invitations: invitations
          .filter((invitation) => invitation.status !== 'accepted')
          .map((invitation) => ({
            invitationId: invitation.invitationId,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
          })),
      };
    })
  );

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        People who can reach this workspace. Invitations are tied to an email
        address and expire after seven days.
      </p>
      {invitingWorkspaces.length > 0 ? (
        <Card className="mt-8 border-primary/40 bg-primary/5">
          <CardHeader>
            <h2 className="text-lg font-semibold">
              {invitingWorkspaces.length === 1
                ? 'You have an invitation'
                : `You have ${invitingWorkspaces.length} invitations`}
            </h2>
            <CardDescription>
              Accepting adds you to that workspace. It does not affect the
              workspaces you are already in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border bg-background">
              {invitingWorkspaces.map((invitation) => (
                <li
                  key={invitation.invitationId}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {invitation.workspaceName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      As {invitation.role} — expires{' '}
                      {new Date(invitation.expiresAt).toLocaleDateString(
                        undefined,
                        { year: 'numeric', month: 'short', day: 'numeric' }
                      )}
                    </p>
                  </div>
                  {/*
                    Straight to the existing accept page rather than a new
                    action. That page already handles every way this can go
                    wrong — revoked, expired, wrong account — and a second
                    implementation would be a second set of those decisions to
                    keep in agreement.
                  */}
                  <Button asChild size="sm">
                    <Link href={`/invite/${invitation.invitationId}`}>
                      Accept
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-8 space-y-8">
        {workspaces.map((workspace) => (
          <TeamPanel key={workspace.workspaceId} workspace={workspace} />
        ))}
      </div>
    </div>
  );
}
