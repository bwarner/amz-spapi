import type Stripe from 'stripe';
import { PLANS, purchasablePlans } from '@farvisionllc/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Couchbase is faked so `provisionBilling` can write the price catalogue
 * without a cluster. Left real, every test here would make a network call whose
 * failure `catalogError` deliberately swallows — hiding both the latency and
 * any genuine regression in the catalogue write.
 */
const catalogStore = new Map<string, unknown>();

/**
 * Declared out here rather than reached for with a dynamic `import()`, which
 * would mark `couchbase-utils` lazy-loaded and make the ordinary static import
 * in `catalog.ts` an `enforce-module-boundaries` error.
 */
const catalogUpsert = vi.fn(
  async (_d: string, _c: string, key: string, doc: unknown) => {
    catalogStore.set(key, doc);
  }
);

vi.mock('@amz-spapi/couchbase-utils', () => ({
  collectionName: (domain: string, collection: string) =>
    `${domain}_${collection}`,
  getDocument: async (_d: string, _c: string, key: string) =>
    catalogStore.has(key) ? catalogStore.get(key) : null,
  upsertDocument: (...args: [string, string, string, unknown]) =>
    catalogUpsert(...args),
  executeQuery: async () => ({ rows: [...catalogStore.values()] }),
}));

const { resetStripeClient } = await import('./customers.js');
const { WEBHOOK_EVENTS, deactivateStalePrices, provisionBilling } =
  await import('./provision.js');

/**
 * Provisioning, and the two ways it could quietly ruin an account.
 *
 * The first is DUPLICATION. This runs against a Stripe account shared with
 * other products, and it runs more than once — every environment, and again
 * whenever a plan or an interval is added. A second "Sellavant Pilot" product
 * with its own price is not an error anybody sees: checkout keeps working
 * against whichever price id happens to be in the environment, and the
 * duplicate sits there until somebody reconciles an invoice. So the tests that
 * matter here assert that a second run creates NOTHING.
 *
 * The second is RE-PRICING. Stripe prices are immutable in amount, so the only
 * way to "change" one is to create another — which does not move existing
 * subscribers and therefore looks successful while changing nobody's bill. A
 * mismatch has to be reported and refused, never fixed.
 *
 * Stripe is faked rather than mocked at the HTTP layer: what is being tested is
 * the decision of whether to create, not the SDK's serialisation.
 */

const KEY = 'STRIPE_SECRET_KEY';
const original = { ...process.env };

/** Ids are deterministic so a test can assert on them. */
function fakeStripe(
  seed: {
    products?: Array<Partial<Stripe.Product>>;
    prices?: Array<Partial<Stripe.Price>>;
    configurations?: Array<Partial<Stripe.BillingPortal.Configuration>>;
    webhooks?: Array<Partial<Stripe.WebhookEndpoint>>;
  } = {}
) {
  const products = [...(seed.products ?? [])];
  const prices = [...(seed.prices ?? [])];
  const configurations = [...(seed.configurations ?? [])];
  const webhooks = [...(seed.webhooks ?? [])];
  let n = 0;
  const id = (prefix: string) => `${prefix}_${++n}`;

  const list = <T>(data: T[]) => ({ data, has_more: false });

  return {
    accounts: { retrieve: vi.fn(async () => ({ id: 'acct_test' })) },
    products: {
      list: vi.fn(async () => list(products)),
      create: vi.fn(async (body: Stripe.ProductCreateParams) => {
        const created = { id: id('prod'), ...body };
        products.push(created as unknown as Stripe.Product);
        return created;
      }),
    },
    prices: {
      list: vi.fn(async (q: Stripe.PriceListParams) =>
        list(q.product ? prices.filter((p) => p.product === q.product) : prices)
      ),
      create: vi.fn(async (body: Stripe.PriceCreateParams) => {
        const created = {
          id: id('price'),
          type: 'recurring',
          active: true,
          ...body,
        };
        prices.push(created as unknown as Stripe.Price);
        return created;
      }),
      update: vi.fn(async (pid: string, body: object) => ({
        id: pid,
        ...body,
      })),
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => list(configurations)),
        create: vi.fn(async (body: object) => {
          const created = { id: id('bpc'), ...body };
          configurations.push(
            created as unknown as Stripe.BillingPortal.Configuration
          );
          return created;
        }),
        update: vi.fn(async (cid: string, body: object) => ({
          id: cid,
          ...body,
        })),
      },
    },
    webhookEndpoints: {
      list: vi.fn(async () => list(webhooks)),
      create: vi.fn(async (body: Stripe.WebhookEndpointCreateParams) => {
        const created = { id: id('we'), secret: 'whsec_brand_new', ...body };
        webhooks.push(created as unknown as Stripe.WebhookEndpoint);
        return created;
      }),
      update: vi.fn(async (wid: string, body: object) => ({
        id: wid,
        ...body,
      })),
    },
    _state: { products, prices, configurations, webhooks },
  };
}

/** Install the fake as the memoised client the module under test reaches for. */
async function withStripe(fake: ReturnType<typeof fakeStripe>) {
  const customers = await import('./customers.js');
  vi.spyOn(customers, 'stripeClient').mockReturnValue(
    fake as unknown as Stripe
  );
}

const params = {
  returnUrl: 'https://sellavant.com/billing',
  privacyPolicyUrl: 'https://sellavant.com/privacy',
  termsOfServiceUrl: 'https://sellavant.com/terms',
};

const PAID = purchasablePlans().length;

beforeEach(() => {
  catalogStore.clear();
  catalogUpsert.mockImplementation(
    async (_d: string, _c: string, key: string, doc: unknown) => {
      catalogStore.set(key, doc);
    }
  );
  resetStripeClient();
  process.env[KEY] = 'sk_test_x';
});

afterEach(() => {
  process.env = { ...original };
  resetStripeClient();
  vi.restoreAllMocks();
});

describe('provisionBilling', () => {
  it('creates a product and BOTH interval prices for every purchasable plan', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.plans).toHaveLength(PAID);
    expect(fake.products.create).toHaveBeenCalledTimes(PAID);
    expect(fake.prices.create).toHaveBeenCalledTimes(PAID * 2);

    for (const plan of result.plans) {
      expect(plan.prices.map((p) => p.interval).sort()).toEqual([
        'month',
        'year',
      ]);
    }
    // The free plan is not for sale and must never get a product or price.
    expect(result.plans.some((p) => p.planId === 'free')).toBe(false);
  });

  it('puts planId in the PRICE metadata — the field entitlement is read from', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    await provisionBilling(params);

    for (const call of fake.prices.create.mock.calls) {
      const body = call[0] as Stripe.PriceCreateParams;
      expect(body.metadata?.['planId']).toMatch(/^(pilot|scale)$/);
      expect(body.metadata?.['interval']).toMatch(/^(month|year)$/);
      expect(body.currency).toBe('usd');
    }
  });

  it('charges the amounts in the plan table', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    for (const provisioned of result.plans) {
      const plan = PLANS[provisioned.planId];
      const monthly = provisioned.prices.find((p) => p.interval === 'month');
      const yearly = provisioned.prices.find((p) => p.interval === 'year');
      expect(monthly?.amountCents).toBe(plan.monthlyCents);
      expect(yearly?.amountCents).toBe(plan.yearlyCents);
    }
  });

  it('creates nothing on a second run', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const first = await provisionBilling(params);
    fake.products.create.mockClear();
    fake.prices.create.mockClear();
    fake.billingPortal.configurations.create.mockClear();

    const second = await provisionBilling(params);

    expect(fake.products.create).not.toHaveBeenCalled();
    expect(fake.prices.create).not.toHaveBeenCalled();
    expect(fake.billingPortal.configurations.create).not.toHaveBeenCalled();
    // And it adopts the same objects, so the env it prints stays stable.
    expect(second.env).toEqual(first.env);
  });

  it('adds only the MISSING interval to a product that has one price', async () => {
    // The upgrade path from the single-interval era: the monthly price exists
    // and must be adopted, not duplicated, while yearly gets created.
    const fake = fakeStripe({
      products: [
        {
          id: 'prod_pilot',
          active: true,
          metadata: { product: 'sellavant', planId: 'pilot' },
        } as Partial<Stripe.Product>,
      ],
      prices: [
        {
          id: 'price_pilot_monthly',
          product: 'prod_pilot',
          active: true,
          type: 'recurring',
          unit_amount: PLANS.pilot.monthlyCents,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling(params);
    const pilot = result.plans.find((p) => p.planId === 'pilot');

    expect(pilot?.productId).toBe('prod_pilot');
    expect(pilot?.prices.find((p) => p.interval === 'month')?.priceId).toBe(
      'price_pilot_monthly'
    );
    expect(pilot?.prices.find((p) => p.interval === 'year')?.created).toBe(
      true
    );
  });

  it('ignores another product in the same account', async () => {
    // A price with a planId we recognise, on a product that is not ours: this
    // is the shared-account trap, and matching on planId alone would adopt it.
    const fake = fakeStripe({
      products: [
        {
          id: 'prod_someone_else',
          active: true,
          metadata: { planId: 'pilot' },
        } as Partial<Stripe.Product>,
      ],
      prices: [
        {
          id: 'price_someone_else',
          product: 'prod_someone_else',
          active: true,
          type: 'recurring',
          unit_amount: 100,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling(params);
    const pilot = result.plans.find((p) => p.planId === 'pilot');

    expect(pilot?.productId).not.toBe('prod_someone_else');
    expect(pilot?.prices.map((p) => p.priceId)).not.toContain(
      'price_someone_else'
    );
  });

  it('reports a price whose amount has drifted, and never re-prices it', async () => {
    const fake = fakeStripe({
      products: [
        {
          id: 'prod_pilot',
          active: true,
          metadata: { product: 'sellavant', planId: 'pilot' },
        } as Partial<Stripe.Product>,
      ],
      prices: [
        {
          id: 'price_pilot_old',
          product: 'prod_pilot',
          active: true,
          type: 'recurring',
          unit_amount: PLANS.pilot.monthlyCents + 20_000,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling(params);
    const monthly = result.plans
      .find((p) => p.planId === 'pilot')
      ?.prices.find((p) => p.interval === 'month');

    expect(monthly?.priceId).toBe('price_pilot_old');
    expect(monthly?.amountMismatch).toEqual({
      existingCents: PLANS.pilot.monthlyCents + 20_000,
      expectedCents: PLANS.pilot.monthlyCents,
    });
    expect(result.mismatches.join(' ')).toContain('pilot/month');
    // The whole point: no second monthly price was minted to "fix" it.
    const monthlyCreates = fake.prices.create.mock.calls.filter(
      (c) =>
        (c[0] as Stripe.PriceCreateParams).recurring?.interval === 'month' &&
        (c[0] as Stripe.PriceCreateParams).product === 'prod_pilot'
    );
    expect(monthlyCreates).toHaveLength(0);
  });

  it('offers every plan AND every interval in the portal', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    const body = fake.billingPortal.configurations.create.mock
      .calls[0]?.[0] as Stripe.BillingPortal.ConfigurationCreateParams;
    // Stripe types this as `'' | Product[]` — the empty string is how you unset
    // it, and unset is exactly the state this test exists to rule out.
    const offered = body.features?.subscription_update?.products;
    expect(Array.isArray(offered)).toBe(true);
    const productList =
      offered as Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[];

    expect(productList).toHaveLength(PAID);
    for (const entry of productList) {
      // Both intervals, so the portal is also how monthly becomes yearly.
      expect(entry.prices).toHaveLength(2);
    }
    expect(productList.map((p) => p.product).sort()).toEqual(
      result.plans.map((p) => p.productId).sort()
    );
    expect(body.features?.subscription_cancel?.mode).toBe('at_period_end');
  });

  it('returns the portal id, and NO price env vars', async () => {
    // Price ids moved to the `billing_prices` catalogue. Still emitting them
    // here would invite somebody to paste them back into an env file that
    // nothing reads, and then to trust it.
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.env['STRIPE_PORTAL_CONFIGURATION_ID']).toBe(
      result.portal.configurationId
    );
    expect(
      Object.keys(result.env).filter((k) => k.startsWith('STRIPE_PRICE_'))
    ).toEqual([]);
  });

  it('POPULATES the price catalogue, which is what makes checkout work', async () => {
    // Provisioning Stripe without writing the catalogue leaves an environment
    // that looks provisioned and 503s at checkout — the bootstrap trap this
    // whole collection introduced.
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.catalogError).toBeUndefined();
    expect(result.catalog).toHaveLength(PAID * 2);
    expect(result.catalog?.every((o) => o.action === 'written')).toBe(true);
    expect([...catalogStore.keys()].sort()).toEqual([
      'pilot::month',
      'pilot::year',
      'scale::month',
      'scale::year',
    ]);
  });

  it('writes NOTHING to the catalogue on a dry run', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling({ ...params, dryRun: true });

    expect(result.catalog).toBeUndefined();
    expect(catalogStore.size).toBe(0);
  });

  it('reports a catalogue failure without discarding the Stripe work', async () => {
    // Everything in Stripe has already happened and is not rolled back, so
    // throwing here would report a total failure for a run that half-succeeded.
    const fake = fakeStripe();
    await withStripe(fake);
    catalogUpsert.mockRejectedValue(new Error('couchbase unreachable'));

    const result = await provisionBilling(params);

    expect(result.plans).toHaveLength(PAID);
    expect(result.catalog).toBeUndefined();
    expect(result.catalogError).toContain('couchbase unreachable');
  });

  it('subscribes a new webhook to every event the catalogue and route need', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling({
      ...params,
      webhookUrl: 'https://sellavant.com/api/billing/webhook',
    });

    const body = fake.webhookEndpoints.create.mock
      .calls[0]?.[0] as Stripe.WebhookEndpointCreateParams;
    expect(body.enabled_events).toEqual(WEBHOOK_EVENTS);
    expect(result.webhook?.created).toBe(true);
    // Only available at creation, so it has to be surfaced here or it is lost.
    expect(result.env['STRIPE_ENDPOINT_SECRET']).toBe('whsec_brand_new');
  });

  it('re-enables an existing endpoint without claiming a new secret', async () => {
    const url = 'https://sellavant.com/api/billing/webhook';
    const fake = fakeStripe({
      webhooks: [
        {
          id: 'we_existing',
          url,
          status: 'disabled',
        } as Partial<Stripe.WebhookEndpoint>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling({ ...params, webhookUrl: url });

    expect(fake.webhookEndpoints.create).not.toHaveBeenCalled();
    expect(fake.webhookEndpoints.update).toHaveBeenCalledWith(
      'we_existing',
      expect.objectContaining({
        disabled: false,
        enabled_events: WEBHOOK_EVENTS,
      })
    );
    expect(result.webhook?.secret).toBeUndefined();
    expect(result.env['STRIPE_ENDPOINT_SECRET']).toBeUndefined();
  });

  it('merges into an existing subscription instead of replacing it', async () => {
    // The live endpoint was created in the dashboard and carries ~60 events
    // this file has never heard of. Replacing the list would unsubscribe them
    // silently — the failure only shows up as an event that stopped arriving.
    const url = 'https://sellavant.com/api/billing/webhook';
    const foreign = [
      'checkout.session.completed',
      'invoice.paid',
      'customer.subscription.trial_will_end',
    ];
    const fake = fakeStripe({
      webhooks: [
        {
          id: 'we_existing',
          url,
          enabled_events: [...foreign, 'customer.subscription.created'],
        } as Partial<Stripe.WebhookEndpoint>,
      ],
    });
    await withStripe(fake);

    await provisionBilling({ ...params, webhookUrl: url });

    const body = fake.webhookEndpoints.update.mock.calls[0]?.[1] as {
      enabled_events: string[];
    };
    // Nothing lost…
    for (const event of foreign) expect(body.enabled_events).toContain(event);
    // …nothing we need missing…
    for (const event of WEBHOOK_EVENTS)
      expect(body.enabled_events).toContain(event);
    // …and the one they already shared is not duplicated.
    expect(new Set(body.enabled_events).size).toBe(body.enabled_events.length);
  });

  it('leaves a wildcard subscription alone', async () => {
    // `*` is already every event. Appending to it would be noise, and Stripe
    // rejects a list that pairs the wildcard with named events.
    const url = 'https://sellavant.com/api/billing/webhook';
    const fake = fakeStripe({
      webhooks: [
        {
          id: 'we_existing',
          url,
          enabled_events: ['*'],
        } as Partial<Stripe.WebhookEndpoint>,
      ],
    });
    await withStripe(fake);

    await provisionBilling({ ...params, webhookUrl: url });

    const body = fake.webhookEndpoints.update.mock.calls[0]?.[1] as {
      enabled_events: string[];
    };
    expect(body.enabled_events).toEqual(['*']);
  });

  it('adopts an endpoint that differs only by a bypass token in the query', async () => {
    // Reaching a protected preview deployment means putting the token in the
    // query string. Matching on the full URL would mint a SECOND endpoint:
    // every event delivered twice, against a secret that fits only one.
    const bare = 'https://staging.sellavant.com/api/billing/webhook';
    const fake = fakeStripe({
      webhooks: [
        {
          id: 'we_with_token',
          url: `${bare}?x-vercel-protection-bypass=tok`,
        } as Partial<Stripe.WebhookEndpoint>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling({ ...params, webhookUrl: bare });

    expect(fake.webhookEndpoints.create).not.toHaveBeenCalled();
    expect(result.webhook?.id).toBe('we_with_token');
  });

  it('does not strip an existing bypass token when given a bare URL', async () => {
    // The silent-failure case: stripping it makes every delivery bounce off
    // the protection redirect, and Stripe reports a 302 as a retryable failure.
    const bare = 'https://staging.sellavant.com/api/billing/webhook';
    const withTok = `${bare}?x-vercel-protection-bypass=tok`;
    const fake = fakeStripe({
      webhooks: [
        {
          id: 'we_with_token',
          url: withTok,
        } as Partial<Stripe.WebhookEndpoint>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling({ ...params, webhookUrl: bare });

    const body = fake.webhookEndpoints.update.mock.calls[0]?.[1] as {
      url?: string;
    };
    expect(body.url).toBeUndefined();
    expect(result.webhook?.url).toBe(withTok);
  });

  it('moves the URL when the caller supplies a query string', async () => {
    const bare = 'https://staging.sellavant.com/api/billing/webhook';
    const withTok = `${bare}?x-vercel-protection-bypass=tok`;
    const fake = fakeStripe({
      webhooks: [
        { id: 'we_bare', url: bare } as Partial<Stripe.WebhookEndpoint>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling({ ...params, webhookUrl: withTok });

    expect(fake.webhookEndpoints.create).not.toHaveBeenCalled();
    const body = fake.webhookEndpoints.update.mock.calls[0]?.[1] as {
      url?: string;
    };
    expect(body.url).toBe(withTok);
    expect(result.webhook?.url).toBe(withTok);
  });

  it('leaves the webhook alone when no URL is given', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.webhook).toBeUndefined();
    expect(fake.webhookEndpoints.create).not.toHaveBeenCalled();
  });

  it('writes nothing on a dry run', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    await provisionBilling({
      ...params,
      dryRun: true,
      webhookUrl: 'https://sellavant.com/api/billing/webhook',
    });

    expect(fake.products.create).not.toHaveBeenCalled();
    expect(fake.prices.create).not.toHaveBeenCalled();
    expect(fake.billingPortal.configurations.create).not.toHaveBeenCalled();
    expect(fake.billingPortal.configurations.update).not.toHaveBeenCalled();
    expect(fake.webhookEndpoints.create).not.toHaveBeenCalled();
    expect(fake.webhookEndpoints.update).not.toHaveBeenCalled();
  });

  it('reports the account it wrote to', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.accountId).toBe('acct_test');
    expect(result.livemode).toBe(false);
    // `null` means "the account this key belongs to", not "some connected
    // account" — the distinction decides which account gets written to.
    expect(fake.accounts.retrieve).toHaveBeenCalledWith(null);
  });

  it('still provisions with a restricted key that cannot read the account', async () => {
    // `rk_…` keys are the right thing to use in production and lack
    // `accounts_kyc_basic_read`. Losing a diagnostic id must not stop the work.
    const fake = fakeStripe();
    fake.accounts.retrieve = vi.fn(async () => {
      throw Object.assign(new Error('Permission denied.'), {
        type: 'StripePermissionError',
      });
    });
    await withStripe(fake);

    process.env[KEY] = 'rk_live_x';
    const result = await provisionBilling(params);

    expect(result.accountId).toMatch(/unknown/);
    expect(fake.products.create).toHaveBeenCalledTimes(PAID);
    // The guard that actually matters survives the degraded path.
    expect(result.livemode).toBe(true);
  });

  it('reads live mode from the key, which is what gates the CLI refusal', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    process.env[KEY] = 'sk_live_x';
    expect((await provisionBilling(params)).livemode).toBe(true);

    process.env[KEY] = 'rk_test_x';
    expect((await provisionBilling(params)).livemode).toBe(false);
  });
});

/** Our product, as `ensureProduct` would have created it. */
const ourProduct = (planId: string, id = `prod_${planId}`) =>
  ({
    id,
    active: true,
    metadata: { product: 'sellavant', planId },
  } as Partial<Stripe.Product>);

describe('deactivateStalePrices', () => {
  it('retires a price whose amount left the plan table', async () => {
    const fake = fakeStripe({
      products: [ourProduct('pilot')],
      prices: [
        {
          id: 'price_old',
          product: 'prod_pilot',
          active: true,
          type: 'recurring',
          unit_amount: 99_999,
          recurring: { interval: 'month' },
          metadata: { product: 'sellavant', planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    const stale = await deactivateStalePrices({});

    expect(stale.map((s) => s.priceId)).toEqual(['price_old']);
    expect(fake.prices.update).toHaveBeenCalledWith('price_old', {
      active: false,
    });
  });

  /**
   * Found by running it: `provision` reported two mismatched prices while this
   * reported nothing to do, forever. Ownership must be decided the same way in
   * both — by the PRODUCT — or prices predating the price-level tag are
   * invisible to exactly the function meant to retire them.
   */
  it('retires a stale price on our product even without the price-level tag', async () => {
    const fake = fakeStripe({
      products: [ourProduct('pilot')],
      prices: [
        {
          id: 'price_untagged',
          product: 'prod_pilot',
          active: true,
          type: 'recurring',
          unit_amount: 29_900,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    const stale = await deactivateStalePrices({});

    expect(stale.map((s) => s.priceId)).toEqual(['price_untagged']);
  });

  it('retires a stale price carrying no metadata at all, via its product', async () => {
    const fake = fakeStripe({
      products: [ourProduct('scale')],
      prices: [
        {
          id: 'price_bare',
          product: 'prod_scale',
          active: true,
          type: 'recurring',
          unit_amount: 99_900,
          recurring: { interval: 'month' },
          metadata: {},
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    expect((await deactivateStalePrices({})).map((s) => s.priceId)).toEqual([
      'price_bare',
    ]);
  });

  it('leaves a current price alone', async () => {
    const fake = fakeStripe({
      products: [ourProduct('pilot')],
      prices: [
        {
          id: 'price_current',
          product: 'prod_pilot',
          active: true,
          type: 'recurring',
          unit_amount: PLANS.pilot.monthlyCents,
          recurring: { interval: 'month' },
          metadata: { product: 'sellavant', planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    expect(await deactivateStalePrices({})).toEqual([]);
    expect(fake.prices.update).not.toHaveBeenCalled();
  });

  it('never touches another product in the shared account', async () => {
    const fake = fakeStripe({
      products: [
        {
          id: 'prod_theirs',
          active: true,
          metadata: { planId: 'pilot' },
        } as Partial<Stripe.Product>,
      ],
      prices: [
        {
          id: 'price_theirs',
          product: 'prod_theirs',
          active: true,
          type: 'recurring',
          unit_amount: 12_345,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    expect(await deactivateStalePrices({})).toEqual([]);
    expect(fake.prices.update).not.toHaveBeenCalled();
  });

  it('reports without writing on a dry run', async () => {
    const fake = fakeStripe({
      products: [ourProduct('scale')],
      prices: [
        {
          id: 'price_old',
          product: 'prod_scale',
          active: true,
          type: 'recurring',
          unit_amount: 1,
          recurring: { interval: 'month' },
          metadata: { product: 'sellavant', planId: 'scale' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    expect(await deactivateStalePrices({ dryRun: true })).toHaveLength(1);
    expect(fake.prices.update).not.toHaveBeenCalled();
  });
});
