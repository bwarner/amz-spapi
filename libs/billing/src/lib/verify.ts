import type Stripe from 'stripe';
import {
  priceCentsFor,
  purchasablePlans,
  type BillingInterval,
  type PlanId,
} from '@farvisionllc/models';
import { stripeClient, BillingNotConfiguredError } from './customers.js';
import { readPriceCatalog } from './catalog.js';

/**
 * Does the price this deployment will actually CHARGE match the price the
 * pricing page advertises?
 *
 * ## What changed, and why this check survived it
 *
 * This used to start from `STRIPE_PRICE_<PLAN>_<INTERVAL>`, because that
 * hand-copied env var was the one link nothing else checked. The catalogue
 * removed the env var, and with it most of the ways the answer could be no:
 * `syncPriceCatalog` refuses to write a row whose amount disagrees with the
 * plan table, so page-vs-checkout divergence is now prevented rather than
 * detected.
 *
 * The check is still worth running, because "prevented at write time" only
 * holds if the row was written by the writer we think it was, and stayed true
 * afterwards:
 *
 *   - the plan table can be edited AFTER a sync, leaving a correct-looking row
 *     quoting yesterday's price — the one drift the write-time rule cannot
 *     catch, because it happens nowhere near a write;
 *   - a price can be deactivated in the dashboard, so the row names something
 *     Stripe will refuse at checkout;
 *   - a row can be written against one environment's Stripe account and read in
 *     another, which looks fine until the id 404s;
 *   - `provision` can adopt a different price than the catalogue named, if
 *     somebody minted a second one carrying the same `planId`.
 *
 * Every one is silent until a customer complains or an invoice is reconciled,
 * which is why this is a command and not a comment.
 */

export type PriceFinding = {
  planId: PlanId;
  interval: BillingInterval;
  priceId?: string;
  /** Human-readable problems; empty means this one is correct. */
  problems: string[];
};

export type VerifyResult = {
  findings: PriceFinding[];
  /**
   * Active prices on our products that carry a `planId` but are not the ones in
   * the catalogue. Not an error — a retired price stays active until somebody
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

  // Our products, so a catalogued price can be checked for belonging to us
  // rather than to one of the other applications in this account.
  const products = await stripe.products.list({ active: true, limit: 100 });
  const ours = new Map<string, string>();
  for (const product of products.data) {
    const planId = product.metadata?.['planId'];
    if (product.metadata?.['product'] === PRODUCT_TAG && planId) {
      ours.set(product.id, planId);
    }
  }

  const catalog = new Map(
    (await readPriceCatalog()).map((row) => [
      `${row.planId}::${row.interval}`,
      row,
    ])
  );

  const findings: PriceFinding[] = [];
  const configured = new Set<string>();

  for (const plan of purchasablePlans()) {
    for (const interval of INTERVALS) {
      const problems: string[] = [];
      const row = catalog.get(`${plan.id}::${interval}`);

      if (!row) {
        findings.push({
          planId: plan.id,
          interval,
          problems: [
            'has no row in the price catalogue — checkout for this plan will ' +
              '503. Run `admincli billing provision --apply`',
          ],
        });
        continue;
      }

      if (!row.active) {
        // Distinct from a missing row: something was catalogued and then
        // withdrawn, which usually means a dashboard edit rather than an
        // environment that was never provisioned.
        problems.push(
          'is INACTIVE in the catalogue — the last sync found no Stripe price ' +
            'matching the plan table'
        );
      }

      const expected = priceCentsFor(plan, interval);
      if (row.amountCents !== expected) {
        // The row was correct when written and the plan table has moved since.
        // Nothing else notices this, because the write-time rule only runs at
        // write time.
        problems.push(
          `is catalogued at ${money(row.amountCents)} but the page now ` +
            `advertises ${money(
              expected
            )} — the plan table changed after the ` +
            `last sync; run \`admincli billing sync-prices --apply\``
        );
      }

      configured.add(row.priceId);

      let price: Stripe.Price | null = null;
      try {
        price = await stripe.prices.retrieve(row.priceId);
      } catch (error) {
        problems.push(
          `${row.priceId} could not be retrieved (${
            error instanceof Error ? error.message.split('\n')[0] : 'unknown'
          }) — checkout will fail`
        );
      }

      if (price) {
        if (!price.active) {
          problems.push(
            `${row.priceId} is INACTIVE in Stripe — checkout will be refused`
          );
        }
        if (price.unit_amount !== expected) {
          // The headline failure: the page quotes one number, the card is
          // charged another.
          problems.push(
            `charges ${money(
              price.unit_amount ?? 0
            )} but the page advertises ${money(expected)}`
          );
        }
        if (price.recurring?.interval !== interval) {
          problems.push(
            `is a ${
              price.recurring?.interval ?? 'one-off'
            } price but is catalogued as ${interval}`
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
        priceId: row.priceId,
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
