import type Stripe from 'stripe';
import { stripeClient, BillingNotConfiguredError } from './customers.js';

/**
 * Buying a plan, managing it, and reading back what Stripe decided.
 *
 * Nothing here writes to our database. The webhook route does that, because the
 * mapping from a Stripe event to a workspace row is application knowledge and
 * this library deliberately does not know what a workspace is.
 */

/** The price id for a plan, or undefined when the deployment has not set one. */
export function priceIdFor(priceEnvVar: string): string | undefined {
  const value = process.env[priceEnvVar];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * A Checkout session for a subscription.
 *
 * `customer` is passed rather than `customer_email`, which is what keeps one
 * workspace to one Stripe customer. Letting Checkout create its own customer
 * would produce a second one for a person we already know about, and the
 * subscription would land on the wrong record — invisible until somebody
 * wonders why an active subscriber is still on the trial allowance.
 */
export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  workspaceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    // Stamped on the SUBSCRIPTION, not just the session. The webhook receives
    // subscription events long after the session is gone, and this is what
    // lets it find the workspace without a reverse lookup.
    subscription_data: {
      metadata: { workspaceId: params.workspaceId, product: 'sellavant' },
    },
    // Lets a returning customer reuse a saved card instead of retyping it.
    payment_method_collection: 'always',
  });

  if (!session.url) {
    throw new Error('Stripe returned a checkout session with no URL.');
  }
  return { url: session.url };
}

/**
 * The Stripe-hosted portal, for changing card, plan or cancelling.
 *
 * Hosted rather than rebuilt: card capture, dunning, proration, tax and
 * invoice history are a large surface with real compliance weight, and none of
 * it is where this product competes.
 *
 * `STRIPE_PORTAL_CONFIGURATION_ID` names OUR configuration explicitly. Omitting
 * it falls back to the account's default one, which is a shared, dashboard-
 * editable object — and this Stripe account is shared with other products, so
 * the default can change what our customers are offered without anyone touching
 * this repository. Worse, a default with `subscription_update` enabled lists
 * every active price in the account: a Sellavant customer could be shown an
 * unrelated product's plan and switch to it. `admincli billing provision`
 * creates the configuration and prints the id.
 */
export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const configuration = process.env['STRIPE_PORTAL_CONFIGURATION_ID']?.trim();

  const session = await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
    ...(configuration ? { configuration } : {}),
  });
  return { url: session.url };
}

/**
 * Verify a webhook payload actually came from Stripe.
 *
 * Signature checked against the RAW body. Any reserialisation — even
 * `JSON.parse` then `JSON.stringify` — changes the bytes and fails the check,
 * which is why the route hands this the untouched text. Without verification
 * this endpoint is an unauthenticated way for anyone on the internet to grant
 * themselves a subscription.
 */
export function verifyWebhook(params: {
  rawBody: string;
  signature: string;
}): Stripe.Event {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const secret = process.env['STRIPE_ENDPOINT_SECRET'];
  if (!secret) {
    // Refuse rather than skip. An unverified webhook endpoint is worse than a
    // missing one: it looks like it works.
    throw new Error('STRIPE_ENDPOINT_SECRET is not set — refusing to trust.');
  }

  return stripe.webhooks.constructEvent(
    params.rawBody,
    params.signature,
    secret
  );
}

/** What a subscription event says about a workspace's entitlement. */
export type SubscriptionSnapshot = {
  workspaceId?: string;
  customerId: string;
  subscriptionId: string;
  status: string;
  /** Epoch ms. */
  currentPeriodEnd?: number;
  /** The `planId` recorded on the price, when the price carries one. */
  planId?: string;
};

/**
 * Flatten a Stripe subscription into the few fields a workspace stores.
 *
 * The plan comes from the PRICE's metadata rather than the product name or the
 * amount. Names get edited and amounts get discounted; the metadata is the
 * only field we control that survives both.
 */
export function readSubscription(
  subscription: Stripe.Subscription
): SubscriptionSnapshot {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  const periodEnd =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (subscription as unknown as { current_period_end?: number })
      .current_period_end;

  return {
    workspaceId: subscription.metadata?.['workspaceId'] || undefined,
    customerId:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id,
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : undefined,
    planId: price?.metadata?.['planId'] || undefined,
  };
}
