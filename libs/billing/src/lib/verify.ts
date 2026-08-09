import type Stripe from 'stripe';
import {
  priceCentsFor,
  priceEnvVarFor,
  purchasablePlans,
  type BillingInterval,
  type PlanId,
} from '@farvisionllc/models';
import { stripeClient, BillingNotConfiguredError } from './customers.js';
import { priceIdFor } from './subscriptions.js';

/**
 * Does the price this deployment will actually CHARGE match the price the
 * pricing page advertises?
 *
 * ## Why `provision` does not answer this
 *
 * There are three numbers, and it only compares two of them:
 *
 *   1. what the page shows      — the plan table
 *   2. what checkout charges    — the Stripe price named by STRIPE_PRICE_…
 *   3. what provision inspects  — a Stripe price it FINDS BY METADATA
 *
 * `provision` checks 3 against 1 and never reads the env var at all. So the
 * link between what a customer is quoted and what their card is charged is
 * unverified — and that link is a hand-copied price id, which is exactly the
 * kind of thing that is wrong precisely when nobody is looking.
 *
 * This check starts from the env var instead, which is the only starting point
 * that follows the path a real payment takes.
 *
 * ## The realistic failures
 *
 * Not "somebody edited the price" — Stripe amounts are IMMUTABLE, so that
 * cannot happen. Every real failure is about which id is wired up:
 *
 *   - the var still points at a retired price, so the page says $99 and the
 *     card is charged $299;
 *   - it points at a price belonging to another product in a shared account;
 *   - it points at an id that no longer exists, so checkout 500s at the exact
 *     moment somebody decided to pay;
 *   - the monthly variable holds the yearly price.
 *
 * Every one is silent until a customer complains or an invoice is reconciled.
 */

export type PriceFinding = {
  planId: PlanId;
  interval: BillingInterval;
  envVar: string;
  priceId?: string;
  /** Human-readable problems; empty means this one is correct. */
  problems: string[];
};

export type VerifyResult = {
  findings: PriceFinding[];
  /**
   * Active prices on our products that carry a `planId` but are not the ones
   * configured. Not an error — a retired price stays active until somebody
   * retires it — but a future `provision` could adopt one of these instead, so
   * it is worth seeing.
   */
  unexpected: Array<{
    priceId: string;
    planId: string;
    interval: string;
    amountCents: number;
  }>;
  ok: boolean;
};

const PRODUCT_TAG = 'sellavant';
const INTERVALS: BillingInterval[] = ['month', 'year'];

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function verifyConfiguredPrices(): Promise<VerifyResult> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  // Our products, so a configured price can be checked for belonging to us
  // rather than to one of the other applications in this account.
  const products = await stripe.products.list({ active: true, limit: 100 });
  const ours = new Map<string, string>();
  for (const product of products.data) {
    const planId = product.metadata?.['planId'];
    if (product.metadata?.['product'] === PRODUCT_TAG && planId) {
      ours.set(product.id, planId);
    }
  }

  const findings: PriceFinding[] = [];
  const configured = new Set<string>();

  for (const plan of purchasablePlans()) {
    for (const interval of INTERVALS) {
      const envVar = priceEnvVarFor(plan, interval);
      if (!envVar) continue;

      const problems: string[] = [];
      const priceId = priceIdFor(envVar);

      if (!priceId) {
        findings.push({
          planId: plan.id,
          interval,
          envVar,
          problems: [`${envVar} is not set — checkout for this plan will 503`],
        });
        continue;
      }
      configured.add(priceId);

      let price: Stripe.Price | null = null;
      try {
        price = await stripe.prices.retrieve(priceId);
      } catch (error) {
        problems.push(
          `${priceId} could not be retrieved (${
            error instanceof Error ? error.message.split('\n')[0] : 'unknown'
          }) — checkout will fail`
        );
      }

      if (price) {
        const expected = priceCentsFor(plan, interval);

        if (!price.active) {
          problems.push(`${priceId} is INACTIVE — Stripe will refuse checkout`);
        }
        if (price.unit_amount !== expected) {
          // The headline failure: the page quotes one number, the card is
          // charged another.
          problems.push(
            `charges ${money(
              price.unit_amount ?? 0
            )} but the page advertises ` + `${money(expected)}`
          );
        }
        if (price.recurring?.interval !== interval) {
          problems.push(
            `is a ${
              price.recurring?.interval ?? 'one-off'
            } price but is wired ` + `to the ${interval} variable`
          );
        }
        if (price.metadata?.['planId'] !== plan.id) {
          problems.push(
            `carries planId "${price.metadata?.['planId'] ?? 'none'}" — the ` +
              `webhook would grant the wrong plan`
          );
        }
        const productId =
          typeof price.product === 'string' ? price.product : price.product?.id;
        if (!productId || !ours.has(productId)) {
          problems.push(
            `belongs to product ${productId ?? 'unknown'}, which is not ours`
          );
        }
      }

      findings.push({
        planId: plan.id,
        interval,
        envVar,
        ...(priceId ? { priceId } : {}),
        problems,
      });
    }
  }

  // Anything else sellable-looking on our products.
  const unexpected: VerifyResult['unexpected'] = [];
  for (const productId of ours.keys()) {
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });
    for (const price of prices.data) {
      if (configured.has(price.id)) continue;
      if (!price.metadata?.['planId']) continue;
      unexpected.push({
        priceId: price.id,
        planId: String(price.metadata['planId']),
        interval: price.recurring?.interval ?? 'one-off',
        amountCents: price.unit_amount ?? 0,
      });
    }
  }

  return {
    findings,
    unexpected,
    ok: findings.every((f) => f.problems.length === 0),
  };
}
