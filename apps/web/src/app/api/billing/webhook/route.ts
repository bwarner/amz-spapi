import type Stripe from 'stripe';
import { readSubscription, verifyWebhook } from '@amz-spapi/billing';
import {
  findWorkspaceByCustomer,
  updateWorkspaceSubscription,
} from '@amz-spapi/identity';
import { planIdSchema, subscriptionStatusSchema } from '@farvisionllc/models';
import { loggerFor } from '../../../../lib/logger';
import { captureServerException } from '../../../../lib/posthog-server';

const log = loggerFor('billing-webhook');

/**
 * Stripe's view of a subscription, written onto the workspace.
 *
 * This is the only thing that grants a paid allowance. Checkout succeeding
 * proves nothing on its own — the browser can be closed before it redirects,
 * and a subscription can change months later with no browser involved at all.
 *
 * ## Not authenticated by a session, authenticated by a signature
 *
 * There is no user here. The request is trusted because it carries a signature
 * over the RAW body made with a secret only Stripe has. `request.text()` is
 * read before anything else touches it: parsing and reserialising changes the
 * bytes and fails the check, and the failure looks like Stripe misbehaving
 * rather than like our bug.
 *
 * ## Always 200 once verified
 *
 * A non-2xx makes Stripe retry with backoff for days. That is correct for a
 * transient failure and wrong for a permanent one — an event about a workspace
 * that no longer exists would be redelivered forever. Verified-but-unusable
 * events are logged and acknowledged; only a genuine write failure asks for a
 * retry.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = verifyWebhook({ rawBody, signature });
  } catch (error) {
    // 400, not 500: an unverifiable payload is a bad request, and Stripe should
    // not retry it. This is also what an attacker sees.
    log.warn(
      { error: error instanceof Error ? error.message : error },
      'rejected an unverifiable webhook'
    );
    return Response.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const handled = new Set([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ]);
  if (!handled.has(event.type)) {
    // Acknowledged, not an error. Stripe sends many event types and treating
    // the uninteresting ones as failures would put the endpoint in permanent
    // retry.
    return Response.json({ received: true });
  }

  const snapshot = readSubscription(event.data.object as Stripe.Subscription);

  try {
    // `workspaceId` comes from subscription metadata set at checkout. The
    // customer lookup is the fallback for a subscription created in the Stripe
    // dashboard, which carries no metadata of ours — without it those events
    // are unattributable and a paying customer keeps the trial allowance.
    const workspaceId =
      snapshot.workspaceId ??
      (await findWorkspaceByCustomer(snapshot.customerId))?.workspaceId;

    if (!workspaceId) {
      log.warn(
        { customerId: snapshot.customerId, type: event.type },
        'subscription event matches no workspace'
      );
      return Response.json({ received: true, matched: false });
    }

    // A deleted subscription leaves no status worth keeping. Clearing it is
    // what drops the workspace back to the trial allowance — `effectivePlan`
    // treats an absent status as unentitled.
    const status =
      event.type === 'customer.subscription.deleted'
        ? undefined
        : subscriptionStatusSchema.safeParse(snapshot.status).data;

    if (!status && event.type !== 'customer.subscription.deleted') {
      // An unrecognised status is safer refused than guessed: mapping it to
      // "active" would grant an allowance, and to "canceled" would revoke one.
      log.warn(
        { status: snapshot.status, workspaceId },
        'unrecognised subscription status — leaving the workspace unchanged'
      );
      return Response.json({ received: true, matched: false });
    }

    const plan = planIdSchema.safeParse(snapshot.planId).data;

    const updated = await updateWorkspaceSubscription({
      workspaceId,
      plan,
      subscriptionStatus: status,
      stripeSubscriptionId:
        event.type === 'customer.subscription.deleted'
          ? undefined
          : snapshot.subscriptionId,
      currentPeriodEnd:
        event.type === 'customer.subscription.deleted'
          ? undefined
          : snapshot.currentPeriodEnd,
    });

    if (!updated) {
      log.warn({ workspaceId }, 'workspace vanished before the event landed');
      return Response.json({ received: true, matched: false });
    }

    log.info(
      { workspaceId, type: event.type, status: status ?? 'none', plan },
      'subscription synced'
    );
    return Response.json({ received: true });
  } catch (error) {
    // 500 so Stripe retries — this one IS transient, and losing it would leave
    // a paying customer on the trial allowance with nothing to correct it.
    log.error(
      {
        type: event.type,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not apply a subscription event'
    );
    await captureServerException(error, {
      properties: { feature: 'billing', phase: 'webhook', type: event.type },
    });
    return Response.json({ error: 'Could not apply event.' }, { status: 500 });
  }
}
