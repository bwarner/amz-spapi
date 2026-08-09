import type Stripe from 'stripe';
import {
  PLANS,
  billingIntervalSchema,
  priceCentsFor,
  priceEnvVarFor,
  purchasablePlans,
  type BillingInterval,
  type Plan,
  type PlanId,
} from '@farvisionllc/models';
import { stripeClient, BillingNotConfiguredError } from './customers.js';

/**
 * Create the Stripe objects this application cannot run without.
 *
 * ## Why this is code and not a dashboard checklist
 *
 * Several things have to exist in Stripe before billing works, and none of them
 * are created by the application at runtime: a product per purchasable plan, a
 * recurring price per plan PER INTERVAL, a customer portal configuration, and a
 * webhook endpoint. Clicking them into the dashboard works exactly once, in one
 * account. It has to be done again for live mode, and by then nobody remembers
 * that the price needs `planId` in its METADATA — which is the field
 * `readSubscription` reads to decide what a subscriber is entitled to. A price
 * created without it looks completely normal and silently leaves every
 * subscriber on the free allowance.
 *
 * ## Idempotent by metadata, not by name
 *
 * Every lookup here matches on `metadata.product === 'sellavant'` plus
 * `metadata.planId` (and `metadata.interval` for prices). Names get edited in
 * the dashboard by whoever is tidying the product catalogue; metadata does not,
 * and this Stripe account is shared with other products, so "the one called
 * Pilot" is not a safe identifier. Re-running is therefore safe: it adopts what
 * exists and creates only what is missing.
 *
 * ## What it deliberately will not do
 *
 * It never changes the AMOUNT of an existing price. Stripe prices are immutable
 * in amount by design, and the workaround — create a new price, deactivate the
 * old — silently re-prices nobody (existing subscribers keep the old price)
 * while looking like it did something. A mismatch is reported instead, and
 * re-pricing stays a deliberate commercial act performed in the dashboard.
 */

/** Marks everything this application owns in a shared Stripe account. */
const PRODUCT_TAG = 'sellavant';

/** The only events `POST /api/billing/webhook` acts on. */
export const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] =
  [
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ];

const INTERVALS: BillingInterval[] = ['month', 'year'];

export type ProvisionedPrice = {
  interval: BillingInterval;
  priceId: string;
  /** The env var that must carry `priceId`. */
  priceEnvVar: string;
  amountCents: number;
  created: boolean;
  /**
   * Set when an existing price charges something other than the plan table
   * says. Reported, never corrected.
   */
  amountMismatch?: { existingCents: number; expectedCents: number };
};

export type ProvisionedPlan = {
  planId: PlanId;
  productId: string;
  productCreated: boolean;
  prices: ProvisionedPrice[];
};

export type ProvisionResult = {
  /** The account actually written to, so a misdirected run is visible. */
  accountId: string;
  livemode: boolean;
  plans: ProvisionedPlan[];
  portal: { configurationId: string; created: boolean };
  webhook?: {
    id: string;
    url: string;
    created: boolean;
    /** Stripe returns the signing secret ONLY when the endpoint is created. */
    secret?: string;
  };
  /** Env vars this deployment needs, ready to paste. */
  env: Record<string, string>;
  /** Every price whose amount disagrees with the plan table. */
  mismatches: string[];
};

export type ProvisionParams = {
  /**
   * Public URL of `POST /api/billing/webhook`. Omitted for local development,
   * where `stripe listen` forwards to a host Stripe cannot reach.
   */
  webhookUrl?: string;
  /** Where the portal sends people when they are finished. */
  returnUrl: string;
  privacyPolicyUrl: string;
  termsOfServiceUrl: string;
  /** Report what would change and write nothing. */
  dryRun?: boolean;
};

/**
 * Every page of a Stripe list, as one array.
 *
 * Written out rather than taking the first page: a shared account accumulates
 * products from other applications, and a `limit: 100` that silently truncates
 * would make this create a DUPLICATE product on every run — the one failure
 * mode an idempotent provisioner must not have.
 */
async function listAll<T extends { id: string }>(
  page: (startingAfter?: string) => Promise<Stripe.ApiList<T>>
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await page(cursor);
    out.push(...batch.data);
    if (!batch.has_more || batch.data.length === 0) return out;
    cursor = batch.data[batch.data.length - 1]?.id;
    if (!cursor) return out;
  }
}

function planDescription(plan: Plan): string {
  const accounts =
    plan.sellerAccounts === -1
      ? 'Unlimited seller accounts'
      : `${plan.sellerAccounts} seller account${
          plan.sellerAccounts === 1 ? '' : 's'
        }`;
  const seats = plan.seats === -1 ? 'unlimited seats' : `${plan.seats} seats`;
  return `${accounts}, ${seats}, $${plan.includedSpendUsd}/month of included AI usage.`;
}

async function ensureProduct(
  stripe: Stripe,
  plan: Plan,
  dryRun: boolean
): Promise<{ productId: string; created: boolean }> {
  const products = await listAll<Stripe.Product>((startingAfter) =>
    stripe.products.list({
      active: true,
      limit: 100,
      starting_after: startingAfter,
    })
  );

  const existing = products.find(
    (p) =>
      p.metadata?.['product'] === PRODUCT_TAG &&
      p.metadata?.['planId'] === plan.id
  );
  if (existing) return { productId: existing.id, created: false };
  if (dryRun) return { productId: `(would create ${plan.id})`, created: true };

  const created = await stripe.products.create({
    name: `Sellavant ${plan.label}`,
    description: planDescription(plan),
    metadata: { product: PRODUCT_TAG, planId: plan.id },
  });
  return { productId: created.id, created: true };
}

async function ensurePrice(
  stripe: Stripe,
  plan: Plan,
  interval: BillingInterval,
  productId: string,
  dryRun: boolean
): Promise<ProvisionedPrice> {
  const amountCents = priceCentsFor(plan, interval);
  const priceEnvVar = priceEnvVarFor(plan, interval);
  if (!priceEnvVar) {
    throw new Error(
      `Plan "${plan.id}" is purchasable but declares no ${interval} price env var.`
    );
  }

  const pending = productId.startsWith('(');
  if (!pending) {
    const prices = await listAll<Stripe.Price>((startingAfter) =>
      stripe.prices.list({
        product: productId,
        active: true,
        limit: 100,
        starting_after: startingAfter,
      })
    );

    const existing = prices.find(
      (p) =>
        p.type === 'recurring' &&
        p.recurring?.interval === interval &&
        p.metadata?.['planId'] === plan.id
    );
    if (existing) {
      return {
        interval,
        priceId: existing.id,
        priceEnvVar,
        amountCents,
        created: false,
        ...(existing.unit_amount !== amountCents
          ? {
              amountMismatch: {
                existingCents: existing.unit_amount ?? 0,
                expectedCents: amountCents,
              },
            }
          : {}),
      };
    }
  }

  if (dryRun) {
    return {
      interval,
      priceId: `(would create ${plan.id}/${interval} @ ${amountCents})`,
      priceEnvVar,
      amountCents,
      created: true,
    };
  }

  const created = await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: amountCents,
    recurring: { interval },
    nickname: `${plan.label} ${interval === 'year' ? 'yearly' : 'monthly'}`,
    // THE load-bearing field. `readSubscription` reads the plan from here, not
    // from the product name or the amount, because those two get edited and
    // discounted respectively. `interval` is here so the two prices on one
    // product stay distinguishable without parsing `recurring`.
    metadata: { planId: plan.id, interval, product: PRODUCT_TAG },
  });

  return {
    interval,
    priceId: created.id,
    priceEnvVar,
    amountCents,
    created: true,
  };
}

/**
 * The customer portal configuration, referenced explicitly rather than left
 * to the account default.
 *
 * Stripe has one DEFAULT portal configuration per account, editable in the
 * dashboard. This account is shared, so relying on the default means another
 * product's owner can change what our customers are offered — including, via
 * `subscription_update`, being shown somebody else's plans to switch to. Owning
 * a configuration and passing its id removes that entirely.
 */
async function ensurePortalConfiguration(
  stripe: Stripe,
  params: ProvisionParams,
  plans: ProvisionedPlan[],
  dryRun: boolean
): Promise<{ configurationId: string; created: boolean }> {
  const configs = await listAll<Stripe.BillingPortal.Configuration>(
    (startingAfter) =>
      stripe.billingPortal.configurations.list({
        limit: 100,
        starting_after: startingAfter,
      })
  );
  const existing = configs.find((c) => c.metadata?.['product'] === PRODUCT_TAG);

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: {
      enabled: true,
      allowed_updates: ['email', 'address', 'tax_id'],
    },
    subscription_cancel: {
      enabled: true,
      // At period end, not immediately: they have paid for the rest of the
      // month, and cutting access the instant they click cancel is taking it.
      mode: 'at_period_end',
      cancellation_reason: {
        enabled: true,
        options: [
          'too_expensive',
          'missing_features',
          'switched_service',
          'unused',
          'too_complex',
          'other',
        ],
      },
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      // Only OUR plans, and BOTH intervals of each, so the portal is also how
      // somebody moves from monthly to yearly without talking to us.
      //
      // This field is EXPANDABLE, so a plain retrieve comes back without it and
      // looks exactly like a configuration where it never saved. Verify with
      // `expand: ['features.subscription_update.products']` before concluding
      // anything is wrong.
      //
      // Note what it does and does not constrain: it restricts the prices a
      // customer may switch TO, not the ones they may switch FROM. Somebody on
      // a legacy price still sees the portal; they can only move onto these.
      products: plans.map((p) => ({
        product: p.productId,
        prices: p.prices.map((price) => price.priceId),
      })),
    },
  };

  const body = {
    business_profile: {
      headline: 'Sellavant — manage your subscription',
      privacy_policy_url: params.privacyPolicyUrl,
      terms_of_service_url: params.termsOfServiceUrl,
    },
    default_return_url: params.returnUrl,
    features,
    metadata: { product: PRODUCT_TAG },
  };

  if (dryRun) {
    return {
      configurationId: existing?.id ?? '(would create)',
      created: !existing,
    };
  }

  if (existing) {
    // Updated rather than left alone: the plan list embedded in it goes stale
    // the moment a plan or interval is added, and a portal offering a price
    // that no longer exists is a checkout that fails after the customer has
    // decided to pay.
    const updated = await stripe.billingPortal.configurations.update(
      existing.id,
      body
    );
    return { configurationId: updated.id, created: false };
  }

  const created = await stripe.billingPortal.configurations.create(body);
  return { configurationId: created.id, created: true };
}

/**
 * An endpoint's identity, ignoring its query string.
 *
 * A protected preview deployment is reached by putting a bypass token in the
 * QUERY STRING (`?x-vercel-protection-bypass=…`), because Stripe cannot send
 * custom headers. Matching endpoints on the full URL would then treat
 * `…/webhook` and `…/webhook?x-vercel-protection-bypass=abc` as different
 * endpoints and create a second one — two deliveries of every event, and a
 * signing secret that only matches one of them.
 *
 * Falls back to the raw string for anything unparseable rather than throwing;
 * an odd URL in someone else's endpoint must not break provisioning.
 */
function endpointIdentity(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

async function ensureWebhook(
  stripe: Stripe,
  url: string,
  dryRun: boolean
): Promise<NonNullable<ProvisionResult['webhook']>> {
  const endpoints = await listAll<Stripe.WebhookEndpoint>((startingAfter) =>
    stripe.webhookEndpoints.list({ limit: 100, starting_after: startingAfter })
  );
  const wanted = endpointIdentity(url);
  const existing = endpoints.find((e) => endpointIdentity(e.url) === wanted);

  if (dryRun) {
    return { id: existing?.id ?? '(would create)', url, created: !existing };
  }

  if (existing) {
    // Only move the URL when the caller supplied a query string. Otherwise a
    // routine `provision --webhook-url <bare url>` would STRIP an existing
    // bypass token, and every delivery would start bouncing off the
    // deployment-protection redirect — silently, since Stripe treats a 302 as
    // a failure it will simply retry.
    const callerSpecifiedQuery = url.includes('?');
    const keepUrl = callerSpecifiedQuery ? url : existing.url;

    const updated = await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: WEBHOOK_EVENTS,
      disabled: false,
      ...(keepUrl !== existing.url ? { url: keepUrl } : {}),
    });
    // No secret: Stripe returns it only at creation. An existing endpoint's
    // secret has to come from the dashboard, or the endpoint be recreated.
    return { id: updated.id, url: keepUrl, created: false };
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: 'Sellavant — workspace subscription state',
    metadata: { product: PRODUCT_TAG },
  });
  return {
    id: created.id,
    url,
    created: true,
    ...(created.secret ? { secret: created.secret } : {}),
  };
}

/**
 * Bring a Stripe account up to what this application expects.
 *
 * Safe to re-run. Reports the account it wrote to, because the mistake that
 * costs the most here is provisioning the wrong one — a test key and a live key
 * are four characters apart and the API accepts both without comment.
 */
export async function provisionBilling(
  params: ProvisionParams
): Promise<ProvisionResult> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const dryRun = params.dryRun === true;

  // `null` is how stripe-node asks for GET /v1/account — the account the key
  // belongs to — rather than a connected account by id.
  //
  // Optional on purpose. A RESTRICTED key (`rk_…`) is the right thing to use in
  // production, and reading the account needs a scope
  // (`accounts_kyc_basic_read`) that has nothing to do with provisioning. The
  // id is a diagnostic; demanding a broader key to print it would push people
  // toward using an unrestricted one, which is the opposite of the point. The
  // actual live-mode guard reads the key prefix below and still applies.
  const accountId = await stripe.accounts
    .retrieve(null)
    .then((a) => a.id)
    .catch(() => 'unknown (key lacks account-read permission)');

  const plans: ProvisionedPlan[] = [];
  for (const plan of purchasablePlans()) {
    const product = await ensureProduct(stripe, plan, dryRun);

    const prices: ProvisionedPrice[] = [];
    for (const interval of INTERVALS) {
      prices.push(
        await ensurePrice(stripe, plan, interval, product.productId, dryRun)
      );
    }

    plans.push({
      planId: plan.id,
      productId: product.productId,
      productCreated: product.created,
      prices,
    });
  }

  const portal = await ensurePortalConfiguration(stripe, params, plans, dryRun);

  const webhook = params.webhookUrl
    ? await ensureWebhook(stripe, params.webhookUrl, dryRun)
    : undefined;

  const env: Record<string, string> = {
    STRIPE_PORTAL_CONFIGURATION_ID: portal.configurationId,
  };
  const mismatches: string[] = [];
  for (const plan of plans) {
    for (const price of plan.prices) {
      env[price.priceEnvVar] = price.priceId;
      if (price.amountMismatch) {
        mismatches.push(
          `${plan.planId}/${price.interval} ${price.priceId} charges ` +
            `$${(price.amountMismatch.existingCents / 100).toFixed(
              2
            )} but the ` +
            `plan table says $${(
              price.amountMismatch.expectedCents / 100
            ).toFixed(2)}`
        );
      }
    }
  }
  if (webhook?.secret) env['STRIPE_ENDPOINT_SECRET'] = webhook.secret;

  return {
    accountId,
    // From the KEY, not the account object, which carries no `livemode`. A test
    // key can only ever reach test data, so the prefix is the whole truth here
    // — and this value gates the CLI's refusal to write to live without
    // `--live`, so it must not depend on a field Stripe might omit.
    livemode: !/^(sk|rk)_test_/.test(process.env['STRIPE_SECRET_KEY'] ?? ''),
    plans,
    portal,
    ...(webhook ? { webhook } : {}),
    env,
    mismatches,
  };
}

/**
 * Deactivate prices this application owns whose amount no longer matches the
 * plan table.
 *
 * Separate from `provisionBilling`, and separate on purpose: `provision` is
 * safe to run on a schedule and must never change what anybody is charged.
 * This is the deliberate act, and it is still not a re-price — existing
 * subscribers stay on the price they signed up to, because that is what Stripe
 * subscriptions reference. It only stops the stale price being sold again.
 */
export async function deactivateStalePrices(params: {
  dryRun?: boolean;
}): Promise<Array<{ priceId: string; planId: string; reason: string }>> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const wanted = new Set<string>();
  for (const plan of purchasablePlans()) {
    for (const interval of INTERVALS) {
      wanted.add(`${plan.id}:${interval}:${priceCentsFor(plan, interval)}`);
    }
  }

  // Ownership is decided by the PRODUCT, exactly as `ensurePrice` decides it.
  //
  // The obvious shortcut — require `metadata.product === 'sellavant'` on the
  // price — silently misses every price created before that tag was a
  // convention, including the ones this function exists to retire. Provision
  // would keep reporting a mismatch while retirement kept reporting nothing to
  // do, and the two would disagree forever.
  const products = await listAll<Stripe.Product>((startingAfter) =>
    stripe.products.list({
      active: true,
      limit: 100,
      starting_after: startingAfter,
    })
  );
  const ours = new Map<string, string>();
  for (const product of products) {
    const planId = product.metadata?.['planId'];
    if (product.metadata?.['product'] === PRODUCT_TAG && planId) {
      ours.set(product.id, planId);
    }
  }

  const prices: Stripe.Price[] = [];
  for (const productId of ours.keys()) {
    prices.push(
      ...(await listAll<Stripe.Price>((startingAfter) =>
        stripe.prices.list({
          product: productId,
          active: true,
          limit: 100,
          starting_after: startingAfter,
        })
      ))
    );
  }

  const stale = prices.filter((p) => {
    const productId = typeof p.product === 'string' ? p.product : p.product?.id;
    const planId = p.metadata?.['planId'] ?? (productId && ours.get(productId));
    if (!planId || !(planId in PLANS)) return false;
    const interval = billingIntervalSchema.safeParse(p.recurring?.interval);
    if (!interval.success) return true;
    return !wanted.has(`${planId}:${interval.data}:${p.unit_amount ?? -1}`);
  });

  const out: Array<{ priceId: string; planId: string; reason: string }> = [];
  for (const price of stale) {
    const reason = `${((price.unit_amount ?? 0) / 100).toFixed(2)} ${
      price.recurring?.interval ?? '?'
    } no longer in the plan table`;
    out.push({
      priceId: price.id,
      planId: String(price.metadata?.['planId']),
      reason,
    });
    if (!params.dryRun) await stripe.prices.update(price.id, { active: false });
  }
  return out;
}
