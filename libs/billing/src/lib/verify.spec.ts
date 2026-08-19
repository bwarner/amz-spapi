import type Stripe from 'stripe';
import { PLANS } from '@farvisionllc/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The check that follows the path a real payment takes.
 *
 * It starts from the CATALOGUE row checkout reads and walks it out to Stripe
 * and back to the plan table. `syncPriceCatalog` already refuses to write a row
 * whose amount disagrees with the plan table, so what is left here is drift
 * that happens nowhere near a write — most importantly a plan table edited
 * AFTER the last sync, which no write-time rule can catch.
 *
 * Every case below is silent in production. There is no error, no log and no
 * failed request — the customer is quoted one number and charged another, and
 * it surfaces when they complain or when somebody reconciles an invoice.
 */

const store = new Map<string, unknown>();

vi.mock('@amz-spapi/couchbase-utils', () => ({
  collectionName: (domain: string, collection: string) =>
    `${domain}_${collection}`,
  getDocument: async () => null,
  upsertDocument: async () => undefined,
  executeQuery: async () => ({ rows: [...store.values()] }),
}));

const { verifyConfiguredPrices } = await import('./verify.js');
const { resetStripeClient } = await import('./customers.js');

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
    // Both keys, exactly as `provision` stamps them. `product` is the ownership
    // tag the webhook reads to tell this account's applications apart, so a
    // price missing it is a misconfiguration rather than a healthy default.
    metadata: { planId, product: 'sellavant' },
  } as unknown as Partial<Stripe.Price>;
}

async function withStripe(fake: ReturnType<typeof fakeStripe>) {
  const customers = await import('./customers.js');
  vi.spyOn(customers, 'stripeClient').mockReturnValue(
    fake as unknown as Stripe
  );
}

/** A catalogue row, correct unless a test breaks one field of it. */
function row(
  planId: 'pilot' | 'scale',
  interval: 'month' | 'year',
  over: Record<string, unknown> = {}
) {
  const plan = PLANS[planId];
  return {
    planId,
    interval,
    priceId: `price_${planId}_${interval}`,
    productId: `prod_${planId}`,
    amountCents: interval === 'year' ? plan.yearlyCents : plan.monthlyCents,
    currency: 'usd',
    active: true,
    syncedAt: '2026-08-09T00:00:00.000Z',
    ...over,
  };
}

/** Catalogue all four at their correct prices, then break one per test. */
function configureAll() {
  store.clear();
  store.set('pilot::month', row('pilot', 'month'));
  store.set('pilot::year', row('pilot', 'year'));
  store.set('scale::month', row('scale', 'month'));
  store.set('scale::year', row('scale', 'year'));
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
  it('passes when every row points at the right price', async () => {
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(4);
    expect(result.findings.flatMap((f) => f.problems)).toEqual([]);
  });

  /**
   * The headline case, and the one today's hand-rotation could have produced.
   */
  it('catches a row still pointing at a RETIRED price', async () => {
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

  it('catches a MISSING row, which is a 503 at checkout', async () => {
    store.delete('scale::year');
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(false);
    expect(
      result.findings.find((f) => f.planId === 'scale' && f.interval === 'year')
        ?.problems[0]
    ).toContain('no row in the price catalogue');
  });

  it('catches a row DEACTIVATED by the last sync', async () => {
    // Distinct from a missing row: something was catalogued and then withdrawn,
    // which points at a dashboard edit rather than an unprovisioned deployment.
    store.set('pilot::month', row('pilot', 'month', { active: false }));
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.problems.join(' ')).toContain(
      'INACTIVE in the catalogue'
    );
  });

  it('catches a PLAN TABLE edited after the last sync', async () => {
    // The one drift the write-time rule cannot prevent, because it happens
    // nowhere near a write: the row was correct when written and the advertised
    // price moved underneath it. Nothing else notices.
    store.set('pilot::month', row('pilot', 'month', { amountCents: 8_900 }));
    await withStripe(fakeStripe(allGoodPrices()));

    const result = await verifyConfiguredPrices();

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.problems.join(' ')).toContain(
      'is catalogued at $89.00'
    );
  });

  it('catches a price id that no longer exists', async () => {
    store.set(
      'pilot::month',
      row('pilot', 'month', { priceId: 'price_deleted' })
    );
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

  it('catches the yearly price catalogued as monthly', async () => {
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

  it('catches a price missing the OWNERSHIP tag the webhook reads', async () => {
    // The quietest failure of the lot. An untagged price does not grant the
    // wrong plan — `isOurSubscription` refuses the event outright, the route
    // acknowledges it as another application's, and a paying customer sits on
    // the trial allowance with no error anywhere. Only this check finds it.
    const prices = allGoodPrices();
    prices['price_pilot_month'] = {
      ...good('pilot', 'month'),
      metadata: { planId: 'pilot' },
    } as Partial<Stripe.Price>;
    await withStripe(fakeStripe(prices));

    const result = await verifyConfiguredPrices();
    expect(result.findings[0]?.problems.join(' ')).toContain(
      'the webhook will IGNORE subscriptions on this price'
    );
    expect(result.ok).toBe(false);
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
