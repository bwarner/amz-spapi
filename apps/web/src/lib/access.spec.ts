import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who gets in.
 *
 * The gate is the only thing standing between an open Auth0 signup and a chat
 * route that spends real money, and every one of its outcomes is invisible from
 * the outside: a refusal and a grant both look like an ordinary page load. So
 * these cases exercise the decisions rather than the plumbing.
 *
 * The one that matters most is `deniesWhenTheLookupFails`. Access fails CLOSED
 * on a Couchbase error, opposite to the spend cap's deliberate fail-open, and
 * the difference is the whole security posture: an outage that stops chat is an
 * outage, an outage that admits everybody is a breach. A well-meaning
 * refactor that "makes the gate resilient" would invert it, and the browser
 * would look identical either way.
 *
 * The store is mocked rather than pointed at a cluster. These are decisions
 * about what to do with what the store returns, and a live Couchbase would make
 * the suite stateful without testing a single extra branch.
 */

const listMembershipsForUser = vi.fn();
const listPendingInvitationsForEmail = vi.fn();
const createWorkspace = vi.fn();
const acceptInvitation = vi.fn();

vi.mock('@amz-spapi/identity', () => ({
  listMembershipsForUser: (...args: unknown[]) =>
    listMembershipsForUser(...args),
  listPendingInvitationsForEmail: (...args: unknown[]) =>
    listPendingInvitationsForEmail(...args),
  createWorkspace: (...args: unknown[]) => createWorkspace(...args),
  acceptInvitation: (...args: unknown[]) => acceptInvitation(...args),
}));

const { resolveAccess, denyIfWithoutAccess } = await import('./access');

const USER = 'auth0|someone';
const EMAIL = 'someone@example.com';

function membership(overrides: Record<string, unknown> = {}) {
  return {
    type: 'workspace_member',
    workspaceId: 'ws_aaaaaaaaaaaaaaaaaaaaa',
    userId: USER,
    email: EMAIL,
    role: 'member',
    joinedAt: 1,
    invitedBy: null,
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    invitationId: 'inv_aaaaaaaaaaaaaaaaaaaaa',
    type: 'invitation',
    workspaceId: 'ws_aaaaaaaaaaaaaaaaaaaaa',
    email: EMAIL,
    role: 'member',
    invitedBy: 'auth0|owner',
    status: 'pending',
    createdAt: 1,
    expiresAt: Date.now() + 1000,
    ...overrides,
  };
}

const originalOwners = process.env['PLATFORM_OWNER_EMAILS'];

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`. Clear only drops recorded calls and
  // leaves both implementations AND the `mockResolvedValueOnce` queue in place,
  // so a test whose queued values are not all consumed — one that throws part
  // way, say — leaks the remainder into the next test. That produced a cascade
  // where a later case was silently admitted by a leftover membership.
  vi.resetAllMocks();
  delete process.env['PLATFORM_OWNER_EMAILS'];
  listMembershipsForUser.mockResolvedValue([]);
  listPendingInvitationsForEmail.mockResolvedValue([]);
  // The real one returns the created workspace and the caller reads its id.
  createWorkspace.mockResolvedValue({
    workspaceId: 'ws_aaaaaaaaaaaaaaaaaaaaa',
  });
  acceptInvitation.mockResolvedValue({});
});

afterEach(() => {
  if (originalOwners === undefined) delete process.env['PLATFORM_OWNER_EMAILS'];
  else process.env['PLATFORM_OWNER_EMAILS'] = originalOwners;
});

describe('resolveAccess', () => {
  it('admits an existing member without touching invitations', async () => {
    listMembershipsForUser.mockResolvedValue([membership()]);

    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision.allowed).toBe(true);
    // The common path must be one query. Falling through to the invitation
    // lookup on every request would put a second round trip on every page load.
    expect(listPendingInvitationsForEmail).not.toHaveBeenCalled();
  });

  it('admits a member even with no email claim', async () => {
    // Membership is keyed on the Auth0 subject, so it must not depend on an
    // address. This is what made repairing the owner lockout possible without
    // knowing which email their account carried.
    listMembershipsForUser.mockResolvedValue([membership()]);

    const decision = await resolveAccess({ userId: USER });

    expect(decision.allowed).toBe(true);
  });

  it('provisions a workspace for a platform owner on first sign-in', async () => {
    process.env['PLATFORM_OWNER_EMAILS'] = `other@example.com, ${EMAIL}`;
    listMembershipsForUser
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([membership({ role: 'owner' })]);

    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision.allowed).toBe(true);
    expect(createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: USER, ownerEmail: EMAIL })
    );
  });

  it('matches the owner list case-insensitively and ignores surrounding space', async () => {
    // The list is hand-edited in an env file, where a stray space after a comma
    // is the normal state of affairs rather than an error.
    process.env['PLATFORM_OWNER_EMAILS'] = '  SomeOne@Example.COM  ';
    listMembershipsForUser
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([membership({ role: 'owner' })]);

    const decision = await resolveAccess({
      userId: USER,
      email: '  SOMEONE@example.com ',
    });

    expect(decision.allowed).toBe(true);
  });

  it('accepts a pending invitation without requiring the emailed link', async () => {
    listPendingInvitationsForEmail.mockResolvedValue([invitation()]);
    listMembershipsForUser
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([membership()]);

    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision.allowed).toBe(true);
    expect(acceptInvitation).toHaveBeenCalledWith({
      invitationId: 'inv_aaaaaaaaaaaaaaaaaaaaa',
      userId: USER,
      sessionEmail: EMAIL,
    });
  });

  it('accepts the OLDEST pending invitation when several workspaces invited them', async () => {
    // The contractor case. The store returns newest-first, so the last entry is
    // the longest-waiting one — and that is the workspace they were most likely
    // coming here for. Getting the end of the array wrong silently joins them
    // to whichever client invited them most recently.
    const newest = invitation({ invitationId: 'inv_bbbbbbbbbbbbbbbbbbbbb' });
    const oldest = invitation({ invitationId: 'inv_ccccccccccccccccccccc' });
    listPendingInvitationsForEmail.mockResolvedValue([newest, oldest]);
    listMembershipsForUser
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([membership()]);

    await resolveAccess({ userId: USER, email: EMAIL });

    expect(acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: 'inv_ccccccccccccccccccccc' })
    );
  });

  it('refuses someone with no membership, no owner entry and no invitation', async () => {
    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision).toEqual({ allowed: false, reason: 'not-invited' });
  });

  it('refuses when the session carries no email and no membership', async () => {
    // Both remaining routes in are keyed on the address, so there is nothing
    // left to evaluate. Denied rather than guessed.
    process.env['PLATFORM_OWNER_EMAILS'] = EMAIL;

    const decision = await resolveAccess({ userId: USER });

    expect(decision).toEqual({ allowed: false, reason: 'not-invited' });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('does not treat an empty owner list as matching everyone', async () => {
    // `''.split(',')` yields `['']`, so a missing variable becomes a list
    // containing the empty string. An email that is somehow also empty would
    // then match it and be handed a workspace.
    process.env['PLATFORM_OWNER_EMAILS'] = '';

    const decision = await resolveAccess({ userId: USER, email: '' });

    expect(decision.allowed).toBe(false);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the membership lookup throws', async () => {
    listMembershipsForUser.mockRejectedValue(new Error('cluster unreachable'));

    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision).toEqual({ allowed: false, reason: 'lookup-failed' });
  });

  it('fails CLOSED when provisioning throws', async () => {
    process.env['PLATFORM_OWNER_EMAILS'] = EMAIL;
    createWorkspace.mockRejectedValue(new Error('write refused'));

    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision).toEqual({ allowed: false, reason: 'lookup-failed' });
  });

  it('fails CLOSED when accepting an invitation throws', async () => {
    listPendingInvitationsForEmail.mockResolvedValue([invitation()]);
    acceptInvitation.mockRejectedValue(new Error('already accepted'));

    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision).toEqual({ allowed: false, reason: 'lookup-failed' });
  });
});

describe('denyIfWithoutAccess', () => {
  it('lets a member through by returning null', async () => {
    listMembershipsForUser.mockResolvedValue([membership()]);

    const denied = await denyIfWithoutAccess({
      user: { sub: USER, email: EMAIL },
    });

    // null is the "carry on" signal; anything else is a response to return.
    expect(denied).toBeNull();
  });

  it('answers 401 with no session subject', async () => {
    const denied = await denyIfWithoutAccess({ user: {} });

    expect(denied?.status).toBe(401);
  });

  it('answers 403 for an authenticated but uninvited caller', async () => {
    const denied = await denyIfWithoutAccess({
      user: { sub: USER, email: EMAIL },
    });

    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('invite-only') })
    );
  });

  it('answers 503, not 403, when access could not be determined', async () => {
    // The distinction is the difference between a support ticket somebody can
    // answer and one nobody can: 403 tells a user with perfectly good access
    // that they are forbidden.
    listMembershipsForUser.mockRejectedValue(new Error('cluster unreachable'));

    const denied = await denyIfWithoutAccess({
      user: { sub: USER, email: EMAIL },
    });

    expect(denied?.status).toBe(503);
  });
});
