import { z } from 'zod';

/**
 * Workspaces, membership and invitations — who may use Sellavant, and whose
 * data they see.
 *
 * ## Why a workspace exists at all
 *
 * Everything the app stores today is keyed on the Auth0 `sub`, which encodes an
 * assumption that does not survive contact with the customers: that one person
 * equals one seller business. Two requirements break it.
 *
 * A seller operating several marketplaces already holds several connection
 * profiles — `(user_id, api_type, profile_name)`, each with its own
 * `marketplace_id` and `region`. That part works, because they all hang off one
 * user.
 *
 * An agency or contractor does not work. They need to reach several *clients'*
 * accounts, and credentials are keyed to the JWT's user, so today there is no
 * shape that expresses it. A workspace is that shape: it owns the connections,
 * membership is many-to-many, and one contractor belongs to many workspaces.
 *
 * ## What is and is not built yet
 *
 * These types govern **access**: who can sign in, which workspaces they belong
 * to, and with what role. Documents in the other collections are still keyed on
 * `userId` and are re-keyed to `workspaceId` in a later, separate migration.
 * Until that lands a second member can enter a workspace but will not yet see
 * the owner's products or chats — the boundary is deliberate and is the reason
 * roles are recorded now rather than invented later.
 */

/** A workspace id: `ws_` plus 21 url-safe characters. */
export const workspaceIdSchema = z
  .string()
  .regex(/^ws_[A-Za-z0-9_-]{21}$/, 'Not a workspace id');

/** An invitation id, which doubles as the URL slug and the emailed token. */
export const invitationIdSchema = z
  .string()
  .regex(/^inv_[A-Za-z0-9_-]{21}$/, 'Not an invitation id');

/**
 * Roles within a workspace.
 *
 * `owner` is singular and is not invitable — transferring ownership is a
 * distinct action with distinct consequences (billing follows it), not a second
 * invitation. `admin` may invite and revoke; `member` may not.
 */
export const workspaceRoleSchema = z.enum(['owner', 'admin', 'member']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const invitableRoleSchema = z.enum(['admin', 'member']);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

/**
 * Emails are compared, never displayed back as authority — always normalised.
 *
 * Order is load-bearing. Zod applies chained string checks in the order they
 * were added, so `.email()` must come LAST: written as `.email().transform(…)`
 * the validation runs against the raw input and a pasted address with a
 * trailing space is rejected outright rather than trimmed. That failure is
 * invisible in the happy path and shows up as an admin being unable to invite
 * someone whose address they copied out of an email client.
 */
const emailField = z.string().trim().toLowerCase().email();

export const workspaceSchema = z.object({
  workspaceId: workspaceIdSchema,
  type: z.literal('workspace'),
  name: z.string().min(1).max(120),
  /** Auth0 `sub` of the owner. Exactly one per workspace. */
  ownerUserId: z.string().min(1),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceMemberSchema = z.object({
  type: z.literal('workspace_member'),
  workspaceId: workspaceIdSchema,
  /** Auth0 `sub`. */
  userId: z.string().min(1),
  /**
   * The email this membership was created for, kept so an admin can see who is
   * in a workspace without a second lookup against Auth0. Not an identity —
   * `userId` is.
   */
  email: emailField,
  role: workspaceRoleSchema,
  joinedAt: z.number().int(),
  /** Auth0 `sub` of the inviter; null for the owner, who invited nobody. */
  invitedBy: z.string().nullable(),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const invitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'revoked',
  'expired',
]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

/**
 * A stored invitation.
 *
 * Invariants enforced in application code rather than by this schema:
 *
 *  - `status: 'pending'` with `expiresAt` in the past is **expired**. No sweep
 *    job flips it, so every reader must check the timestamp too. Written this
 *    way round on purpose: a missing cron must not silently widen access.
 *  - At most one `pending` invitation per `(workspaceId, email)`. Re-inviting
 *    revokes the previous one first, so a revoked link cannot be resurrected by
 *    sending a fresh one.
 */
export const invitationSchema = z.object({
  invitationId: invitationIdSchema,
  type: z.literal('invitation'),
  workspaceId: workspaceIdSchema,
  email: emailField,
  role: invitableRoleSchema,
  /** Auth0 `sub` of the inviter, who was owner or admin at the time. */
  invitedBy: z.string().min(1),
  status: invitationStatusSchema,
  createdAt: z.number().int(),
  /** Epoch ms. Seven days from creation by default. */
  expiresAt: z.number().int(),
  acceptedAt: z.number().int().optional(),
  /**
   * Auth0 `sub` of whoever accepted. May not correspond to `email` if the
   * invitee signed in with a different identifier, which is why acceptance
   * checks the session email rather than trusting the link alone.
   */
  acceptedByUserId: z.string().optional(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** Body of `POST /api/workspaces/:workspaceId/invitations`. */
export const createInvitationInputSchema = z.object({
  email: emailField,
  role: invitableRoleSchema,
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

/** True when the invitation may still be accepted, timestamp included. */
export function isInvitationOpen(
  invitation: Pick<Invitation, 'status' | 'expiresAt'>,
  now = Date.now()
): boolean {
  return invitation.status === 'pending' && invitation.expiresAt > now;
}

/** Roles permitted to invite and revoke. */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}
