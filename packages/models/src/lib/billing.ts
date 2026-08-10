import { z } from 'zod';

/**
 * Plans, and what they entitle a workspace to spend.
 *
 * ## What this is actually for
 *
 * Signup is open, so anyone can create a workspace and start a chat turn that
 * costs real money against the AI Gateway. An invite gate was only ever a
 * stand-in for the real control, which is billing: you get an allowance, and
 * when it runs out you either pay or stop.
 *
 * So the plan's important field is not a feature list — it is
 * `dailySpendUsd`. That is the number `assertChatTurnWithinBudget` enforces,
 * and the only thing standing between an open signup form and an unbounded
 * bill.
 *
 * ## Two limits, not one
 *
 * `includedSpendUsd` is what the customer BUYS each month. `dailySpendUsd` is
 * the blast radius: the most a workspace can burn in a single day whatever it
 * has bought. Keeping both matters — a monthly pool on its own lets a leaked
 * credential spend the entire month before anybody looks at a dashboard, and a
 * daily cap on its own is not a thing you can sell.
 *
 * ## The limits are per WORKSPACE, not per seat
 *
 * A workspace is the payer: it holds the Stripe customer and the subscription,
 * and every member draws from one pool. Per-seat allowances were the earlier
 * shape and they multiply the worst case by the seat count — a tier with six
 * seats and a $100/day seat allowance is a $600/day liability sold for $299.
 */

export const planIdSchema = z.enum(['free', 'pilot', 'scale']);
export type PlanId = z.infer<typeof planIdSchema>;

/** Monthly or yearly, the two ways a plan can be bought. */
export const billingIntervalSchema = z.enum(['month', 'year']);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/**
 * Stripe's subscription states, as they arrive on the webhook.
 *
 * Kept complete rather than reduced to a boolean: `past_due` and `unpaid` are
 * the interesting ones. A workspace whose card just failed should keep working
 * briefly rather than stop mid-sentence, and that judgement needs the real
 * state, not `active: false`.
 */
export const subscriptionStatusSchema = z.enum([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export type Plan = {
  id: PlanId;
  label: string;
  /** One line under the plan name on the pricing page. */
  tagline: string;
  /**
   * The most this workspace may spend in one UTC day, across models, image
   * generation and scrapers combined. The blast radius, not the product.
   */
  dailySpendUsd: number;
  /**
   * Included AI spend per month, in USD. What the customer is buying. Anything
   * beyond it is overage (Phase 2) rather than a refusal, except that the daily
   * ceiling still applies.
   */
  includedSpendUsd: number;
  /** People who may belong to the workspace, owner included. -1 is unlimited. */
  seats: number;
  /**
   * Amazon seller accounts the workspace may connect.
   *
   * This is the tier's real differentiator, and deliberately so: seats and
   * connected accounts cost us nothing per unit, while AI allowance costs real
   * money. Buying an upgrade with the free lever protects the margin on the
   * expensive one. It is also how the rest of the category tiers.
   */
  sellerAccounts: number;
  /** Monthly list price in cents. 0 for a plan nobody buys. */
  monthlyCents: number;
  /** Yearly list price in cents — ten months, so two are free. */
  yearlyCents: number;
};

/**
 * One row of the Stripe price catalogue (`billing_prices`).
 *
 * `amountCents` is stored even though it must equal `priceCentsFor(plan,
 * interval)` — that is the invariant the writer enforces, and keeping the
 * number lets `billing verify` prove it held rather than assume it.
 */
export const catalogPriceSchema = z.object({
  planId: planIdSchema,
  interval: billingIntervalSchema,
  /** The Stripe `price_…` that checkout will charge. */
  priceId: z.string().min(1),
  /** The Stripe `prod_…` it hangs off, so ownership is auditable from the row. */
  productId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  /**
   * False means Stripe no longer offers a price matching the plan table. The
   * row is kept so the difference between "went away" and "never existed"
   * survives.
   */
  active: z.boolean(),
  /** ISO-8601. When this row was last confirmed against Stripe. */
  syncedAt: z.string().min(1),
});
export type CatalogPrice = z.infer<typeof catalogPriceSchema>;

/**
 * The free allowance is the single most consequential number in this file.
 *
 * Too low and a genuine seller cannot evaluate the product. Too high and an
 * anonymous signup is a funded attack on the gateway balance. $2/day lets
 * somebody hold a real conversation and generate a few images, and caps the
 * damage from a thousand fake accounts at an amount worth noticing rather than
 * an amount worth panicking about.
 *
 * It is a permanent tier rather than a countdown. That is what removes the need
 * for a no-card trial of a paid plan: the free on-ramp already exists, so a
 * card can be required everywhere it matters.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    tagline: 'Evaluate the product on one seller account.',
    dailySpendUsd: 2,
    includedSpendUsd: 15,
    seats: 1,
    sellerAccounts: 1,
    monthlyCents: 0,
    yearlyCents: 0,
  },
  pilot: {
    id: 'pilot',
    label: 'Pilot',
    tagline: 'For a seller running their own catalogue.',
    dailySpendUsd: 5,
    includedSpendUsd: 25,
    seats: 3,
    sellerAccounts: 2,
    monthlyCents: 9_900,
    yearlyCents: 94_800,
  },
  scale: {
    id: 'scale',
    label: 'Scale',
    tagline: 'For agencies and multi-account brands.',
    dailySpendUsd: 15,
    includedSpendUsd: 100,
    seats: 6,
    sellerAccounts: 10,
    monthlyCents: 29_900,
    yearlyCents: 286_800,
  },
};

/** What a workspace with no subscription gets. */
export const DEFAULT_PLAN: PlanId = 'free';

/**
 * Days of free trial on a paid plan.
 *
 * A card is still collected. The free tier is the no-card on-ramp; this is for
 * somebody who has decided to evaluate a paid tier properly, and requiring the
 * card is most of what stops a throwaway email doing it repeatedly.
 */
export const TRIAL_DAYS = 7;

/**
 * What a trialing workspace may spend per day, whatever tier it is trying.
 *
 * Without this a 7-day Scale trial is $105 of gateway spend per signup, before
 * a cent is collected and while still reversible by chargeback. The trial has
 * to be big enough to evaluate the product and small enough that abusing it is
 * not a business model.
 */
export const TRIAL_DAILY_SPEND_USD = 10;

/**
 * Statuses that entitle a workspace to its plan's allowance.
 *
 * `past_due` is deliberately included. A failed renewal is usually an expired
 * card, and cutting a paying customer off the instant Stripe first reports it
 * turns a billing hiccup into an outage they experience as our fault. Stripe
 * retries for days and then moves the subscription to `unpaid` or `canceled`,
 * which are not on this list — that is the point at which the allowance drops
 * back to the free one.
 */
const ENTITLED: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'active',
  'trialing',
  'past_due',
]);

export function isSubscriptionEntitled(
  status: SubscriptionStatus | undefined
): boolean {
  return status !== undefined && ENTITLED.has(status);
}

/**
 * The plan a workspace is actually entitled to right now.
 *
 * A cancelled `scale` workspace is a `free` workspace — the plan field alone
 * is a record of what they bought, not of what they may currently spend, and
 * reading it without the status is how an unpaid account keeps full access.
 */
export function effectivePlan(params: {
  plan?: PlanId;
  subscriptionStatus?: SubscriptionStatus;
}): Plan {
  if (!params.plan || !isSubscriptionEntitled(params.subscriptionStatus)) {
    return PLANS[DEFAULT_PLAN];
  }
  return PLANS[params.plan];
}

/**
 * The daily ceiling for a workspace, in USD.
 *
 * A TRIALING workspace is capped at `TRIAL_DAILY_SPEND_USD` rather than its
 * tier's allowance — it is entitled to the plan's features but has paid
 * nothing yet, and the tier ceilings are sized against money already
 * collected.
 *
 * `SELLAVANT_DAILY_SPEND_<PLAN>` overrides a tier without a deploy, matching
 * how `cost-ledger` already lets prices be corrected by env. Useful when a
 * pilot customer needs more headroom today and a code change is tomorrow.
 * `SELLAVANT_DAILY_SPEND_TRIAL` does the same for the trial ceiling.
 */
export function dailySpendCeilingUsd(params: {
  plan?: PlanId;
  subscriptionStatus?: SubscriptionStatus;
  env?: Record<string, string | undefined>;
}): number {
  const plan = effectivePlan(params);
  const env = params.env ?? process.env;
  const trialing = params.subscriptionStatus === 'trialing';

  const key = trialing
    ? 'SELLAVANT_DAILY_SPEND_TRIAL'
    : `SELLAVANT_DAILY_SPEND_${plan.id.toUpperCase()}`;
  const raw = env[key];

  // An EMPTY value means "declared but not set", not zero. `Number('')` is 0,
  // so without this an env file listing the variable without a value would
  // silently freeze all spending on that tier — a total outage produced by a
  // trailing `=` in a config file.
  const override = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(override) && override >= 0) return override;

  const ceiling = trialing
    ? // Never ABOVE what the tier itself allows: a trial of the free plan (which
      // cannot happen today, but the type permits it) must not beat the plan.
      Math.min(TRIAL_DAILY_SPEND_USD, plan.dailySpendUsd)
    : plan.dailySpendUsd;
  return ceiling;
}

/**
 * Is this workspace out of seats?
 *
 * `committed` counts members plus invitations still outstanding — an unaccepted
 * invitation is a promise of a seat, and ignoring it lets an owner on a
 * three-seat plan issue thirty and have them all accept.
 *
 * `-1` seats means unlimited, and must be checked before the comparison: a
 * plain `committed >= seats` would treat -1 as "no seats at all" and lock
 * everybody out of the most expensive tier.
 */
export function seatLimitReached(plan: Plan, committed: number): boolean {
  if (plan.seats === -1) return false;
  return committed >= plan.seats;
}

/** Plans a customer can actually buy, in display order. */
export function purchasablePlans(): Plan[] {
  return [PLANS.pilot, PLANS.scale];
}

/** Every plan for the pricing page, free first so it anchors the ladder. */
export function displayPlans(): Plan[] {
  return [PLANS.free, PLANS.pilot, PLANS.scale];
}

/**
 * Is this a plan somebody can buy, as opposed to the free tier?
 *
 * Derived from the plan table rather than from the price catalogue on purpose.
 * The pricing page is marketing and must render when Couchbase is unreachable;
 * making "is this for sale" a database question would blank the Buy buttons
 * during an outage of a system the visitor has no relationship with. Whether a
 * price is actually WIRED UP is a different question, asked at checkout, where
 * failing is safe and `billing verify` is the thing that catches it early.
 */
export function isPurchasable(plan: Plan): boolean {
  return plan.monthlyCents > 0 && plan.yearlyCents > 0;
}

/** List price in cents for an interval. */
export function priceCentsFor(plan: Plan, interval: BillingInterval): number {
  return interval === 'year' ? plan.yearlyCents : plan.monthlyCents;
}

/**
 * What a yearly plan works out at per month, in cents — the number the pricing
 * page shows when the annual toggle is on, because nobody compares $948 to $99.
 */
export function monthlyEquivalentCents(plan: Plan): number {
  return Math.round(plan.yearlyCents / 12);
}

/** Percent saved by paying yearly, rounded, or 0 when there is no discount. */
export function yearlySavingPercent(plan: Plan): number {
  if (plan.monthlyCents <= 0 || plan.yearlyCents <= 0) return 0;
  const full = plan.monthlyCents * 12;
  return Math.round(((full - plan.yearlyCents) / full) * 100);
}
