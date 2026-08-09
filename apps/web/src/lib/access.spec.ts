import { beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`. Clear only drops recorded calls and
  // leaves both implementations AND the `mockResolvedValueOnce` queue in place,
  // so a test whose queued values are not all consumed — one that throws part
  // way, say — leaks the remainder into the next test. That produced a cascade
  // where a later case was silently admitted by a leftover membership.
  vi.resetAllMocks();
  listMembershipsForUser.mockResolvedValue([]);
  listPendingInvitationsForEmail.mockResolvedValue([]);
  // The real one returns the created workspace and the caller reads its id.
  createWorkspace.mockResolvedValue({
    workspaceId: 'ws_aaaaaaaaaaaaaaaaaaaaa',
  });
  acceptInvitation.mockResolvedValue({});
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

  it('sends a brand-new account to onboarding rather than refusing it', async () => {
    // Signup is open, so having no workspace is the ordinary first minute of
    // an account — not a rejection.
    const decision = await resolveAccess({ userId: USER, email: EMAIL });

    expect(decision).toEqual({ allowed: false, reason: 'needs-onboarding' });
  });

  it('sends someone with no email claim to onboarding', async () => {
    // An invitation can only be matched by address, so there is nothing to look
    // up — but creating your own workspace needs no email, so they are not stuck.
    const decision = await resolveAccess({ userId: USER });

    expect(decision).toEqual({ allowed: false, reason: 'needs-onboarding' });
  });

  it('fails CLOSED when the membership lookup throws', async () => {
    listMembershipsForUser.mockRejectedValue(new Error('cluster unreachable'));

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

  it('answers 403 until the caller has finished onboarding', async () => {
    const denied = await denyIfWithoutAccess({
      user: { sub: USER, email: EMAIL },
    });

    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual(
      expect.objectContaining({ reason: 'needs-onboarding' })
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
