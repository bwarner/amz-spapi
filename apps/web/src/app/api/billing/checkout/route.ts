import { PLANS, planIdSchema } from '@farvisionllc/models';
import { createCheckoutSession, priceIdFor } from '@amz-spapi/billing';
import { auth0 } from '../../../../lib/auth0';
import { currentWorkspace } from '../../../../lib/workspace-context';
import { appBaseUrl } from '../../../../lib/config';
import { loggerFor } from '../../../../lib/logger';
import { captureServerException } from '../../../../lib/posthog-server';

const log = loggerFor('billing-checkout');

/**
 * Start a subscription.
 *
 * Answers a URL rather than redirecting, so the caller is a `fetch` from a
 * button and not a form post — a 303 to Stripe from an API route is awkward to
 * handle when it fails, and the failure here is the interesting case.
 *
 * Only an OWNER may buy. An admin can invite people and manage content; taking
 * on a recurring charge against somebody else's card is a different kind of
 * decision, and the person who receives the invoice should be the one who
 * agreed to it.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { plan?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const plan = planIdSchema.safeParse(body.plan);
  if (!plan.success) {
    return Response.json({ error: 'Unknown plan.' }, { status: 400 });
  }

  const priceEnvVar = PLANS[plan.data].priceEnvVar;
  if (!priceEnvVar) {
    // The default tier is what you get without paying; a checkout for it would
    // charge somebody for their existing allowance.
    return Response.json(
      { error: 'That plan is not for sale.' },
      { status: 400 }
    );
  }

  const priceId = priceIdFor(priceEnvVar);
  if (!priceId) {
    // Configuration, not user error. Guessing a price would be the worst
    // possible recovery — it charges the wrong amount, silently.
    log.error({ priceEnvVar }, 'plan has no configured price');
    return Response.json(
      { error: 'Billing is not fully configured. Please contact support.' },
      { status: 503 }
    );
  }

  const context = await currentWorkspace(session.user.sub);
  if (!context) {
    return Response.json(
      { error: 'Create a workspace before subscribing.' },
      { status: 403 }
    );
  }
  if (context.membership.role !== 'owner') {
    return Response.json(
      { error: 'Only the workspace owner can change the subscription.' },
      { status: 403 }
    );
  }

  try {
    const base = appBaseUrl();
    const { url } = await createCheckoutSession({
      customerId: context.workspace.stripeCustomerId,
      priceId,
      workspaceId: context.workspace.workspaceId,
      successUrl: `${base}/billing?subscribed=1`,
      // Back to where they started, not to the dashboard — a cancelled
      // checkout should feel like closing a dialog, not like being logged out.
      cancelUrl: `${base}/billing`,
    });
    return Response.json({ url });
  } catch (error) {
    log.error(
      {
        workspaceId: context.workspace.workspaceId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not start checkout'
    );
    await captureServerException(error, {
      distinctId: session.user.sub,
      properties: { feature: 'billing', phase: 'checkout' },
    });
    return Response.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 500 }
    );
  }
}
