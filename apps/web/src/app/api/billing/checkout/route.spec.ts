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
 * `priceIdFor` is the real implementation: it reads env, and its empty-value
 * handling is exactly what decides between "not for sale" and a charge.
 */

const getSession = vi.fn();
const currentWorkspace = vi.fn();
const createCheckoutSession = vi.fn();
const createPortalSession = vi.fn();

vi.mock('@amz-spapi/billing', async () => {
  const actual = await vi.importActual<typeof import('@amz-spapi/billing')>(
    '@amz-spapi/billing'
  );
  return {
    ...actual,
    createCheckoutSession: (...args: unknown[]) =>
      createCheckoutSession(...args),
    createPortalSession: (...args: unknown[]) => createPortalSession(...args),
  };
});

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
  process.env['STRIPE_PRICE_PILOT'] = 'price_pilot';
  process.env['STRIPE_PRICE_SCALE'] = 'price_scale';
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
      priceId: 'price_pilot',
      workspaceId: WORKSPACE,
      successUrl: 'https://sellavant.com/billing?subscribed=1',
      cancelUrl: 'https://sellavant.com/billing',
    });
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
    const response = await checkout(request({ plan: 'trial' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'That plan is not for sale.',
    });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('answers 503 rather than GUESSING a price that is not configured', async () => {
    // Configuration, not user error — and the one recovery that must never
    // happen is inferring an amount, because that charges the wrong money
    // silently.
    delete process.env['STRIPE_PRICE_PILOT'];

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(503);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('treats an EMPTY price variable as unconfigured, not as a blank price', async () => {
    // A trailing `=` in an env file must not reach Stripe as a line item.
    process.env['STRIPE_PRICE_PILOT'] = '';

    const response = await checkout(request({ plan: 'pilot' }));

    expect(response.status).toBe(503);
    expect(createCheckoutSession).not.toHaveBeenCalled();
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
