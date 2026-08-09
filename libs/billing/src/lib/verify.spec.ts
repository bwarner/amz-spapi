import type Stripe from 'stripe';
import { PLANS } from '@farvisionllc/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStripeClient } from './customers.js';
import { verifyConfiguredPrices } from './verify.js';

/**
 * The check that follows the path a real payment takes.
 *
 * `provision` compares the plan table against a price it finds by metadata. It
 * never reads the env var, so it cannot see the one failure that actually
 * charges somebody the wrong amount: a correct price sitting in Stripe while
 * the deployment is wired to a different one.
 *
 * Every case below is silent in production. There is no error, no log and no
 * failed request — the customer is quoted one number and charged another, and
 * it surfaces when they complain or when somebody reconciles an invoice.
 */

const original = { ...process.env };

const PILOT_M = PLANS.pilot.monthlyCents;

function fakeStripe(prices: Record<string, Partial<Stripe.Price>>) {
  return {
    products: {
      list: vi.fn(async () => ({
        data: [
          {
            id: 'prod_pilot',
            active: true,
            metadata: { product: 'sellavant', planId: 'pilot' },
          },
          {
            id: 'prod_scale',
            active: true,
            metadata: { product: 'sellavant', planId: 'scale' },
          },
        ],
        has_more: false,
      })),
    },
    prices: {
      retrieve: vi.fn(async (id: string) => {
        const price = prices[id];
        if (!price) throw new Error(`No such price: ${id}`);
        return price;
      }),
      list: vi.fn(async () => ({ data: [], has_more: false })),
    },
  };
}

/** A correct price for a plan/interval, which tests then break one field of. */
function good(
  planId: 'pilot' | 'scale',
  interval: 'month' | 'year'
): Partial<Stripe.Price> {
  const plan = PLANS[planId];
  return {
    id: `price_${planId}_${interval}`,
    active: true,
    product: `prod_${planId}`,
    unit_amount: interval === 'year' ? plan.yearlyCents : plan.monthlyCents,
    recurring: { interval },
    metadata: { planId },
  } as unknown as Partial<Stripe.Price>;
}

async function withStripe(fake: ReturnType<typeof fakeStripe>) {
  const customers = await import('./customers.js');
  vi.spyOn(customers, 'stripeClient').mockReturnValue(
    fake as unknown as Stripe
  );
}

/** Wire all four variables at their correct prices, then break one per test. */
function configureAll() {
  process.env['STRIPE_PRICE_PILOT_MONTHLY'] = 'price_pilot_month';
  process.env['STRIPE_PRICE_PILOT_YEARLY'] = 'price_pilot_year';
  process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_month';
  process.env['STRIPE_PRICE_SCALE_YEARLY'] = 'price_scale_year';
}

function allGoodPrices() {
  return {
    price_pilot_month: good('pilot', 'month'),
    price_pilot_year: good('pilot', 'year'),
    price_scale_month: good('scale', 'month'),
    price_scale_year: good('scale', 'year'),
  };
}

beforeEach(() => {
  resetStripeClient();
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_x';
  configureAll();
});

afterEach(() => {
  process.env = { ...original };
  resetStripeClient();
  vi.restoreAllMocks();
});

describe('verifyConfiguredPrices', () => {
  it('passes when every variable points at the right price', async () => {
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(4);
    expect(result.findings.flatMap((f) => f.problems)).toEqual([]);
  });

  /**
   * The headline case, and the one today's hand-rotation could have produced.
   */
  it('catches a variable still pointing at a RETIRED price', async () => {
    const prices = allGoodPrices();
    prices['price_pilot_month'] = {
      ...good('pilot', 'month'),
      unit_amount: 29_900, // the old $299
    } as Partial<Stripe.Price>;
    await withStripe(fakeStripe(prices));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(false);
    const pilot = result.findings.find(
      (f) => f.planId === 'pilot' && f.interval === 'month'
    );
    expect(pilot?.problems.join(' ')).toContain('charges $299.00');
    expect(pilot?.problems.join(' ')).toContain(
      `advertises $${(PILOT_M / 100).toFixed(2)}`
    );
  });

  it('catches an unset variable, which is a 503 at checkout', async () => {
    delete process.env['STRIPE_PRICE_SCALE_YEARLY'];
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(false);
    expect(
      result.findings.find((f) => f.planId === 'scale' && f.interval === 'year')
        ?.problems[0]
    ).toContain('not set');
  });

  it('catches a price id that no longer exists', async () => {
    process.env['STRIPE_PRICE_PILOT_MONTHLY'] = 'price_deleted';
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.problems.join(' ')).toContain(
      'could not be retrieved'
    );
  });

  it('catches a DEACTIVATED price, which Stripe refuses at checkout', async () => {
    const prices = allGoodPrices();
    prices['price_pilot_month'] = {
      ...good('pilot', 'month'),
      active: false,
    } as Partial<Stripe.Price>;
    await withStripe(fakeStripe(prices));

    expect(
      (await verifyConfiguredPrices()).findings[0]?.problems.join(' ')
    ).toContain('INACTIVE');
  });

  it('catches the yearly price wired to the monthly variable', async () => {
    const prices = allGoodPrices();
    prices['price_pilot_month'] = good('pilot', 'year');
    await withStripe(fakeStripe(prices));

    const problems = (
      await verifyConfiguredPrices()
    ).findings[0]?.problems.join(' ');
    expect(problems).toContain('is a year price');
  });

  it('catches a price whose planId would grant the WRONG plan', async () => {
    // The webhook reads entitlement from this field, so a mismatch sells Pilot
    // and grants Scale.
    const prices = allGoodPrices();
    prices['price_pilot_month'] = {
      ...good('pilot', 'month'),
      metadata: { planId: 'scale' },
    } as Partial<Stripe.Price>;
    await withStripe(fakeStripe(prices));

    expect(
      (await verifyConfiguredPrices()).findings[0]?.problems.join(' ')
    ).toContain('carries planId "scale"');
  });

  it('catches a price belonging to another product in the shared account', async () => {
    const prices = allGoodPrices();
    prices['price_pilot_month'] = {
      ...good('pilot', 'month'),
      product: 'prod_scansafeguard',
    } as Partial<Stripe.Price>;
    await withStripe(fakeStripe(prices));

    expect(
      (await verifyConfiguredPrices()).findings[0]?.problems.join(' ')
    ).toContain('not ours');
  });

  it('reports a leftover sellable price without failing', async () => {
    // A retired price stays active until somebody retires it. Not an error, but
    // a future `provision` could adopt it, so it is worth surfacing.
    const fake = fakeStripe(allGoodPrices());
    fake.prices.list = vi.fn(async () => ({
      data: [
        {
          id: 'price_orphan',
          active: true,
          unit_amount: 49_900,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        },
      ],
      has_more: false,
    })) as never;
    await withStripe(fake);

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(true);
    expect(result.unexpected.map((u) => u.priceId)).toContain('price_orphan');
  });
});
