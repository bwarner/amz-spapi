import {
  getMembership,
  getWorkspace,
  listMembershipsForUser,
} from '@amz-spapi/identity';
import type { Workspace, WorkspaceMember } from '@farvisionllc/models';

/**
 * The workspace a request acts on.
 *
 * Until documents are re-keyed from `userId` to `workspaceId` a person works in
 * exactly one place, so "their workspace" is unambiguous and this returns the
 * first membership. That assumption is wrong the moment a contractor belongs to
 * two clients, which is why every caller goes through here rather than reaching
 * for `listMembershipsForUser()[0]` itself — when an active-workspace selector
 * arrives, this is the single function that learns about it.
 */

export type WorkspaceContext = {
  workspace: Workspace;
  membership: WorkspaceMember;
};

export async function currentWorkspace(
  userId: string
): Promise<WorkspaceContext | null> {
  const memberships = await listMembershipsForUser(userId);
  const membership = memberships[0];
  if (!membership) return null;

  const workspace = await getWorkspace(membership.workspaceId);
  if (!workspace) return null;

  return { workspace, membership };
}

/**
 * A workspace the caller is provably a member of.
 *
 * Takes the id from the caller and then re-reads the membership, rather than
 * trusting either alone. The id says which workspace; the membership says they
 * may act on it. A billing route that skipped the second check would let anyone
 * open a checkout session against somebody else's Stripe customer.
 */
export async function memberWorkspace(params: {
  userId: string;
  workspaceId: string;
}): Promise<WorkspaceContext | null> {
  const membership = await getMembership(params.workspaceId, params.userId);
  if (!membership) return null;

  const workspace = await getWorkspace(params.workspaceId);
  if (!workspace) return null;

  return { workspace, membership };
}
