import { createPortalSession } from '@amz-spapi/billing';
import { auth0 } from '../../../../lib/auth0';
import { currentWorkspace } from '../../../../lib/workspace-context';
import { appBaseUrl } from '../../../../lib/config';
import { loggerFor } from '../../../../lib/logger';
import { captureServerException } from '../../../../lib/posthog-server';

const log = loggerFor('billing-portal');

/**
 * A link into Stripe's customer portal.
 *
 * Owner only, for the same reason as checkout: the portal can cancel the
 * subscription and change the card, and both belong to whoever receives the
 * invoice rather than to anyone with an admin badge.
 *
 * The session is short-lived and single-customer, so the URL is safe to hand
 * back — but it is still minted per request rather than cached, because a
 * cached one would eventually be a working link to somebody's billing details
 * sitting in a browser history.
 */
export async function POST() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const context = await currentWorkspace(session.user.sub);
  if (!context) {
    return Response.json({ error: 'No workspace.' }, { status: 403 });
  }
  if (context.membership.role !== 'owner') {
    return Response.json(
      { error: 'Only the workspace owner can manage billing.' },
      { status: 403 }
    );
  }

  try {
    const { url } = await createPortalSession({
      customerId: context.workspace.stripeCustomerId,
      returnUrl: `${appBaseUrl()}/billing`,
    });
    return Response.json({ url });
  } catch (error) {
    log.error(
      {
        workspaceId: context.workspace.workspaceId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not open the billing portal'
    );
    await captureServerException(error, {
      distinctId: session.user.sub,
      properties: { feature: 'billing', phase: 'portal' },
    });
    return Response.json(
      { error: 'Could not open billing. Please try again.' },
      { status: 500 }
    );
  }
}
