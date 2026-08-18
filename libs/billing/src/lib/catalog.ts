import type Stripe from 'stripe';
import {
  collectionName,
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  PLANS,
  catalogPriceSchema,
  planIdSchema,
  priceCentsFor,
  purchasablePlans,
  type BillingInterval,
  type CatalogPrice,
  type PlanId,
} from '@farvisionllc/models';
import { stripeClient, BillingNotConfiguredError } from './customers.js';
import { PRODUCT_TAG } from './product-tag.js';

/**
 * The Stripe price catalogue: which price id is plan X at interval Y.
 *
 * ## What this replaces
 *
 * A hand-copied `STRIPE_PRICE_<PLAN>_<INTERVAL>` in four env files and two
 * Vercel scopes. Three numbers could disagree — what the pricing page showed
 * (the plan table), what checkout charged (the env var), and what `provision`
 * inspected (a price it found by metadata) — and nothing compared the first two.
 * The link between the quote and the charge was the one thing never verified.
 *
 * ## The load-bearing rule
 *
 * A row is written ONLY when the Stripe amount equals the plan table. That is
 * what makes page-vs-checkout divergence structurally impossible rather than
 * merely detectable: there is no way to express "sell this plan at a price the
 * page does not advertise", because the row that would say so is never written.
 * A stray price created in the dashboard can never become the thing we sell.
 *
 * The corollary is that a mismatch makes a plan UNSELLABLE rather than
 * mispriced. That is the right way round — a checkout that 503s is a bug
 * someone fixes today, while a checkout that quietly charges $299 against a $99
 * quote is a refund, a chargeback and an apology.
 *
 * ## A projection, not a second source of truth
 *
 * Stripe remains authoritative. This collection is a cache that answers the
 * question without a network call, so the pricing page does not go down when
 * Stripe does, and checkout does not pay a round trip to learn something that
 * changes a few times a year. It is rebuilt, never merged: `syncPriceCatalog`
 * recomputes desired state from Stripe rather than patching what is there.
 */

const DOMAIN = 'billing';
const PRICES = 'prices';

const INTERVALS: BillingInterval[] = ['month', 'year'];

/**
 * The plan table is quoted in USD and `priceCentsFor` returns cents of it.
 * A price in another currency is not the same offer, whatever it amounts to.
 */
const CURRENCY = 'usd';

/**
 * One row per plan per interval, so a write is a single KV upsert and a read on
 * the checkout path is a single KV get — no query, no index, no scan.
 */
function priceKey(planId: PlanId, interval: BillingInterval): string {
  return `${planId}::${interval}`;
}

/** Stripe events that can change what belongs in this collection. */
const CATALOG_EVENT_TYPES = new Set([
  'price.created',
  'price.updated',
  'price.deleted',
  'product.created',
  'product.updated',
  'product.deleted',
]);

export type PriceSyncAction = 'written' | 'deactivated' | 'unchanged';

export type PriceSyncOutcome = {
  planId: PlanId;
  interval: BillingInterval;
  action: PriceSyncAction;
  priceId?: string;
  /** Why a plan ended up with no sellable price. Absent when one was written. */
  reason?: string;
};

/**
 * The sellable price for a plan at an interval, or null.
 *
 * Null covers every "cannot sell this" case — no row, or a row deactivated
 * because Stripe no longer offers a matching price — because the caller's
 * response is the same for all of them and distinguishing invites a call site
 * that handles one and forgets the other. `billing verify` is where the
 * difference is explained.
 */
export async function priceForPlan(
  planId: PlanId,
  interval: BillingInterval
): Promise<CatalogPrice | null> {
  const row = await getDocument<unknown>(
    DOMAIN,
    PRICES,
    priceKey(planId, interval)
  );
  if (!row) return null;

  const parsed = catalogPriceSchema.safeParse(row);
  // A row we cannot parse is a row we must not charge against. Refusing beats
  // reaching into a partially-understood document for `priceId`.
  if (!parsed.success || !parsed.data.active) return null;
  return parsed.data;
}

/**
 * Every row, sellable or not, for `billing verify` and the CLI.
 *
 * Unlike `priceForPlan` this keeps the deactivated ones: "the row exists but
 * Stripe stopped offering it" and "there was never a row" are different
 * operational problems even though checkout treats them alike.
 */
export async function readPriceCatalog(): Promise<CatalogPrice[]> {
  const { rows } = await executeQuery<unknown>(
    DOMAIN,
    `SELECT p.* FROM \`${collectionName(DOMAIN, PRICES)}\` p
      ORDER BY p.planId ASC, p.interval ASC`
  );
  return rows.flatMap((row) => {
    const parsed = catalogPriceSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Our products, by Stripe product id, with the plan each one carries. */
async function ourProducts(stripe: Stripe): Promise<Map<string, PlanId>> {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const ours = new Map<string, PlanId>();
  for (const product of products.data) {
    if (product.metadata?.['product'] !== PRODUCT_TAG) continue;
    const planId = planIdSchema.safeParse(product.metadata?.['planId']);
    if (planId.success) ours.set(product.id, planId.data);
  }
  return ours;
}

/**
 * Mark a row unsellable without deleting it.
 *
 * Kept rather than removed so `billing verify` can say "this plan HAD a price
 * and no longer does", which is a far more useful thing to read at 2am than an
 * absence. Deleting would make a broken deployment and a never-provisioned one
 * look identical.
 */
async function deactivate(
  planId: PlanId,
  interval: BillingInterval,
  reason: string
): Promise<PriceSyncOutcome> {
  const key = priceKey(planId, interval);
  const existing = await getDocument<unknown>(DOMAIN, PRICES, key);
  if (!existing) {
    return { planId, interval, action: 'unchanged', reason };
  }

  const parsed = catalogPriceSchema.safeParse(existing);
  if (parsed.success && !parsed.data.active) {
    return {
      planId,
      interval,
      action: 'unchanged',
      priceId: parsed.data.priceId,
      reason,
    };
  }

  const row: CatalogPrice = parsed.success
    ? { ...parsed.data, active: false, syncedAt: new Date().toISOString() }
    : {
        planId,
        interval,
        priceId: 'unknown',
        productId: 'unknown',
        amountCents: priceCentsFor(PLANS[planId], interval),
        currency: CURRENCY,
        active: false,
        syncedAt: new Date().toISOString(),
      };

  await upsertDocument(DOMAIN, PRICES, key, row);
  return {
    planId,
    interval,
    action: 'deactivated',
    priceId: row.priceId,
    reason,
  };
}

/**
 * Recompute one plan/interval row from Stripe.
 *
 * Deliberately re-reads Stripe rather than trusting the event that triggered
 * it. A `price.updated` that deactivates one price says nothing about whether
 * another matching price exists, and acting only on the payload would leave the
 * plan unsellable while a perfectly good price sat next to it.
 */
async function syncOne(
  stripe: Stripe,
  ours: Map<string, PlanId>,
  planId: PlanId,
  interval: BillingInterval
): Promise<PriceSyncOutcome> {
  const productId = [...ours.entries()].find(
    ([, plan]) => plan === planId
  )?.[0];
  if (!productId) {
    return deactivate(
      planId,
      interval,
      'no active Stripe product for this plan'
    );
  }

  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  });

  const expected = priceCentsFor(PLANS[planId], interval);

  // Matched the same way `provision` matches, so the catalogue names the price
  // provision would adopt rather than a different one that happens to fit.
  const candidates = prices.data.filter(
    (price) =>
      price.type === 'recurring' &&
      price.recurring?.interval === interval &&
      price.metadata?.['planId'] === planId
  );

  if (candidates.length === 0) {
    return deactivate(
      planId,
      interval,
      `no active ${interval}ly price on ${productId} carrying planId "${planId}"`
    );
  }

  const priced = candidates.find(
    (price) => price.unit_amount === expected && price.currency === CURRENCY
  );

  if (!priced) {
    // THE rule. Reported loudly and never written: selling at an amount the
    // page does not advertise is the failure this whole collection exists to
    // make impossible.
    const found = candidates
      .map((p) => `${p.id} ${p.currency} ${p.unit_amount ?? 0}`)
      .join(', ');
    return deactivate(
      planId,
      interval,
      `no active price matches the plan table (${CURRENCY} ${expected}); found ${found}`
    );
  }

  const row: CatalogPrice = {
    planId,
    interval,
    priceId: priced.id,
    productId,
    amountCents: expected,
    currency: CURRENCY,
    active: true,
    syncedAt: new Date().toISOString(),
  };

  const key = priceKey(planId, interval);
  const existing = await getDocument<unknown>(DOMAIN, PRICES, key);
  const before = catalogPriceSchema.safeParse(existing);
  const unchanged =
    before.success &&
    before.data.active &&
    before.data.priceId === row.priceId &&
    before.data.amountCents === row.amountCents &&
    before.data.currency === row.currency &&
    before.data.productId === row.productId;

  if (unchanged) {
    return { planId, interval, action: 'unchanged', priceId: row.priceId };
  }

  await upsertDocument(DOMAIN, PRICES, key, row);
  return { planId, interval, action: 'written', priceId: row.priceId };
}

/**
 * Rebuild the whole catalogue from Stripe.
 *
 * Called by `provision --apply` — which has just created or adopted every price
 * it describes — and by `admincli billing sync-prices` for a manual refresh
 * after a dashboard change.
 */
export async function syncPriceCatalog(): Promise<PriceSyncOutcome[]> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const ours = await ourProducts(stripe);
  const outcomes: PriceSyncOutcome[] = [];
  for (const plan of purchasablePlans()) {
    for (const interval of INTERVALS) {
      outcomes.push(await syncOne(stripe, ours, plan.id, interval));
    }
  }
  return outcomes;
}

/** Both intervals of one plan — what a product-level change can affect. */
async function syncPlanPrices(planId: PlanId): Promise<PriceSyncOutcome[]> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const ours = await ourProducts(stripe);
  const outcomes: PriceSyncOutcome[] = [];
  for (const interval of INTERVALS) {
    outcomes.push(await syncOne(stripe, ours, planId, interval));
  }
  return outcomes;
}

/** Does this event type concern the catalogue at all? */
export function isCatalogEvent(type: string): boolean {
  return CATALOG_EVENT_TYPES.has(type);
}

/**
 * Apply a `price.*` or `product.*` webhook delivery.
 *
 * Returns null when the event is about somebody else's product — this Stripe
 * account is shared, and without the ownership check the catalogue would fill
 * with ScanSafeguard's and My Awesome Resume's prices.
 *
 * Note that `price.updated` cannot carry an amount change; Stripe price amounts
 * are immutable. What it does carry is `active` and metadata, which is exactly
 * what decides whether a row should stand.
 */
export async function applyCatalogEvent(
  event: Stripe.Event
): Promise<PriceSyncOutcome[] | null> {
  if (!isCatalogEvent(event.type)) return null;

  const object = event.data.object as Stripe.Price | Stripe.Product;

  // Both objects carry our tag and plan in metadata, put there by `provision`.
  // Reading it off the event avoids a Stripe round trip for the common case of
  // an event about a product we do not own.
  const planId = planIdSchema.safeParse(object.metadata?.['planId']);
  if (object.metadata?.['product'] !== PRODUCT_TAG || !planId.success) {
    return null;
  }

  return syncPlanPrices(planId.data);
}
