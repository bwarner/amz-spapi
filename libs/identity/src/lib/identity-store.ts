import crypto from 'node:crypto';
import {
  collectionName,
  executeQuery,
  getDocument,
  insertDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  invitationSchema,
  isInvitationOpen,
  workspaceMemberSchema,
  workspaceSchema,
  type Invitation,
  type InvitableRole,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@farvisionllc/models';

const DOMAIN = 'identity';
const WORKSPACES = 'workspaces';
const MEMBERS = 'members';
const INVITATIONS = 'invitations';

/** Seven days, matching the wording in the invitation email and the UI. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Storage for workspaces, membership and invitations.
 *
 * Everything here is on the authentication path, so the rule throughout is that
 * a failure must never read as "allowed". Where the rest of the codebase fails
 * open on a Couchbase error — the spend cap does, deliberately, so an outage
 * cannot take chat down — this module fails CLOSED. An unreachable cluster
 * means nobody gets in, which is an outage; the alternative is that an
 * unreachable cluster means everybody gets in, which is a breach.
 */

function newId(prefix: string): string {
  return `${prefix}_${crypto
    .randomBytes(16)
    .toString('base64url')
    .slice(0, 21)}`;
}

/**
 * User ids appear in document KEYS, and keys reach logs and error messages that
 * document bodies do not. Hashed for the same reason `cost-ledger` hashes them
 * into its counter keys.
 */
function userKeyPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

function memberKey(workspaceId: string, userId: string): string {
  return `member::${workspaceId}::${userKeyPart(userId)}`;
}

function normaliseEmail(email: string): string {
  return email.toLowerCase().trim();
}

// ── Workspaces ──────────────────────────────────────────────────────────────

/**
 * Create a workspace and its owner membership.
 *
 * Not a transaction: the Data API has no multi-document transaction, so the
 * membership is written second and separately. Ordered that way because the
 * failure it produces is the recoverable one — a workspace with no members is
 * invisible and can be retried onto, whereas a membership pointing at a
 * workspace that does not exist would be a dangling grant.
 */
export async function createWorkspace(params: {
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  /**
   * The Stripe customer to bill, created by the CALLER before it gets here.
   *
   * Passed in rather than created here so this library never learns that Stripe
   * exists — identity is about who may do what, and coupling it to a payment
   * processor would make every test of a membership rule need a billing stub.
   *
   * Required, not optional. An optional field would be satisfied by forgetting
   * it, and the thing being prevented is a workspace that can spend and can
   * never be charged.
   */
  stripeCustomerId: string;
}): Promise<Workspace> {
  const now = Date.now();
  const workspace = workspaceSchema.parse({
    workspaceId: newId('ws'),
    type: 'workspace',
    name: params.name,
    ownerUserId: params.ownerUserId,
    stripeCustomerId: params.stripeCustomerId,
    createdAt: now,
    updatedAt: now,
  });

  await upsertDocument(DOMAIN, WORKSPACES, workspace.workspaceId, workspace);

  await putMember({
    workspaceId: workspace.workspaceId,
    userId: params.ownerUserId,
    email: params.ownerEmail,
    role: 'owner',
    invitedBy: null,
  });

  return workspace;
}

export async function getWorkspace(
  workspaceId: string
): Promise<Workspace | null> {
  const doc = await getDocument<unknown>(DOMAIN, WORKSPACES, workspaceId);
  if (!doc) return null;
  return workspaceSchema.parse(doc);
}

// ── Membership ──────────────────────────────────────────────────────────────

/** Idempotent: re-running with the same pair rewrites the same document. */
export async function putMember(params: {
  workspaceId: string;
  userId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string | null;
}): Promise<WorkspaceMember> {
  const member = workspaceMemberSchema.parse({
    type: 'workspace_member',
    workspaceId: params.workspaceId,
    userId: params.userId,
    email: normaliseEmail(params.email),
    role: params.role,
    joinedAt: Date.now(),
    invitedBy: params.invitedBy,
  });

  await upsertDocument(
    DOMAIN,
    MEMBERS,
    memberKey(params.workspaceId, params.userId),
    member
  );
  return member;
}

export async function getMembership(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMember | null> {
  const doc = await getDocument<unknown>(
    DOMAIN,
    MEMBERS,
    memberKey(workspaceId, userId)
  );
  if (!doc) return null;
  return workspaceMemberSchema.parse(doc);
}

/**
 * Every workspace this user belongs to.
 *
 * The agency case: a contractor is a member of one workspace per client, and
 * this is the list they choose from.
 */
export async function listMembershipsForUser(
  userId: string
): Promise<WorkspaceMember[]> {
  const { rows } = await executeQuery<WorkspaceMember>(
    DOMAIN,
    `SELECT m.* FROM \`${collectionName(DOMAIN, MEMBERS)}\` m
      WHERE m.userId = $userId
      ORDER BY m.joinedAt ASC`,
    { parameters: { userId } }
  );
  return rows.map((row) => workspaceMemberSchema.parse(row));
}

export async function listMembers(
  workspaceId: string
): Promise<WorkspaceMember[]> {
  const { rows } = await executeQuery<WorkspaceMember>(
    DOMAIN,
    `SELECT m.* FROM \`${collectionName(DOMAIN, MEMBERS)}\` m
      WHERE m.workspaceId = $workspaceId
      ORDER BY m.joinedAt ASC`,
    { parameters: { workspaceId } }
  );
  return rows.map((row) => workspaceMemberSchema.parse(row));
}

// ── Invitations ─────────────────────────────────────────────────────────────

export class InvitationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_FOUND'
      | 'EXPIRED'
      | 'ALREADY_USED'
      | 'REVOKED'
      | 'EMAIL_MISMATCH'
      | 'ALREADY_MEMBER'
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}

export async function getInvitation(
  invitationId: string
): Promise<Invitation | null> {
  const doc = await getDocument<unknown>(DOMAIN, INVITATIONS, invitationId);
  if (!doc) return null;
  return invitationSchema.parse(doc);
}

/**
 * Issue an invitation, revoking any pending one for the same address first.
 *
 * The uniqueness rule is what stops a revoked link from being resurrected: if
 * two pending invitations could coexist for one address, revoking the one an
 * admin can see would leave the other still redeemable.
 */
export async function createInvitation(params: {
  workspaceId: string;
  email: string;
  role: InvitableRole;
  invitedBy: string;
}): Promise<Invitation> {
  const email = normaliseEmail(params.email);

  for (const existing of await listPendingInvitationsForEmail(
    email,
    params.workspaceId
  )) {
    await writeInvitation({ ...existing, status: 'revoked' });
  }

  const now = Date.now();
  const invitation = invitationSchema.parse({
    invitationId: newId('inv'),
    type: 'invitation',
    workspaceId: params.workspaceId,
    email,
    role: params.role,
    invitedBy: params.invitedBy,
    status: 'pending',
    createdAt: now,
    expiresAt: now + INVITATION_TTL_MS,
  });

  // Insert, not upsert: a generated id that already exists means the random
  // source is broken, and overwriting somebody else's invitation would be the
  // worst possible response to that.
  const written = await insertDocument(
    DOMAIN,
    INVITATIONS,
    invitation.invitationId,
    invitation
  );
  if (!written) {
    throw new Error('Invitation id collision — refusing to overwrite.');
  }

  return invitation;
}

async function writeInvitation(invitation: Invitation): Promise<Invitation> {
  const parsed = invitationSchema.parse(invitation);
  await upsertDocument(DOMAIN, INVITATIONS, parsed.invitationId, parsed);
  return parsed;
}

/**
 * Pending invitations for an address, optionally within one workspace.
 *
 * Filters on the timestamp as well as the status, because nothing sweeps
 * expired rows — see the schema's note on why that check lives in every reader
 * rather than in a cron.
 */
export async function listPendingInvitationsForEmail(
  email: string,
  workspaceId?: string
): Promise<Invitation[]> {
  const { rows } = await executeQuery<Invitation>(
    DOMAIN,
    `SELECT i.* FROM \`${collectionName(DOMAIN, INVITATIONS)}\` i
      WHERE i.email = $email AND i.status = 'pending'
      ${workspaceId ? 'AND i.workspaceId = $workspaceId' : ''}
      ORDER BY i.createdAt DESC`,
    {
      parameters: workspaceId
        ? { email: normaliseEmail(email), workspaceId }
        : { email: normaliseEmail(email) },
    }
  );
  const now = Date.now();
  return rows
    .map((row) => invitationSchema.parse(row))
    .filter((invitation) => isInvitationOpen(invitation, now));
}

export async function listInvitations(
  workspaceId: string
): Promise<Invitation[]> {
  const { rows } = await executeQuery<Invitation>(
    DOMAIN,
    `SELECT i.* FROM \`${collectionName(DOMAIN, INVITATIONS)}\` i
      WHERE i.workspaceId = $workspaceId
      ORDER BY i.createdAt DESC`,
    { parameters: { workspaceId } }
  );
  return rows.map((row) => invitationSchema.parse(row));
}

export async function revokeInvitation(
  invitationId: string
): Promise<Invitation> {
  const invitation = await getInvitation(invitationId);
  if (!invitation) {
    throw new InvitationError('Invitation not found', 'NOT_FOUND');
  }
  if (invitation.status === 'accepted') {
    // Revoking after the fact would imply removing the member, which is a
    // different action with a different confirmation.
    throw new InvitationError(
      'That invitation was already accepted. Remove the member instead.',
      'ALREADY_USED'
    );
  }
  return writeInvitation({ ...invitation, status: 'revoked' });
}

/**
 * Accept an invitation and create the membership.
 *
 * `sessionEmail` is checked against the invitation rather than trusted from the
 * link, because the link is a bearer token: anyone who obtains the URL — a
 * forwarded email, a shared screen — would otherwise join the workspace. The
 * link proves which invitation; the session proves who.
 */
export async function acceptInvitation(params: {
  invitationId: string;
  userId: string;
  sessionEmail: string;
}): Promise<{ invitation: Invitation; member: WorkspaceMember }> {
  const invitation = await getInvitation(params.invitationId);
  if (!invitation) {
    throw new InvitationError('Invitation not found', 'NOT_FOUND');
  }
  if (invitation.status === 'revoked') {
    throw new InvitationError('This invitation was revoked', 'REVOKED');
  }
  if (invitation.status === 'accepted') {
    throw new InvitationError(
      'This invitation has already been used',
      'ALREADY_USED'
    );
  }
  if (!isInvitationOpen(invitation)) {
    throw new InvitationError('This invitation has expired', 'EXPIRED');
  }
  if (normaliseEmail(params.sessionEmail) !== invitation.email) {
    throw new InvitationError(
      'This invitation was sent to a different email address',
      'EMAIL_MISMATCH'
    );
  }

  const member = await putMember({
    workspaceId: invitation.workspaceId,
    userId: params.userId,
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
  });

  // Membership first, then the status flip. If the second write fails the user
  // is already in — a retry of the whole accept is idempotent, whereas the
  // reverse order could burn the invitation without granting anything.
  const accepted = await writeInvitation({
    ...invitation,
    status: 'accepted',
    acceptedAt: Date.now(),
    acceptedByUserId: params.userId,
  });

  return { invitation: accepted, member };
}
