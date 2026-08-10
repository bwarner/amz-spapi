import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BillingNotConfiguredError,
  resetStripeClient,
  stripeClient,
} from './customers.js';
import {
  createPlanChangeSession,
  readSubscription,
  verifyWebhook,
} from './subscriptions.js';

/**
 * What Stripe tells us, and whether to believe it.
 *
 * Two things here are load-bearing and both fail silently when wrong.
 *
 * `readSubscription` decides what a workspace is entitled to. Every field it
 * reads has a plausible wrong answer: a period end in seconds looks like a
 * timestamp in 1970, a customer arrives as either an id or an expanded object
 * depending on the caller, and a missing `planId` is indistinguishable from a
 * plan of `undefined` unless something asserts it. A mistake here does not
 * throw — it downgrades a paying customer, or upgrades a free one.
 *
 * `verifyWebhook` is the entire authentication story for an endpoint that
 * grants paid allowances to anyone on the internet. The signature covers the
 * RAW bytes, so the test that matters is that a MODIFIED body is rejected: that
 * is the difference between a signature check and a signature-shaped decoration.
 *
 * Stripe's own signing helper generates the headers, so these run offline
 * against the same code path a live delivery takes.
 */

const KEY = 'STRIPE_SECRET_KEY';
const ENDPOINT_SECRET = 'STRIPE_ENDPOINT_SECRET';
const TEST_SECRET = 'whsec_test_secret_for_signing';

const original = { ...process.env };

beforeEach(() => {
  resetStripeClient();
});

afterEach(() => {
  process.env = { ...original };
  resetStripeClient();
});

/** A subscription as Stripe sends it: seconds, string customer, price metadata. */
function subscription(
  overrides: Record<string, unknown> = {}
): Stripe.Subscription {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    metadata: { workspaceId: 'ws_123' },
    items: {
      data: [
        {
          current_period_end: 1_700_000_000,
          price: { id: 'price_123', metadata: { planId: 'pilot' } },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('readSubscription', () => {
  it('flattens a subscription into what a workspace stores', () => {
    expect(readSubscription(subscription())).toEqual({
      workspaceId: 'ws_123',
      customerId: 'cus_123',
      subscriptionId: 'sub_123',
      status: 'active',
      currentPeriodEnd: 1_700_000_000_000,
      planId: 'pilot',
    });
  });

  it('converts the period end from SECONDS to milliseconds', () => {
    // Stripe speaks epoch seconds and every Date in this codebase is ms. Storing
    // the raw value puts the renewal date in January 1970, which reads as a
    // long-expired subscription rather than as a bug.
    const snapshot = readSubscription(subscription());
    expect(snapshot.currentPeriodEnd).toBe(1_700_000_000 * 1000);
    expect(new Date(snapshot.currentPeriodEnd as number).getUTCFullYear()).toBe(
      2023
    );
  });

  it('prefers the ITEM period end over the subscription-level one', () => {
    // Stripe moved this field onto the item; the subscription-level copy lingers
    // on older payloads. Reading the stale one renews the wrong date.
    const snapshot = readSubscription(
      subscription({ current_period_end: 1_600_000_000 })
    );
    expect(snapshot.currentPeriodEnd).toBe(1_700_000_000_000);
  });

  it('falls back to the subscription-level period end when the item has none', () => {
    const snapshot = readSubscription(
      subscription({
        current_period_end: 1_600_000_000,
        items: { data: [{ price: { metadata: {} } }] },
      })
    );
    expect(snapshot.currentPeriodEnd).toBe(1_600_000_000_000);
  });

  it('leaves the period end undefined when neither carries one', () => {
    const snapshot = readSubscription(
      subscription({ items: { data: [{ price: { metadata: {} } }] } })
    );
    expect(snapshot.currentPeriodEnd).toBeUndefined();
  });

  it('accepts an EXPANDED customer object as well as an id', () => {
    // `customer` is a string normally and an object when the caller expanded it.
    // Storing "[object Object]" would break the reverse lookup that attributes
    // dashboard-created subscriptions to a workspace.
    const snapshot = readSubscription(
      subscription({ customer: { id: 'cus_expanded', object: 'customer' } })
    );
    expect(snapshot.customerId).toBe('cus_expanded');
  });

  it('reports no workspace when the subscription carries no metadata', () => {
    // The webhook depends on this being undefined rather than empty: it is the
    // signal to fall back to a customer lookup.
    expect(
      readSubscription(subscription({ metadata: {} })).workspaceId
    ).toBeUndefined();
    expect(
      readSubscription(subscription({ metadata: null })).workspaceId
    ).toBeUndefined();
  });

  it('treats an EMPTY workspaceId as absent, not as a workspace named ""', () => {
    const snapshot = readSubscription(
      subscription({ metadata: { workspaceId: '' } })
    );
    expect(snapshot.workspaceId).toBeUndefined();
  });

  it('reads the plan from the PRICE metadata, not the product or the amount', () => {
    // Names get edited and amounts get discounted. Metadata is the only field we
    // control that survives both.
    const snapshot = readSubscription(
      subscription({
        items: {
          data: [
            {
              price: {
                nickname: 'Scale',
                unit_amount: 29900,
                metadata: { planId: 'scale' },
              },
            },
          ],
        },
      })
    );
    expect(snapshot.planId).toBe('scale');
  });

  it('reports no plan when the price carries none', () => {
    // Better undefined than guessed: the webhook leaves the stored plan alone,
    // where a wrong guess would rewrite what the customer bought.
    const snapshot = readSubscription(
      subscription({ items: { data: [{ price: { metadata: {} } }] } })
    );
    expect(snapshot.planId).toBeUndefined();
  });

  it('survives a subscription with no items at all', () => {
    const snapshot = readSubscription(subscription({ items: { data: [] } }));
    expect(snapshot.planId).toBeUndefined();
    expect(snapshot.currentPeriodEnd).toBeUndefined();
    expect(snapshot.subscriptionId).toBe('sub_123');
  });

  it('passes the status through UNTOUCHED for the caller to validate', () => {
    // Narrowing to a known enum is the route's job, and it needs the raw value
    // to tell "unrecognised" apart from "absent".
    expect(readSubscription(subscription({ status: 'past_due' })).status).toBe(
      'past_due'
    );
    expect(
      readSubscription(subscription({ status: 'a_new_status' })).status
    ).toBe('a_new_status');
  });
});

describe('stripeClient', () => {
  it('is null when no key is configured, rather than throwing on import', () => {
    delete process.env[KEY];
    expect(stripeClient()).toBeNull();
  });

  it('memoises the client so a warm invocation reuses the connection pool', () => {
    process.env[KEY] = 'sk_test_123';
    expect(stripeClient()).toBe(stripeClient());
  });
});

describe('verifyWebhook', () => {
  it('refuses when Stripe is not configured at all', () => {
    delete process.env[KEY];
    expect(() => verifyWebhook({ rawBody: '{}', signature: 'sig' })).toThrow(
      BillingNotConfiguredError
    );
  });

  it('REFUSES rather than skips when the endpoint secret is missing', () => {
    // The dangerous alternative is to accept unverified payloads when the secret
    // is absent. That endpoint looks like it works, and is an unauthenticated way
    // for anyone to grant themselves a subscription.
    process.env[KEY] = 'sk_test_123';
    delete process.env[ENDPOINT_SECRET];
    expect(() => verifyWebhook({ rawBody: '{}', signature: 'sig' })).toThrow(
      /STRIPE_ENDPOINT_SECRET/
    );
  });

  it('accepts a genuinely signed payload', () => {
    process.env[KEY] = 'sk_test_123';
    process.env[ENDPOINT_SECRET] = TEST_SECRET;
    const stripe = stripeClient();
    if (!stripe) throw new Error('expected a client');

    const rawBody = JSON.stringify({
      id: 'evt_1',
      type: 'customer.subscription.created',
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: TEST_SECRET,
    });

    expect(verifyWebhook({ rawBody, signature }).id).toBe('evt_1');
  });

  it('rejects a body MODIFIED after signing', () => {
    // The whole point of signing the raw bytes. If this passes, the endpoint is
    // trusting attacker-controlled JSON that merely arrived with a valid-looking
    // header.
    process.env[KEY] = 'sk_test_123';
    process.env[ENDPOINT_SECRET] = TEST_SECRET;
    const stripe = stripeClient();
    if (!stripe) throw new Error('expected a client');

    const signed = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: signed,
      secret: TEST_SECRET,
    });
    const tampered = JSON.stringify({
      id: 'evt_1',
      type: 'customer.subscription.created',
    });

    expect(() => verifyWebhook({ rawBody: tampered, signature })).toThrow();
  });

  it('rejects a payload signed with the WRONG secret', () => {
    process.env[KEY] = 'sk_test_123';
    process.env[ENDPOINT_SECRET] = TEST_SECRET;
    const stripe = stripeClient();
    if (!stripe) throw new Error('expected a client');

    const rawBody = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: 'whsec_someone_elses_secret',
    });

    expect(() => verifyWebhook({ rawBody, signature })).toThrow();
  });

  it('rejects a garbage signature header', () => {
    process.env[KEY] = 'sk_test_123';
    process.env[ENDPOINT_SECRET] = TEST_SECRET;
    expect(() =>
      verifyWebhook({ rawBody: '{"id":"evt_1"}', signature: 'not-a-signature' })
    ).toThrow();
  });
});

/**
 * Changing plan must never mint a SECOND subscription.
 *
 * Checkout in `mode: 'subscription'` always creates one, so routing an existing
 * subscriber through it leaves two live subscriptions on one customer — both
 * billing, and only the newer one recorded against the workspace. The customer
 * finds out on their statement, which is the worst possible discovery channel.
 */
describe('createPlanChangeSession', () => {
  function fakeStripe(items: Array<Partial<Stripe.SubscriptionItem>>) {
    return {
      subscriptions: {
        retrieve: vi.fn(async () => ({ id: 'sub_1', items: { data: items } })),
      },
      billingPortal: {
        sessions: {
          // Typed parameter so `mock.calls[0][0]` is reachable; a zero-arg
          // `vi.fn` gives an empty-tuple call signature and the assertions
          // below stop compiling.
          create: vi.fn(async (_body: unknown) => ({
            url: 'https://portal.stripe.com/x',
          })),
        },
      },
    };
  }

  async function withStripe(fake: ReturnType<typeof fakeStripe>) {
    const customers = await import('./customers.js');
    vi.spyOn(customers, 'stripeClient').mockReturnValue(
      fake as unknown as Stripe
    );
  }

  const params = {
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    priceId: 'price_scale_month',
    returnUrl: 'https://sellavant.com/billing',
  };

  afterEach(() => vi.restoreAllMocks());

  it('never creates a checkout session — it updates the existing subscription', async () => {
    const fake = fakeStripe([{ id: 'si_1', price: { metadata: {} } as never }]);
    await withStripe(fake);

    const { url } = await createPlanChangeSession(params);

    expect(url).toBe('https://portal.stripe.com/x');
    // The portal, not Checkout. There is deliberately no `checkout` key on the
    // fake: reaching for one would throw rather than quietly double-bill.
    expect(fake.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('pre-fills the target price when the subscription has ONE item', async () => {
    const fake = fakeStripe([{ id: 'si_1', price: { metadata: {} } as never }]);
    await withStripe(fake);

    await createPlanChangeSession(params);

    const body = fake.billingPortal.sessions.create.mock
      .calls[0]?.[0] as unknown as {
      flow_data: {
        type: string;
        subscription_update_confirm: {
          subscription: string;
          items: Array<{ id: string; price: string; quantity: number }>;
        };
      };
    };
    expect(body.flow_data.type).toBe('subscription_update_confirm');
    expect(body.flow_data.subscription_update_confirm.subscription).toBe(
      'sub_1'
    );
    expect(body.flow_data.subscription_update_confirm.items).toEqual([
      { id: 'si_1', price: 'price_scale_month', quantity: 1 },
    ]);
  });

  it('falls back to the picker when the subscription has SEVERAL items', async () => {
    // Stripe refuses `subscription_update_confirm` for multi-item
    // subscriptions, and a metered overage item is planned — so this is a
    // future shape, not a hypothetical. Sending the confirm flow anyway would
    // fail the API call at the moment somebody tries to upgrade.
    const fake = fakeStripe([
      { id: 'si_plan', price: { metadata: { planId: 'pilot' } } as never },
      { id: 'si_overage', price: { metadata: {} } as never },
    ]);
    await withStripe(fake);

    await createPlanChangeSession(params);

    const body = fake.billingPortal.sessions.create.mock
      .calls[0]?.[0] as unknown as {
      flow_data: {
        type: string;
        subscription_update: { subscription: string };
      };
    };
    expect(body.flow_data.type).toBe('subscription_update');
    expect(body.flow_data.subscription_update.subscription).toBe('sub_1');
  });
});
