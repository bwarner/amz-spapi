import type Stripe from 'stripe';
import { PLANS, priceCentsFor } from '@farvisionllc/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The price catalogue, and the one rule that makes it worth having.
 *
 * A row is written ONLY when the Stripe amount equals the plan table. That is
 * what turns "the page and the checkout might disagree" from something you
 * detect into something you cannot express: there is no row that says "sell
 * pilot at an amount the page does not advertise", so no code path can read
 * one.
 *
 * The tests below are mostly about the ways that rule could be quietly lost —
 * a stray dashboard price adopted because it had the right metadata, a
 * currency nobody checked, another product's price in a shared Stripe account,
 * or a withdrawn price left standing because the event that withdrew it only
 * said `active: false`.
 */

const store = new Map<string, unknown>();

const getDocument = vi.fn(async (_d: string, _c: string, key: string) =>
  store.has(key) ? store.get(key) : null
);
const upsertDocument = vi.fn(
  async (_d: string, _c: string, key: string, doc: unknown) => {
    store.set(key, doc);
  }
);
const executeQuery = vi.fn(async () => ({ rows: [...store.values()] }));

vi.mock('@amz-spapi/couchbase-utils', () => ({
  collectionName: (domain: string, collection: string) =>
    `${domain}_${collection}`,
  getDocument: (...args: [string, string, string]) => getDocument(...args),
  upsertDocument: (...args: [string, string, string, unknown]) =>
    upsertDocument(...args),
  executeQuery: () => executeQuery(),
}));

const {
  applyCatalogEvent,
  isCatalogEvent,
  priceForPlan,
  readPriceCatalog,
  syncPriceCatalog,
} = await import('./catalog.js');
const { resetStripeClient } = await import('./customers.js');

const KEY = 'STRIPE_SECRET_KEY';
const original = { ...process.env };

const PILOT_MONTH = priceCentsFor(PLANS.pilot, 'month');
const PILOT_YEAR = priceCentsFor(PLANS.pilot, 'year');
const SCALE_MONTH = priceCentsFor(PLANS.scale, 'month');
const SCALE_YEAR = priceCentsFor(PLANS.scale, 'year');

/** A price as Stripe would return it, correct unless a test says otherwise. */
function price(over: Partial<Stripe.Price> & { product: string }): unknown {
  return {
    id: 'price_default',
    object: 'price',
    type: 'recurring',
    active: true,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {},
    ...over,
  };
}

function ourProduct(planId: string, id: string): unknown {
  return {
    id,
    object: 'product',
    active: true,
    metadata: { product: 'sellavant', planId },
  };
}

/** Every product and price a fully, correctly provisioned account would have. */
function healthy() {
  return {
    products: [
      ourProduct('pilot', 'prod_pilot'),
      ourProduct('scale', 'prod_scale'),
    ],
    prices: [
      price({
        id: 'price_pilot_m',
        product: 'prod_pilot',
        unit_amount: PILOT_MONTH,
        metadata: { planId: 'pilot' },
      }),
      price({
        id: 'price_pilot_y',
        product: 'prod_pilot',
        unit_amount: PILOT_YEAR,
        recurring: { interval: 'year' },
        metadata: { planId: 'pilot' },
      }),
      price({
        id: 'price_scale_m',
        product: 'prod_scale',
        unit_amount: SCALE_MONTH,
        metadata: { planId: 'scale' },
      }),
      price({
        id: 'price_scale_y',
        product: 'prod_scale',
        unit_amount: SCALE_YEAR,
        recurring: { interval: 'year' },
        metadata: { planId: 'scale' },
      }),
    ],
  };
}

async function withStripe(seed: {
  products: unknown[];
  prices: unknown[];
}): Promise<void> {
  const fake = {
    products: { list: vi.fn(async () => ({ data: seed.products })) },
    prices: {
      list: vi.fn(async (q: Stripe.PriceListParams) => ({
        data: seed.prices.filter(
          (p) =>
            (p as { product: string }).product === q.product &&
            (q.active === undefined ||
              (p as { active: boolean }).active === q.active)
        ),
      })),
    },
  };
  const customers = await import('./customers.js');
  vi.spyOn(customers, 'stripeClient').mockReturnValue(
    fake as unknown as Stripe
  );
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  resetStripeClient();
  process.env[KEY] = 'sk_test_x';
});

afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});

describe('syncPriceCatalog', () => {
  it('writes a row for every plan and interval when Stripe agrees', async () => {
    await withStripe(healthy());

    const outcomes = await syncPriceCatalog();

    expect(outcomes.every((o) => o.action === 'written')).toBe(true);
    expect(store.size).toBe(4);
    expect(store.get('pilot::month')).toMatchObject({
      planId: 'pilot',
      interval: 'month',
      priceId: 'price_pilot_m',
      amountCents: PILOT_MONTH,
      active: true,
    });
  });

  it('REFUSES to catalogue a price whose amount is not the plan table', async () => {
    // The rule the whole collection exists for. A price carrying the right
    // metadata but the wrong amount is exactly what a hurried dashboard edit
    // produces, and catalogueing it would quote $99 and charge $89.
    const seed = healthy();
    seed.prices[0] = price({
      id: 'price_wrong',
      product: 'prod_pilot',
      unit_amount: PILOT_MONTH - 1_000,
      metadata: { planId: 'pilot' },
    });
    await withStripe(seed);

    const outcomes = await syncPriceCatalog();

    const pilotMonth = outcomes.find(
      (o) => o.planId === 'pilot' && o.interval === 'month'
    );
    expect(pilotMonth?.action).not.toBe('written');
    expect(pilotMonth?.reason).toContain(
      'no active price matches the plan table'
    );
    expect(store.has('pilot::month')).toBe(false);
    // The other three are unaffected — one bad price must not take the rest
    // of the catalogue down with it.
    expect(store.size).toBe(3);
  });

  it('refuses a price in another CURRENCY', async () => {
    // The plan table is quoted in USD. "9900" of something else is not the
    // same offer, and the amounts compare equal without this check.
    const seed = healthy();
    seed.prices[0] = price({
      id: 'price_eur',
      product: 'prod_pilot',
      currency: 'eur',
      unit_amount: PILOT_MONTH,
      metadata: { planId: 'pilot' },
    });
    await withStripe(seed);

    await syncPriceCatalog();

    expect(store.has('pilot::month')).toBe(false);
  });

  it('ignores prices on products that are not OURS', async () => {
    // The Stripe account is shared with other products. Without the ownership
    // check the catalogue fills with theirs.
    await withStripe({
      products: [
        { id: 'prod_theirs', object: 'product', active: true, metadata: {} },
      ],
      prices: [
        price({
          id: 'price_theirs',
          product: 'prod_theirs',
          unit_amount: PILOT_MONTH,
          metadata: { planId: 'pilot' },
        }),
      ],
    });

    const outcomes = await syncPriceCatalog();

    expect(store.size).toBe(0);
    expect(outcomes.every((o) => o.action !== 'written')).toBe(true);
  });

  it('is idempotent — a second run rewrites nothing', async () => {
    await withStripe(healthy());

    await syncPriceCatalog();
    upsertDocument.mockClear();
    const second = await syncPriceCatalog();

    expect(second.every((o) => o.action === 'unchanged')).toBe(true);
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it('DEACTIVATES a row whose price Stripe no longer offers', async () => {
    // Withdrawal is the case a naive "write what you find" sync gets wrong: it
    // finds nothing, writes nothing, and leaves yesterday's row being charged.
    await withStripe(healthy());
    await syncPriceCatalog();
    expect(store.get('pilot::month')).toMatchObject({ active: true });

    const withdrawn = healthy();
    withdrawn.prices = withdrawn.prices.filter(
      (p) => (p as { id: string }).id !== 'price_pilot_m'
    );
    await withStripe(withdrawn);

    const outcomes = await syncPriceCatalog();

    const pilotMonth = outcomes.find(
      (o) => o.planId === 'pilot' && o.interval === 'month'
    );
    expect(pilotMonth?.action).toBe('deactivated');
    // Kept, not deleted: "went away" and "never existed" are different
    // problems and `billing verify` needs to tell them apart.
    expect(store.get('pilot::month')).toMatchObject({ active: false });
  });
});

describe('priceForPlan', () => {
  it('answers with the catalogued price', async () => {
    await withStripe(healthy());
    await syncPriceCatalog();

    await expect(priceForPlan('scale', 'year')).resolves.toMatchObject({
      priceId: 'price_scale_y',
      amountCents: SCALE_YEAR,
    });
  });

  it('answers null for a plan with no row', async () => {
    await expect(priceForPlan('pilot', 'month')).resolves.toBeNull();
  });

  it('answers null for an INACTIVE row rather than selling it', async () => {
    store.set('pilot::month', {
      planId: 'pilot',
      interval: 'month',
      priceId: 'price_withdrawn',
      productId: 'prod_pilot',
      amountCents: PILOT_MONTH,
      currency: 'usd',
      active: false,
      syncedAt: '2026-08-09T00:00:00.000Z',
    });

    await expect(priceForPlan('pilot', 'month')).resolves.toBeNull();
  });

  it('answers null for a row it cannot PARSE rather than reaching into it', async () => {
    // A half-written or hand-edited document must not become a charge. The
    // shape is the only thing standing between the document and a line item.
    store.set('pilot::month', { planId: 'pilot', priceId: 12345 });

    await expect(priceForPlan('pilot', 'month')).resolves.toBeNull();
  });
});

describe('readPriceCatalog', () => {
  it('keeps deactivated rows, which priceForPlan hides', async () => {
    await withStripe(healthy());
    await syncPriceCatalog();
    const withdrawn = healthy();
    withdrawn.prices = withdrawn.prices.filter(
      (p) => (p as { id: string }).id !== 'price_pilot_m'
    );
    await withStripe(withdrawn);
    await syncPriceCatalog();

    const rows = await readPriceCatalog();

    expect(rows).toHaveLength(4);
    expect(
      rows.find((r) => r.planId === 'pilot' && r.interval === 'month')
    ).toMatchObject({ active: false });
  });

  it('drops unparseable rows instead of throwing', async () => {
    // One corrupt document must not take down `billing verify`, which is the
    // tool you reach for precisely when something is wrong.
    store.set('pilot::month', { nonsense: true });

    await expect(readPriceCatalog()).resolves.toEqual([]);
  });
});

describe('applyCatalogEvent', () => {
  it('recognises the price and product events', () => {
    for (const type of [
      'price.created',
      'price.updated',
      'price.deleted',
      'product.created',
      'product.updated',
      'product.deleted',
    ]) {
      expect(isCatalogEvent(type)).toBe(true);
    }
    expect(isCatalogEvent('customer.subscription.updated')).toBe(false);
  });

  it('ignores an event about somebody ELSE‘s product', async () => {
    await withStripe(healthy());

    const outcome = await applyCatalogEvent({
      type: 'price.created',
      data: { object: { id: 'price_x', metadata: { planId: 'pilot' } } },
    } as unknown as Stripe.Event);

    // No `product: sellavant` tag — this is ScanSafeguard's, and adopting it
    // would put another application's price in front of our customers.
    expect(outcome).toBeNull();
    expect(store.size).toBe(0);
  });

  it('re-reads Stripe rather than trusting the payload', async () => {
    // A `price.updated` that deactivates one price says nothing about whether
    // another matching price exists. Acting on the payload alone would leave
    // the plan unsellable with a perfectly good price sitting next to it.
    await withStripe(healthy());

    const outcome = await applyCatalogEvent({
      type: 'price.updated',
      data: {
        object: {
          id: 'price_stale',
          active: false,
          metadata: { product: 'sellavant', planId: 'pilot' },
        },
      },
    } as unknown as Stripe.Event);

    expect(outcome?.every((o) => o.action === 'written')).toBe(true);
    expect(store.get('pilot::month')).toMatchObject({
      priceId: 'price_pilot_m',
      active: true,
    });
    // Only the plan the event named — a pilot event must not rewrite scale.
    expect(store.has('scale::month')).toBe(false);
  });

  it('syncs both intervals when a PRODUCT changes', async () => {
    await withStripe(healthy());

    const outcome = await applyCatalogEvent({
      type: 'product.updated',
      data: {
        object: {
          id: 'prod_scale',
          metadata: { product: 'sellavant', planId: 'scale' },
        },
      },
    } as unknown as Stripe.Event);

    expect(outcome).toHaveLength(2);
    expect(store.has('scale::month')).toBe(true);
    expect(store.has('scale::year')).toBe(true);
  });
});
