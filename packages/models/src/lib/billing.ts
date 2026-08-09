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
 * ## The numbers here are placeholders
 *
 * The published pricing is quote-based from $299/month, which is a commercial
 * decision and not one to hard-code. Everything below is overridable per
 * deployment by env, and the tier list is meant to be edited. What must NOT be
 * edited away is the shape: an unsubscribed workspace has a small, finite
 * allowance, because "free and unlimited" is the failure this exists to
 * prevent.
 */

export const planIdSchema = z.enum(['trial', 'pilot', 'scale']);
export type PlanId = z.infer<typeof planIdSchema>;

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
  /**
   * What a workspace on this plan may spend per day, in USD, across models,
   * image generation and scrapers combined.
   */
  dailySpendUsd: number;
  /** How many people may belong to the workspace. -1 is unlimited. */
  seats: number;
  /** Absent for a plan nobody subscribes to. */
  priceEnvVar?: string;
};

/**
 * The trial allowance is the single most consequential number in this file.
 *
 * Too low and a genuine seller cannot evaluate the product. Too high and an
 * anonymous signup is a funded attack on the gateway balance. $2/day lets
 * somebody hold a real conversation and generate a few images, and caps the
 * damage from a thousand fake accounts at an amount worth noticing rather than
 * an amount worth panicking about.
 */
export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: 'trial',
    label: 'Trial',
    dailySpendUsd: 2,
    seats: 2,
  },
  pilot: {
    id: 'pilot',
    label: 'Pilot',
    dailySpendUsd: 25,
    seats: 5,
    priceEnvVar: 'STRIPE_PRICE_PILOT',
  },
  scale: {
    id: 'scale',
    label: 'Scale',
    dailySpendUsd: 100,
    seats: -1,
    priceEnvVar: 'STRIPE_PRICE_SCALE',
  },
};

/** What a workspace with no subscription gets. */
export const DEFAULT_PLAN: PlanId = 'trial';

/**
 * Statuses that entitle a workspace to its plan's allowance.
 *
 * `past_due` is deliberately included. A failed renewal is usually an expired
 * card, and cutting a paying customer off the instant Stripe first reports it
 * turns a billing hiccup into an outage they experience as our fault. Stripe
 * retries for days and then moves the subscription to `unpaid` or `canceled`,
 * which are not on this list — that is the point at which the allowance drops
 * back to the trial one.
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
 * A cancelled `scale` workspace is a `trial` workspace — the plan field alone
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
 * `SELLAVANT_DAILY_SPEND_<PLAN>` overrides a tier without a deploy, matching
 * how `cost-ledger` already lets prices be corrected by env. Useful when a
 * pilot customer needs more headroom today and a code change is tomorrow.
 */
export function dailySpendCeilingUsd(params: {
  plan?: PlanId;
  subscriptionStatus?: SubscriptionStatus;
  env?: Record<string, string | undefined>;
}): number {
  const plan = effectivePlan(params);
  const env = params.env ?? process.env;
  const raw = env[`SELLAVANT_DAILY_SPEND_${plan.id.toUpperCase()}`];
  const override = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(override) && override >= 0
    ? override
    : plan.dailySpendUsd;
}

/** Plans a customer can actually buy, in display order. */
export function purchasablePlans(): Plan[] {
  return [PLANS.pilot, PLANS.scale];
}
