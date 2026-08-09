import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStripeClient } from './customers.js';
import {
  PLAN_PRICE_CENTS,
  WEBHOOK_EVENTS,
  provisionBilling,
} from './provision.js';

/**
 * Provisioning, and the two ways it could quietly ruin an account.
 *
 * The first is DUPLICATION. This runs against a Stripe account shared with
 * other products, and it runs more than once — every environment, and again
 * whenever a plan is added. A second "Sellavant Pilot" product with its own
 * price is not an error anybody sees: checkout keeps working against whichever
 * price id happens to be in the environment, and the duplicate sits there until
 * somebody reconciles an invoice. So the tests that matter here assert that a
 * second run creates NOTHING.
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
        list(prices.filter((p) => p.product === q.product))
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

beforeEach(() => {
  resetStripeClient();
  process.env[KEY] = 'sk_test_x';
});

afterEach(() => {
  process.env = { ...original };
  resetStripeClient();
  vi.restoreAllMocks();
});

describe('provisionBilling', () => {
  it('creates a product and a monthly price for every purchasable plan', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.plans.map((p) => p.planId).sort()).toEqual([
      'pilot',
      'scale',
    ]);
    expect(fake.products.create).toHaveBeenCalledTimes(2);
    expect(fake.prices.create).toHaveBeenCalledTimes(2);

    // The trial plan is not for sale and must never get a price.
    expect(result.plans.some((p) => p.planId === 'trial')).toBe(false);
  });

  it('puts planId in the PRICE metadata — the field entitlement is read from', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    await provisionBilling(params);

    for (const call of fake.prices.create.mock.calls) {
      const body = call[0] as Stripe.PriceCreateParams;
      expect(body.metadata?.['planId']).toMatch(/^(pilot|scale)$/);
      expect(body.recurring?.interval).toBe('month');
      expect(body.currency).toBe('usd');
    }
  });

  it('charges the amounts in PLAN_PRICE_CENTS', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    for (const p of result.plans) {
      expect(p.amountCents).toBe(PLAN_PRICE_CENTS[p.planId]);
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
    expect(pilot?.priceId).not.toBe('price_someone_else');
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
          unit_amount: 19_900,
          recurring: { interval: 'month' },
          metadata: { planId: 'pilot' },
        } as unknown as Partial<Stripe.Price>,
      ],
    });
    await withStripe(fake);

    const result = await provisionBilling(params);
    const pilot = result.plans.find((p) => p.planId === 'pilot');

    expect(pilot?.priceId).toBe('price_pilot_old');
    expect(pilot?.amountMismatch).toEqual({
      existingCents: 19_900,
      expectedCents: PLAN_PRICE_CENTS.pilot,
    });
    // The whole point: no second price was minted to "fix" it.
    expect(fake.prices.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ product: 'prod_pilot' })
    );
  });

  it('limits the portal to our own plans', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    const body = fake.billingPortal.configurations.create.mock
      .calls[0]?.[0] as Stripe.BillingPortal.ConfigurationCreateParams;
    // Stripe types this as `'' | Product[]` — the empty string is how you unset
    // it, and unset is exactly the state this test exists to rule out.
    const offered = body.features?.subscription_update?.products;
    expect(Array.isArray(offered)).toBe(true);
    const products =
      offered as Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[];
    expect(products).toHaveLength(2);
    expect(products.map((p) => p.product).sort()).toEqual(
      result.plans.map((p) => p.productId).sort()
    );
    expect(body.features?.subscription_cancel?.mode).toBe('at_period_end');
  });

  it('returns the portal configuration id as an env var to set', async () => {
    const fake = fakeStripe();
    await withStripe(fake);

    const result = await provisionBilling(params);

    expect(result.env['STRIPE_PORTAL_CONFIGURATION_ID']).toBe(
      result.portal.configurationId
    );
    expect(result.env['STRIPE_PRICE_PILOT']).toBeDefined();
    expect(result.env['STRIPE_PRICE_SCALE']).toBeDefined();
  });

  it('subscribes the webhook to exactly the events the route handles', async () => {
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
    expect(fake.products.create).toHaveBeenCalledTimes(2);
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
