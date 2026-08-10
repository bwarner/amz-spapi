import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may take on a recurring charge, and what happens when we cannot price it.
 *
 * Both routes here reach a payment provider on behalf of a workspace, so the
 * two questions are the same for each: is this caller allowed to do it, and is
 * the deployment configured well enough to do it correctly.
 *
 * ## Owner, not admin
 *
 * An admin can invite people and manage content. Agreeing to a monthly charge,
 * changing the card, or cancelling belong to whoever receives the invoice. The
 * portal is the sharper case — it can cancel the subscription outright — and
 * both are pinned because the refusal is invisible from the outside: a member
 * who is quietly allowed to subscribe looks exactly like one who is not, until
 * the invoice arrives.
 *
 * ## Refusing beats guessing
 *
 * A plan with no configured price is a 503, not a checkout at some inferred
 * amount. Guessing charges the wrong amount silently, which is the one failure
 * here that money cannot be un-spent from.
 *
 * `priceForPlan` is mocked: it reads the `billing_prices` catalogue, and the
 * distinction between "no sellable row" and "a row we can charge against" is
 * exactly what decides between a 503 and a charge.
 */

const getSession = vi.fn();
const currentWorkspace = vi.fn();
const createCheckoutSession = vi.fn();
const createPortalSession = vi.fn();
const findPromotionCode = vi.fn();
const priceForPlan = vi.fn();
const cookieStore = { get: vi.fn() };

vi.mock('@amz-spapi/billing', async () => {
  const actual = await vi.importActual<typeof import('@amz-spapi/billing')>(
    '@amz-spapi/billing'
  );
  return {
    ...actual,
    createCheckoutSession: (...args: unknown[]) =>
      createCheckoutSession(...args),
    createPortalSession: (...args: unknown[]) => createPortalSession(...args),
    findPromotionCode: (...args: unknown[]) => findPromotionCode(...args),
    priceForPlan: (...args: unknown[]) => priceForPlan(...args),
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}));

vi.mock('../../../../lib/auth0', () => ({
  auth0: { getSession: (...args: unknown[]) => getSession(...args) },
}));

vi.mock('../../../../lib/workspace-context', () => ({
  currentWorkspace: (...args: unknown[]) => currentWorkspace(...args),
}));

vi.mock('../../../../lib/config', () => ({
  appBaseUrl: () => 'https://sellavant.com',
}));

vi.mock('../../../../lib/logger', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../lib/posthog-server', () => ({
  captureServerException: vi.fn(),
}));

const { POST: checkout } = await import('./route');
const { POST: portal } = await import('../portal/route');

const USER = 'auth0|owner';
const WORKSPACE = 'ws_123';
const CUSTOMER = 'cus_123';

function contextWithRole(role: string) {
  return {
    workspace: {
      workspaceId: WORKSPACE,
      stripeCustomerId: CUSTOMER,
      name: 'Acme',
    },
    membership: { workspaceId: WORKSPACE, userId: USER, role },
  };
}

function request(body: unknown) {
  return new Request('https://sellavant.com/api/billing/checkout', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` forgets CALLS but keeps implementations, so a cookie set by
  // one test would otherwise still be returned in the next.
  cookieStore.get.mockReturnValue(undefined);
  findPromotionCode.mockResolvedValue(null);
  priceForPlan.mockImplementation(async (planId: string, interval: string) => ({
    planId,
    interval,
    priceId: `price_${planId}_${interval}`,
    productId: `prod_${planId}`,
    amountCents: 9_900,
    currency: 'usd',
    active: true,
    syncedAt: '2026-08-09T00:00:00.000Z',
  }));
  getSession.mockResolvedValue({ user: { sub: USER, email: 'o@example.com' } });
  currentWorkspace.mockResolvedValue(contextWithRole('owner'));
  createCheckoutSession.mockResolvedValue({
    url: 'https://checkout.stripe.com/x',
  });
  createPortalSession.mockResolvedValue({
    url: 'https://billing.stripe.com/x',
  });
});

describe('checkout authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    getSession.mockResolvedValue(null);

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(401);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a caller with NO workspace rather than inventing one', async () => {
    currentWorkspace.mockResolvedValue(null);

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(403);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN — inviting people is not agreeing to a charge', async () => {
    currentWorkspace.mockResolvedValue(contextWithRole('admin'));

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(403);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses an ordinary member', async () => {
    currentWorkspace.mockResolvedValue(contextWithRole('member'));

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(403);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('lets the OWNER buy, against their own workspace customer', async () => {
    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://checkout.stripe.com/x',
    });
    expect(createCheckoutSession).toHaveBeenCalledWith({
      customerId: CUSTOMER,
      priceId: 'price_pilot_month',
      workspaceId: WORKSPACE,
      successUrl: 'https://sellavant.com/billing?subscribed=1',
      cancelUrl: 'https://sellavant.com/billing',
      trialDays: 7,
    });
  });
});

describe('interval', () => {
  it('defaults to MONTHLY when the client sends none', async () => {
    // An older client that omits the field must not be silently sold a year.
    await checkout(request({ plan: 'pilot' }));

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_pilot_month' })
    );
  });

  it('sells the yearly price when asked', async () => {
    await checkout(request({ plan: 'scale', interval: 'year' }));

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_scale_year' })
    );
  });

  it('rejects an interval Stripe does not have a price for', async () => {
    const response = await checkout(
      request({ plan: 'pilot', interval: 'week' })
    );

    expect(response.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('trial', () => {
  it('offers the trial to a workspace that has never subscribed', async () => {
    await checkout(request({ plan: 'pilot' }));

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ trialDays: 7 })
    );
  });

  it('refuses a SECOND trial to a workspace that has subscribed before', async () => {
    // Otherwise cancel-and-resubscribe is an unlimited supply of free weeks,
    // each one real money against the gateway.
    const context = contextWithRole('owner');
    (
      context.workspace as unknown as { stripeSubscriptionId: string }
    ).stripeSubscriptionId = 'sub_old';
    currentWorkspace.mockResolvedValue(context);

    await checkout(request({ plan: 'pilot' }));

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ trialDays: 0 })
    );
  });
});

describe('promotion codes', () => {
  it('applies a code carried in the request body', async () => {
    findPromotionCode.mockResolvedValue({
      promotionCodeId: 'promo_1',
      code: 'LAUNCH50',
      description: '50% off',
    });

    await checkout(request({ plan: 'pilot', promo: 'LAUNCH50' }));

    expect(findPromotionCode).toHaveBeenCalledWith('LAUNCH50');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ promotionCodeId: 'promo_1' })
    );
  });

  it('falls back to the cookie the ad click left behind', async () => {
    cookieStore.get.mockReturnValue({ value: 'ADWORDS20' });
    findPromotionCode.mockResolvedValue({
      promotionCodeId: 'promo_2',
      code: 'ADWORDS20',
      description: '20% off',
    });

    await checkout(request({ plan: 'pilot' }));

    expect(findPromotionCode).toHaveBeenCalledWith('ADWORDS20');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ promotionCodeId: 'promo_2' })
    );
  });

  it('prefers a typed code over a stale cookie', async () => {
    // The cookie may be months old; what they just typed is the current intent.
    cookieStore.get.mockReturnValue({ value: 'OLDCODE' });
    findPromotionCode.mockResolvedValue({
      promotionCodeId: 'promo_3',
      code: 'FRESH',
      description: '10% off',
    });

    await checkout(request({ plan: 'pilot', promo: 'FRESH' }));

    expect(findPromotionCode).toHaveBeenCalledWith('FRESH');
  });

  /**
   * The one that protects revenue: a finished campaign must not block a sale.
   */
  it('still sells when the code does not resolve', async () => {
    findPromotionCode.mockResolvedValue(null);

    const response = await checkout(
      request({ plan: 'pilot', promo: 'EXPIRED' })
    );

    expect(response.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ promotionCodeId: expect.anything() })
    );
  });

  it('ignores a malformed code without looking it up', async () => {
    // Arrives from a query string, so it is attacker-controlled.
    await checkout(request({ plan: 'pilot', promo: 'not a code!!' }));

    expect(findPromotionCode).not.toHaveBeenCalled();
    expect(createCheckoutSession).toHaveBeenCalled();
  });
});

describe('checkout input and configuration', () => {
  it('rejects a malformed body', async () => {
    const response = await checkout(request('not json'));

    expect(response.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown plan', async () => {
    const response = await checkout(request({ plan: 'enterprise' }));

    expect(response.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses to sell the free tier', async () => {
    // A checkout for the default tier charges somebody for the allowance they
    // already have.
    const response = await checkout(request({ plan: 'free' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'That plan is not for sale.',
    });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('answers 503 rather than GUESSING a price that is not catalogued', async () => {
    // Configuration, not user error — and the one recovery that must never
    // happen is inferring an amount, because that charges the wrong money
    // silently.
    priceForPlan.mockResolvedValue(null);

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(503);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('answers 503 when the CATALOGUE ITSELF cannot be read', async () => {
    // Fails closed. An unreachable Couchbase must not fall back to a
    // remembered id: that is precisely the silent mischarge the catalogue
    // exists to make impossible.
    priceForPlan.mockRejectedValue(new Error('couchbase unreachable'));

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(503);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('charges the price id the CATALOGUE names', async () => {
    // The whole point of the collection: the id that reaches Stripe is the one
    // whose amount was checked against the plan table when the row was written.
    await checkout(request({ plan: 'scale', interval: 'year' }));

    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_scale_year' })
    );
  });

  it('reports a Stripe failure as 500 without leaking the reason', async () => {
    createCheckoutSession.mockRejectedValue(
      new Error('card_declined: details')
    );

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'card_declined'
    );
  });
});

describe('portal authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    getSession.mockResolvedValue(null);

    const response = await portal();

    expect(response.status).toBe(401);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('refuses a caller with no workspace', async () => {
    currentWorkspace.mockResolvedValue(null);

    const response = await portal();

    expect(response.status).toBe(403);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN — the portal can cancel the subscription', async () => {
    currentWorkspace.mockResolvedValue(contextWithRole('admin'));

    const response = await portal();

    expect(response.status).toBe(403);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('lets the OWNER in, scoped to their own customer', async () => {
    const response = await portal();

    expect(response.status).toBe(200);
    expect(createPortalSession).toHaveBeenCalledWith({
      customerId: CUSTOMER,
      returnUrl: 'https://sellavant.com/billing',
    });
  });

  it('reports a Stripe failure as 500', async () => {
    createPortalSession.mockRejectedValue(new Error('stripe unreachable'));

    const response = await portal();

    expect(response.status).toBe(500);
  });
});
