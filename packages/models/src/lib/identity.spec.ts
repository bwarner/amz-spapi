import { describe, expect, it } from 'vitest';
import {
  canManageMembers,
  createInvitationInputSchema,
  invitationSchema,
  isInvitationOpen,
  workspaceMemberSchema,
} from './identity.js';

/**
 * The rules that decide who gets in.
 *
 * Each case here corresponds to a way the gate could quietly widen: an
 * invitation that outlives its expiry because only the status was checked, an
 * address that matches in one case and not another, a role that can invite when
 * it should not.
 */

const BASE_INVITATION = {
  invitationId: 'inv_abcdefghijklmnopqrstu',
  type: 'invitation' as const,
  workspaceId: 'ws_abcdefghijklmnopqrstu',
  email: 'invitee@example.com',
  role: 'member' as const,
  invitedBy: 'auth0|owner',
  status: 'pending' as const,
  createdAt: 1_000,
  expiresAt: 100_000,
};

describe('isInvitationOpen', () => {
  it('is open while pending and unexpired', () => {
    expect(isInvitationOpen(BASE_INVITATION, 50_000)).toBe(true);
  });

  /**
   * The one that matters most. Nothing sweeps expired invitations, so a reader
   * that checks only `status === 'pending'` would honour a link forever. The
   * schema comment says every reader must check the timestamp; this is what
   * holds that to it.
   */
  it('is closed once expired, even though the status still says pending', () => {
    expect(isInvitationOpen(BASE_INVITATION, 100_001)).toBe(false);
  });

  it('is closed exactly at the expiry instant', () => {
    expect(isInvitationOpen(BASE_INVITATION, 100_000)).toBe(false);
  });

  it.each(['accepted', 'revoked', 'expired'] as const)(
    'is closed when the status is %s',
    (status) => {
      expect(isInvitationOpen({ ...BASE_INVITATION, status }, 50_000)).toBe(
        false
      );
    }
  );
});

describe('canManageMembers', () => {
  it('lets owners and admins invite', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
  });

  it('does not let a plain member invite', () => {
    expect(canManageMembers('member')).toBe(false);
  });
});

describe('createInvitationInputSchema', () => {
  /**
   * Addresses are compared, never displayed as authority. If one write stored
   * `Owner@Example.com ` and the sign-in check looked up `owner@example.com`,
   * the invitation would exist and never be found.
   */
  it('lowercases and trims the email', () => {
    const parsed = createInvitationInputSchema.parse({
      email: '  Invitee@Example.COM ',
      role: 'admin',
    });

    expect(parsed.email).toBe('invitee@example.com');
  });

  it('rejects a role that would grant ownership', () => {
    expect(() =>
      createInvitationInputSchema.parse({
        email: 'invitee@example.com',
        role: 'owner',
      })
    ).toThrow();
  });

  it('rejects a malformed address', () => {
    expect(() =>
      createInvitationInputSchema.parse({
        email: 'not-an-email',
        role: 'member',
      })
    ).toThrow();
  });
});

describe('invitationSchema', () => {
  it('accepts a well-formed invitation', () => {
    expect(() => invitationSchema.parse(BASE_INVITATION)).not.toThrow();
  });

  it('rejects an id that is not in the invitation namespace', () => {
    // A workspace id where an invitation id belongs would otherwise read a
    // workspace document as though it were an invitation.
    expect(() =>
      invitationSchema.parse({
        ...BASE_INVITATION,
        invitationId: 'ws_abcdefghijklmnopqrstu',
      })
    ).toThrow();
  });
});

describe('workspaceMemberSchema', () => {
  it('allows owner as a member role even though it cannot be invited', () => {
    expect(() =>
      workspaceMemberSchema.parse({
        type: 'workspace_member',
        workspaceId: 'ws_abcdefghijklmnopqrstu',
        userId: 'auth0|owner',
        email: 'owner@example.com',
        role: 'owner',
        joinedAt: 1_000,
        invitedBy: null,
      })
    ).not.toThrow();
  });
});
