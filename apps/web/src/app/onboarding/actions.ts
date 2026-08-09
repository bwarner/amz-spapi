'use server';

import { redirect } from 'next/navigation';
import { createWorkspaceInputSchema } from '@farvisionllc/models';
import { createWorkspace, listMembershipsForUser } from '@amz-spapi/identity';
import {
  createBillingCustomer,
  linkCustomerToWorkspace,
} from '@amz-spapi/billing';
import { auth0 } from '../../lib/auth0';
import { loggerFor } from '../../lib/logger';
import { captureServerException } from '../../lib/posthog-server';

const log = loggerFor('onboarding');

export type OnboardingState = { error?: string };

/**
 * Create the caller's workspace.
 *
 * This is the ONLY path that provisions one from the product. `resolveAccess`
 * deliberately does not, because it runs on API routes and would otherwise mint
 * a workspace for a curl request; provisioning is a deliberate act, and this is
 * the act.
 *
 * ## Ordering
 *
 * Stripe customer first, workspace second. If the second fails, the leftover is
 * a customer nobody references — invisible, free, and traceable by its
 * `ownerUserId` metadata. The other order leaves a workspace that can spend and
 * can never be billed, and repairing that means guessing which customer belongs
 * to it.
 *
 * ## Idempotency
 *
 * Re-checks membership immediately before writing. Two rapid submits — a
 * double-click, a retried form post — would otherwise create two workspaces and
 * two Stripe customers for one person, and there is no natural key to collapse
 * them on afterwards.
 */
export async function createMyWorkspace(
  _previous: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return { error: 'Your session expired. Sign in again.' };
  }
  const userId = session.user.sub;
  const email = session.user.email;

  const parsed = createWorkspaceInputSchema.safeParse({
    name: formData.get('name'),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'That name will not work.',
    };
  }

  if (!email) {
    // Stripe needs somewhere to send receipts and dunning notices. An account
    // with no email claim cannot be billed, so it is refused here rather than
    // producing a customer nobody can ever reach.
    return {
      error:
        'Your account has no email address, so we cannot set up billing. ' +
        'Sign in with an account that has one.',
    };
  }

  // The race this closes is a double submit, not a hostile one — but the
  // consequence is a duplicate Stripe customer, which is awkward to unpick.
  const existing = await listMembershipsForUser(userId).catch(() => null);
  if (existing === null) {
    return { error: 'We could not reach your account. Please try again.' };
  }
  if (existing.length > 0) redirect('/chat');

  try {
    const { customerId } = await createBillingCustomer({
      email,
      name: parsed.data.name,
      ownerUserId: userId,
    });

    const workspace = await createWorkspace({
      name: parsed.data.name,
      ownerUserId: userId,
      ownerEmail: email,
      stripeCustomerId: customerId,
    });

    // Best-effort: the customer is already correct without it. It exists so a
    // charge in the Stripe dashboard leads back to a workspace.
    await linkCustomerToWorkspace({
      customerId,
      workspaceId: workspace.workspaceId,
    }).catch(() => {
      log.warn(
        { workspaceId: workspace.workspaceId },
        'could not tag customer with workspace'
      );
    });

    log.info({ workspaceId: workspace.workspaceId }, 'workspace provisioned');
  } catch (error) {
    log.error(
      {
        userId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not provision workspace'
    );
    await captureServerException(error, {
      distinctId: userId,
      properties: { feature: 'onboarding' },
    });
    return {
      error:
        'We could not finish setting up your workspace. Please try again — ' +
        'nothing was charged.',
    };
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // turn a success into the error message above.
  redirect('/chat');
}
