import { describe, expect, it } from 'vitest';
import { selectInvitationsToShow } from './pending-invitations';

/**
 * Which invitations a person is shown.
 *
 * The rule exists because `resolveAccess` deliberately does NOT auto-accept for
 * somebody who already has a membership — being added to an organisation should
 * not be a silent side effect of signing in. That decision is right, and it
 * leaves the invitation with nowhere to surface. This is where it surfaces, so
 * getting the filter wrong either hides a real invitation or invents one.
 */

const ws = (n: string) => `ws_${n.padEnd(21, 'x')}`;
const inv = (id: string, workspaceId: string) => ({
  invitationId: `inv_${id.padEnd(21, 'x')}`,
  workspaceId,
});

describe('selectInvitationsToShow', () => {
  it('shows an invitation to a workspace the user is not in', async () => {
    const shown = selectInvitationsToShow({
      pending: [inv('a', ws('acme'))],
      memberOf: [ws('other')],
    });

    expect(shown.map((i) => i.workspaceId)).toEqual([ws('acme')]);
  });

  it('hides an invitation to a workspace the user already belongs to', () => {
    // Offering to "join" somewhere they already are reads as a bug, and
    // accepting it would change nothing. This is the realistic case: an admin
    // re-invites someone who joined in the meantime.
    const shown = selectInvitationsToShow({
      pending: [inv('a', ws('acme'))],
      memberOf: [ws('acme')],
    });

    expect(shown).toEqual([]);
  });

  it('shows several invitations from different clients', () => {
    // The contractor case, and the reason the prompt exists at all: already in
    // one workspace, invited by two more.
    const shown = selectInvitationsToShow({
      pending: [inv('a', ws('acme')), inv('b', ws('beta'))],
      memberOf: [ws('current')],
    });

    expect(shown).toHaveLength(2);
  });

  it('shows nothing when there are no invitations', () => {
    expect(
      selectInvitationsToShow({ pending: [], memberOf: [ws('acme')] })
    ).toEqual([]);
  });

  it('shows an invitation to a user who belongs to nothing yet', () => {
    // Reachable when provisioning half-completed — a profile with no
    // membership. The prompt must not depend on already being a member.
    const shown = selectInvitationsToShow({
      pending: [inv('a', ws('acme'))],
      memberOf: [],
    });

    expect(shown).toHaveLength(1);
  });

  it('does not mutate what it was given', () => {
    // The caller reuses the membership list to render the workspace panels
    // below the prompt.
    const memberOf = [ws('acme')];
    selectInvitationsToShow({ pending: [inv('a', ws('beta'))], memberOf });

    expect(memberOf).toEqual([ws('acme')]);
  });
});
