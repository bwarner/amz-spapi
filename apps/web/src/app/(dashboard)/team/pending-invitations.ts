/**
 * Which pending invitations to put in front of someone.
 *
 * Extracted from the page so it can be tested without rendering a server
 * component or reaching a database. The rule is small, but it is the only thing
 * standing between an invitation and a silent seven-day expiry, and the two
 * ways to get it wrong — hiding a real one, inventing a redundant one — are
 * both invisible from the outside.
 */

/** The minimum an invitation needs for this decision. */
export type ShowableInvitation = {
  invitationId: string;
  workspaceId: string;
};

export function selectInvitationsToShow<T extends ShowableInvitation>(params: {
  /** Open invitations addressed to this person's email. */
  pending: T[];
  /** Workspace ids they are already a member of. */
  memberOf: string[];
}): T[] {
  const alreadyIn = new Set(params.memberOf);
  return params.pending.filter(
    (invitation) => !alreadyIn.has(invitation.workspaceId)
  );
}
