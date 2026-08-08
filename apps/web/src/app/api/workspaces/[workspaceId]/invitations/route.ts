import {
  canManageMembers,
  createInvitationInputSchema,
} from '@farvisionllc/models';
import { auth0 } from '../../../../../lib/auth0';
import {
  createInvitation,
  getMembership,
  listInvitations,
} from '@amz-spapi/identity';
import { captureServerException } from '../../../../../lib/posthog-server';
import { loggerFor } from '../../../../../lib/logger';

const log = loggerFor('invitations-api');

/**
 * Invitations for one workspace.
 *
 * Authorisation is by MEMBERSHIP, re-read on every request rather than taken
 * from the session: a role can be changed or revoked between sign-in and now,
 * and a token minted before that would otherwise still carry the old rights.
 * The workspace id in the URL is never trusted on its own — it only selects
 * which membership to look for, and a caller with no membership in it gets the
 * same 404 as one naming a workspace that does not exist. Distinguishing the
 * two would confirm the existence of workspaces the caller cannot see.
 */
async function requireManager(workspaceId: string) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    } as const;
  }

  const membership = await getMembership(workspaceId, session.user.sub);
  if (!membership) {
    return {
      error: Response.json({ error: 'Workspace not found.' }, { status: 404 }),
    } as const;
  }
  if (!canManageMembers(membership.role)) {
    return {
      error: Response.json(
        { error: 'Only an owner or admin can manage invitations.' },
        { status: 403 }
      ),
    } as const;
  }

  return { userId: session.user.sub, membership } as const;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const auth = await requireManager(workspaceId);
  if ('error' in auth) return auth.error;

  const invitations = await listInvitations(workspaceId);
  return Response.json({ invitations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const auth = await requireManager(workspaceId);
  if ('error' in auth) return auth.error;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = createInvitationInputSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json(
      { error: 'Provide a valid email address and a role of admin or member.' },
      { status: 400 }
    );
  }

  try {
    const invitation = await createInvitation({
      workspaceId,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: auth.userId,
    });
    return Response.json({ invitation }, { status: 201 });
  } catch (error) {
    log.error(
      {
        workspaceId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not issue invitation'
    );
    await captureServerException(error, {
      distinctId: auth.userId,
      properties: { feature: 'invitations', phase: 'create', workspaceId },
    });
    return Response.json(
      { error: 'Could not send that invitation. Please try again.' },
      { status: 500 }
    );
  }
}
