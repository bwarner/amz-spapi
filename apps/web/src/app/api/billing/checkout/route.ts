import { cookies } from 'next/headers';
import {
  PLANS,
  TRIAL_DAYS,
  billingIntervalSchema,
  isPurchasable,
  planIdSchema,
} from '@farvisionllc/models';
import {
  createCheckoutSession,
  findPromotionCode,
  priceForPlan,
} from '@amz-spapi/billing';
import { auth0 } from '../../../../lib/auth0';
import { currentWorkspace } from '../../../../lib/workspace-context';
import { appBaseUrl } from '../../../../lib/config';
import { loggerFor } from '../../../../lib/logger';
import { captureServerException } from '../../../../lib/posthog-server';
import { promoCodeSchema, readPromoCookie } from '../../../../lib/promo';

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

  let body: { plan?: unknown; interval?: unknown; promo?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const plan = planIdSchema.safeParse(body.plan);
  if (!plan.success) {
    return Response.json({ error: 'Unknown plan.' }, { status: 400 });
  }

  // Defaults to monthly so an older client that sends no interval still works
  // rather than silently being sold a year.
  const interval = billingIntervalSchema.safeParse(body.interval ?? 'month');
  if (!interval.success) {
    return Response.json(
      { error: 'Unknown billing interval.' },
      { status: 400 }
    );
  }

  if (!isPurchasable(PLANS[plan.data])) {
    // The free tier is what you get without paying; a checkout for it would
    // charge somebody for their existing allowance.
    return Response.json(
      { error: 'That plan is not for sale.' },
      { status: 400 }
    );
  }

  // The catalogue, not an env var. A row exists only if its Stripe amount
  // matched the plan table when it was written, so the number quoted on the
  // pricing page and the number this charges cannot disagree.
  //
  // An unreachable catalogue is treated exactly like a missing row: both mean
  // "cannot price this correctly right now", and the only alternative — going
  // ahead on a remembered id — is the silent mischarge this collection exists
  // to prevent. Fails closed, deliberately.
  const price = await priceForPlan(plan.data, interval.data).catch((error) => {
    log.error(
      {
        plan: plan.data,
        interval: interval.data,
        error: error instanceof Error ? error.message : error,
      },
      'could not read the price catalogue'
    );
    return null;
  });
  if (!price) {
    // Configuration, not user error. Guessing a price would be the worst
    // possible recovery — it charges the wrong amount, silently.
    log.error(
      { plan: plan.data, interval: interval.data },
      'no catalogued price for this plan'
    );
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
    // The body wins over the cookie: the customer may have typed a code on the
    // pricing page, and that is a more recent statement of intent than whatever
    // link brought them here weeks ago.
    const fromBody = promoCodeSchema.safeParse(body.promo);
    const code =
      (fromBody.success ? fromBody.data : null) ??
      readPromoCookie(await cookies());
    const promotion = code ? await findPromotionCode(code) : null;
    if (code && !promotion) {
      // Expired campaign, typo, or a code someone invented. Not a reason to
      // refuse the sale — checkout continues and Stripe's own field is offered.
      log.info({ code }, 'promotion code did not resolve; continuing without');
    }

    // A trial is for people who have never subscribed. Without this check,
    // cancelling and resubscribing is an unlimited supply of free weeks.
    const trialDays = context.workspace.stripeSubscriptionId ? 0 : TRIAL_DAYS;

    const base = appBaseUrl();
    const { url } = await createCheckoutSession({
      customerId: context.workspace.stripeCustomerId,
      priceId: price.priceId,
      workspaceId: context.workspace.workspaceId,
      successUrl: `${base}/billing?subscribed=1`,
      // Back to where they started, not to the dashboard — a cancelled
      // checkout should feel like closing a dialog, not like being logged out.
      cancelUrl: `${base}/billing`,
      trialDays,
      ...(promotion ? { promotionCodeId: promotion.promotionCodeId } : {}),
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
