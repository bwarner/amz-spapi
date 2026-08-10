import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The only thing that grants a paid allowance.
 *
 * There is no session here and no user. The endpoint is reachable by anyone on
 * the internet and its effect is to change what a workspace may spend, so every
 * case below is either "who is allowed to move this number" or "what happens to
 * an event we cannot use".
 *
 * ## Why the status codes are the assertions
 *
 * Stripe reads the response as an instruction. A non-2xx means RETRY, with
 * backoff, for days. That is right for a transient database failure and wrong
 * for an event about a workspace that no longer exists — the latter would be
 * redelivered forever and page somebody every time. So the rule under test is:
 * verified-but-unusable is 200, unverifiable is 400, and only a genuine write
 * failure is 500. Getting this wrong produces no visible bug until Stripe's
 * retry queue backs up.
 *
 * ## The deletion case
 *
 * `customer.subscription.deleted` must clear the STATUS and leave the PLAN.
 * `plan` records what somebody bought; `subscriptionStatus` records whether it
 * is currently paid for, and `effectivePlan` needs both. A version of this that
 * cleared the plan instead would look identical in the database browser and
 * would let a cancelled account keep its full allowance.
 *
 * `verifyWebhook` is stubbed because signature verification is tested for real
 * in `libs/billing`. What is exercised here is what the route DOES with a
 * verified event.
 */

const verifyWebhook = vi.fn();
const applyCatalogEvent = vi.fn();
const findWorkspaceByCustomer = vi.fn();
const updateWorkspaceSubscription = vi.fn();
const captureServerException = vi.fn();

vi.mock('@amz-spapi/billing', async () => {
  const actual = await vi.importActual<typeof import('@amz-spapi/billing')>(
    '@amz-spapi/billing'
  );
  return {
    ...actual,
    verifyWebhook: (...args: unknown[]) => verifyWebhook(...args),
    applyCatalogEvent: (...args: unknown[]) => applyCatalogEvent(...args),
  };
});

vi.mock('@amz-spapi/identity', () => ({
  findWorkspaceByCustomer: (...args: unknown[]) =>
    findWorkspaceByCustomer(...args),
  updateWorkspaceSubscription: (...args: unknown[]) =>
    updateWorkspaceSubscription(...args),
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
  captureServerException: (...args: unknown[]) =>
    captureServerException(...args),
}));

const { POST } = await import('./route');

const CUSTOMER = 'cus_123';
const WORKSPACE = 'ws_123';
const PERIOD_END_SECONDS = 1_700_000_000;

/** A verified event, as the route sees it after the signature check. */
function event(
  type: string,
  subscription: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'sub_123',
        customer: CUSTOMER,
        status: 'active',
        metadata: { workspaceId: WORKSPACE },
        items: {
          data: [
            {
              current_period_end: PERIOD_END_SECONDS,
              price: { metadata: { planId: 'pilot' } },
            },
          ],
        },
        ...subscription,
      },
    },
  };
}

function post(body: unknown, { signature = 'sig_valid' } = {}) {
  return new Request('https://sellavant.com/api/billing/webhook', {
    method: 'POST',
    headers: signature ? { 'stripe-signature': signature } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateWorkspaceSubscription.mockResolvedValue({ workspaceId: WORKSPACE });
  findWorkspaceByCustomer.mockResolvedValue(null);
  applyCatalogEvent.mockResolvedValue([]);
});

/**
 * Price and product events keep the `billing_prices` catalogue current.
 *
 * They carry a Price or a Product, NOT a Subscription, so the branch that
 * handles them has to come before every line that assumes the latter — read
 * `event.data.object` as a subscription and `readSubscription` walks into
 * `items.data`, which is not there.
 */
describe('price catalogue events', () => {
  const priceEvent = {
    id: 'evt_price',
    type: 'price.updated',
    data: {
      object: {
        id: 'price_1',
        object: 'price',
        metadata: { product: 'sellavant', planId: 'pilot' },
      },
    },
  };

  it('syncs the catalogue and does NOT touch any workspace', async () => {
    verifyWebhook.mockReturnValue(priceEvent);
    applyCatalogEvent.mockResolvedValue([
      { planId: 'pilot', interval: 'month', action: 'written' },
    ]);

    const response = await POST(post(priceEvent));

    expect(response.status).toBe(200);
    expect(applyCatalogEvent).toHaveBeenCalled();
    // A price change says nothing about anybody's entitlement.
    expect(updateWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('acknowledges an event about somebody ELSE\u2019s product', async () => {
    // The Stripe account is shared. Null means "not ours" and must be a 200:
    // a non-2xx would make Stripe retry another product's event forever.
    verifyWebhook.mockReturnValue(priceEvent);
    applyCatalogEvent.mockResolvedValue(null);

    const response = await POST(post(priceEvent));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, matched: false });
  });

  it('answers 500 so Stripe RETRIES when the sync fails', async () => {
    // A dropped price event leaves the catalogue quoting something Stripe may
    // have withdrawn, and nothing else would notice until a checkout fails.
    verifyWebhook.mockReturnValue(priceEvent);
    applyCatalogEvent.mockRejectedValue(new Error('couchbase unreachable'));

    const response = await POST(post(priceEvent));

    expect(response.status).toBe(500);
    expect(captureServerException).toHaveBeenCalled();
  });

  it('still handles subscription events, which are a different object', async () => {
    verifyWebhook.mockReturnValue(event('customer.subscription.updated'));

    const response = await POST(post({}));

    expect(response.status).toBe(200);
    expect(applyCatalogEvent).not.toHaveBeenCalled();
    expect(updateWorkspaceSubscription).toHaveBeenCalled();
  });
});

describe('authentication', () => {
  it('rejects a request with NO signature header', async () => {
    const response = await POST(
      post(event('customer.subscription.created'), { signature: '' })
    );

    expect(response.status).toBe(400);
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(updateWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable payload with 400 so Stripe does NOT retry it', async () => {
    // A bad signature is never going to become a good one. Retrying it for days
    // is noise, and 500 would also imply the fault is ours.
    verifyWebhook.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const response = await POST(post(event('customer.subscription.created')));

    expect(response.status).toBe(400);
    expect(updateWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('verifies the RAW body, byte for byte, before anything parses it', async () => {
    // Reserialising changes the bytes and fails the signature check, and the
    // failure then looks like Stripe misbehaving rather than like our bug.
    const raw = '{"id":"evt_1","type":"invoice.paid",  "spacing":"preserved"}';
    verifyWebhook.mockReturnValue({ id: 'evt_1', type: 'invoice.paid' });

    await POST(post(raw));

    expect(verifyWebhook).toHaveBeenCalledWith({
      rawBody: raw,
      signature: 'sig_valid',
    });
  });
});

describe('events it does not act on', () => {
  it('acknowledges an unrelated event type instead of erroring', async () => {
    // Stripe sends many types. Treating the uninteresting ones as failures puts
    // the endpoint into permanent retry.
    verifyWebhook.mockReturnValue({ id: 'evt_1', type: 'invoice.paid' });

    const response = await POST(post('{}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(updateWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('acknowledges an event matching NO workspace rather than retrying forever', async () => {
    verifyWebhook.mockReturnValue(
      event('customer.subscription.updated', { metadata: {} })
    );
    findWorkspaceByCustomer.mockResolvedValue(null);

    const response = await POST(post('{}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, matched: false });
    expect(updateWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('leaves the workspace UNTOUCHED on an unrecognised status', async () => {
    // Guessing is the failure mode: mapping an unknown status to "active" grants
    // an allowance nobody paid for, and to "canceled" revokes one somebody did.
    verifyWebhook.mockReturnValue(
      event('customer.subscription.updated', { status: 'some_new_status' })
    );

    const response = await POST(post('{}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, matched: false });
    expect(updateWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('acknowledges a workspace that vanished before the event landed', async () => {
    updateWorkspaceSubscription.mockResolvedValue(null);
    verifyWebhook.mockReturnValue(event('customer.subscription.created'));

    const response = await POST(post('{}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, matched: false });
  });
});

describe('granting and revoking an allowance', () => {
  it('writes the plan, status, subscription and period end on creation', async () => {
    verifyWebhook.mockReturnValue(event('customer.subscription.created'));

    const response = await POST(post('{}'));

    expect(response.status).toBe(200);
    expect(updateWorkspaceSubscription).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      plan: 'pilot',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_123',
      currentPeriodEnd: PERIOD_END_SECONDS * 1000,
    });
  });

  it('finds the workspace by CUSTOMER when the subscription carries no metadata', async () => {
    // Subscriptions created in the Stripe dashboard carry none of our metadata.
    // Without this fallback those events are unattributable and a paying
    // customer silently keeps the trial allowance.
    verifyWebhook.mockReturnValue(
      event('customer.subscription.created', { metadata: {} })
    );
    findWorkspaceByCustomer.mockResolvedValue({
      workspaceId: 'ws_from_lookup',
    });

    await POST(post('{}'));

    expect(findWorkspaceByCustomer).toHaveBeenCalledWith(CUSTOMER);
    expect(updateWorkspaceSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_from_lookup' })
    );
  });

  it('prefers subscription metadata over the customer lookup', async () => {
    verifyWebhook.mockReturnValue(event('customer.subscription.created'));

    await POST(post('{}'));

    expect(findWorkspaceByCustomer).not.toHaveBeenCalled();
    expect(updateWorkspaceSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE })
    );
  });

  it('keeps the allowance while PAST_DUE', async () => {
    // An expired card should not become an outage the customer experiences as
    // our fault. Stripe retries for days before moving it to unpaid/canceled.
    verifyWebhook.mockReturnValue(
      event('customer.subscription.updated', { status: 'past_due' })
    );

    await POST(post('{}'));

    expect(updateWorkspaceSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'past_due' })
    );
  });

  it('CLEARS THE STATUS and leaves the plan on deletion', async () => {
    // The single most consequential line in the route. `plan` is what they
    // bought; `subscriptionStatus` is whether it is paid for. Clearing the
    // status is what drops the workspace back to the trial allowance, because
    // `effectivePlan` treats an absent status as unentitled.
    verifyWebhook.mockReturnValue(
      event('customer.subscription.deleted', { status: 'canceled' })
    );

    await POST(post('{}'));

    expect(updateWorkspaceSubscription).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      plan: 'pilot',
      subscriptionStatus: undefined,
      stripeSubscriptionId: undefined,
      currentPeriodEnd: undefined,
    });
  });

  it('applies a deletion even when the status is one it does not recognise', async () => {
    // The unrecognised-status guard must not swallow deletions — that would
    // leave a cancelled workspace on a paid allowance indefinitely.
    verifyWebhook.mockReturnValue(
      event('customer.subscription.deleted', { status: 'something_odd' })
    );

    const response = await POST(post('{}'));

    expect(response.status).toBe(200);
    expect(updateWorkspaceSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: undefined })
    );
  });

  it('leaves the plan undefined when the price carries no planId', async () => {
    verifyWebhook.mockReturnValue(
      event('customer.subscription.updated', {
        items: { data: [{ price: { metadata: {} } }] },
      })
    );

    await POST(post('{}'));

    expect(updateWorkspaceSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: undefined })
    );
  });

  it('ignores a planId that is not one of ours', async () => {
    // A price tagged with a plan we removed must not be written through to the
    // workspace, where it would fail validation on the next read.
    verifyWebhook.mockReturnValue(
      event('customer.subscription.updated', {
        items: { data: [{ price: { metadata: { planId: 'enterprise' } } }] },
      })
    );

    await POST(post('{}'));

    expect(updateWorkspaceSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: undefined })
    );
  });
});

describe('write failures', () => {
  it('answers 500 so Stripe RETRIES a transient database failure', async () => {
    // This one is genuinely transient, and losing it leaves a paying customer on
    // the trial allowance with nothing left to correct it.
    updateWorkspaceSubscription.mockRejectedValue(new Error('Couchbase down'));
    verifyWebhook.mockReturnValue(event('customer.subscription.created'));

    const response = await POST(post('{}'));

    expect(response.status).toBe(500);
    expect(captureServerException).toHaveBeenCalled();
  });

  it('answers 500 when the customer lookup itself fails', async () => {
    findWorkspaceByCustomer.mockRejectedValue(new Error('query timeout'));
    verifyWebhook.mockReturnValue(
      event('customer.subscription.created', { metadata: {} })
    );

    const response = await POST(post('{}'));

    expect(response.status).toBe(500);
  });
});
