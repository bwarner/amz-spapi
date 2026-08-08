import { canManageMembers } from '@farvisionllc/models';
import { auth0 } from '../../../../../../lib/auth0';
import {
  getInvitation,
  getMembership,
  InvitationError,
  revokeInvitation,
} from '@amz-spapi/identity';

/**
 * Revoke one invitation.
 *
 * The invitation's own `workspaceId` is compared against the one in the URL.
 * Without that check a manager of workspace A could revoke workspace B's
 * invitation by pairing their own workspace id with a guessed invitation id —
 * the membership check alone proves they manage *something*, not that they
 * manage *this*.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; invitationId: string }> }
) {
  const { workspaceId, invitationId } = await params;

  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await getMembership(workspaceId, session.user.sub);
  if (!membership) {
    return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  }
  if (!canManageMembers(membership.role)) {
    return Response.json(
      { error: 'Only an owner or admin can manage invitations.' },
      { status: 403 }
    );
  }

  const invitation = await getInvitation(invitationId);
  if (!invitation || invitation.workspaceId !== workspaceId) {
    return Response.json({ error: 'Invitation not found.' }, { status: 404 });
  }

  try {
    const revoked = await revokeInvitation(invitationId);
    return Response.json({ invitation: revoked });
  } catch (error) {
    if (error instanceof InvitationError) {
      return Response.json(
        { error: error.message },
        { status: error.code === 'NOT_FOUND' ? 404 : 409 }
      );
    }
    throw error;
  }
}
