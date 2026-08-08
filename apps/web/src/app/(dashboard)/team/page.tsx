import type { Metadata } from 'next';
import { canManageMembers } from '@farvisionllc/models';
import { auth0 } from '../../../lib/auth0';
import {
  getWorkspace,
  listInvitations,
  listMembers,
  listMembershipsForUser,
} from '@amz-spapi/identity';
import { TeamPanel } from './team-panel';

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
      <div className="mt-8 space-y-8">
        {workspaces.map((workspace) => (
          <TeamPanel key={workspace.workspaceId} workspace={workspace} />
        ))}
      </div>
    </div>
  );
}
