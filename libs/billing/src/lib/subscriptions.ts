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

/** A promotion code as the customer sees it, resolved to what Stripe needs. */
export type ResolvedPromotion = {
  /** Stripe's `promo_…` id, which is what `discounts` takes. */
  promotionCodeId: string;
  /** The code as typed, for display. */
  code: string;
  /** Human-readable summary, e.g. "50% off for 3 months". */
  description: string;
};

/**
 * Look a customer-facing promotion code up.
 *
 * Stripe's `discounts` parameter takes a `promo_…` id, never the code someone
 * types or puts in a URL, so this translation is unavoidable. It is also the
 * validation step: an unknown, expired or exhausted code returns null here
 * rather than failing the checkout call, which lets the caller decide between
 * "show it applied" and "carry on without it".
 *
 * Deliberately tolerant. A promo code arrives from a query string on a landing
 * page, so it is attacker-controlled and usually just stale. Refusing to create
 * a checkout session because an old ad still points at a finished campaign
 * would turn a marketing problem into a lost sale.
 */
export async function findPromotionCode(
  code: string
): Promise<ResolvedPromotion | null> {
  const stripe = stripeClient();
  if (!stripe) return null;

  const trimmed = code.trim();
  if (!trimmed) return null;

  try {
    const { data } = await stripe.promotionCodes.list({
      code: trimmed,
      active: true,
      limit: 1,
      // The coupon carries the AMOUNT; the promotion code is only the string
      // somebody types. Without expanding it, `coupon` comes back as an id and
      // the banner cannot say what the discount actually is.
      expand: ['data.promotion.coupon'],
    });
    const promo = data[0];
    if (!promo) return null;

    const coupon = promo.promotion?.coupon;
    return {
      promotionCodeId: promo.id,
      code: promo.code,
      // Still a string if the expansion was dropped, which Stripe may do at
      // depth. A vague label beats failing the lookup over a display detail.
      description:
        coupon && typeof coupon !== 'string'
          ? describeCoupon(coupon)
          : 'Discount applied',
    };
  } catch {
    // A lookup failure must not block checkout; the customer can still type the
    // code on Stripe's own page.
    return null;
  }
}

/** "50% off for 3 months", "$20 off once" — what the banner says. */
function describeCoupon(coupon: Stripe.Coupon): string {
  const amount =
    coupon.percent_off != null
      ? `${coupon.percent_off}% off`
      : coupon.amount_off != null
      ? `${(coupon.amount_off / 100).toLocaleString('en-US', {
          style: 'currency',
          currency: (coupon.currency ?? 'usd').toUpperCase(),
        })} off`
      : 'Discount';

  if (coupon.duration === 'forever') return `${amount}, forever`;
  if (coupon.duration === 'repeating' && coupon.duration_in_months) {
    return `${amount} for ${coupon.duration_in_months} months`;
  }
  return `${amount} on your first invoice`;
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
  /** Days of free trial. Omitted or 0 means charge immediately. */
  trialDays?: number;
  /** A `promo_…` id from `findPromotionCode`, applied without the customer typing. */
  promotionCodeId?: string;
}): Promise<{ url: string }> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const trialDays =
    params.trialDays && params.trialDays > 0 ? params.trialDays : undefined;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    subscription_data: {
      // Stamped on the SUBSCRIPTION, not just the session. The webhook receives
      // subscription events long after the session is gone, and this is what
      // lets it find the workspace without a reverse lookup.
      metadata: { workspaceId: params.workspaceId, product: 'sellavant' },
      ...(trialDays ? { trial_period_days: trialDays } : {}),
    },
    // A card is taken even for a trial. The FREE tier is the no-card on-ramp,
    // so nothing here is the only way to evaluate the product — and a card is
    // most of what stops one person taking the trial repeatedly with throwaway
    // addresses, which on a metered product is a direct cash cost.
    payment_method_collection: 'always',
    // Mutually exclusive in Stripe, and the branch matters. A known code is
    // applied silently, which is the good path. When we do not have one — most
    // often because the customer started on another device and the cookie never
    // followed them — Stripe's own field is what keeps the discount reachable
    // at all. See `findPromotionCode`.
    ...(params.promotionCodeId
      ? { discounts: [{ promotion_code: params.promotionCodeId }] }
      : { allow_promotion_codes: true }),
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
  // Selected by METADATA, not by position. Once a metered overage item joins
  // the subscription there are two items and Stripe does not promise an order;
  // reading `data[0]` would find the overage price about half the time, whose
  // `planId` is absent. Nothing would throw — `updateWorkspaceSubscription`
  // leaves `plan` alone when no plan is named — so an upgrade from pilot to
  // scale would simply stop taking effect, silently, for some customers.
  const items = subscription.items?.data ?? [];
  const item = items.find((i) => i.price?.metadata?.['planId']) ?? items[0];
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
