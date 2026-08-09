import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The only path that provisions a workspace.
 *
 * `resolveAccess` deliberately creates nothing, so everything a new account
 * becomes is decided here. Three properties are load-bearing and none of them
 * is visible in the browser when it goes wrong.
 *
 * ## Ordering
 *
 * Stripe customer FIRST, workspace second. The failure between them has to be
 * the survivable one: a customer nobody references is invisible, free, and
 * traceable by its `ownerUserId` metadata. The reverse — a workspace that can
 * spend and can never be charged — is repaired by guessing which customer
 * belongs to which workspace, which is not a repair. A refactor that "tidies"
 * these into a `Promise.all` would pass a naive test and lose the guarantee, so
 * the order is asserted on invocation sequence, not just on both being called.
 *
 * ## `redirect` throws
 *
 * That is how Next signals a redirect, and it is why the success redirect sits
 * OUTSIDE the try block. Moving it inside turns every successful signup into
 * the generic failure message — the workspace is created, the Stripe customer
 * is created, and the user is told it did not work. Two cases pin this: one
 * that the happy path redirects, and one that the catch block does not swallow
 * it.
 *
 * ## Idempotency
 *
 * A double-click posts the form twice. Without the re-check that produces two
 * workspaces and two Stripe customers for one person, with no natural key to
 * collapse them on afterwards.
 */

const getSession = vi.fn();
const listMembershipsForUser = vi.fn();
const createWorkspace = vi.fn();
const createBillingCustomer = vi.fn();
const linkCustomerToWorkspace = vi.fn();
const captureServerException = vi.fn();

/** Stands in for Next's redirect, which signals by throwing. */
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
    this.name = 'RedirectSignal';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

vi.mock('@amz-spapi/identity', () => ({
  createWorkspace: (...args: unknown[]) => createWorkspace(...args),
  listMembershipsForUser: (...args: unknown[]) =>
    listMembershipsForUser(...args),
}));

vi.mock('@amz-spapi/billing', () => ({
  createBillingCustomer: (...args: unknown[]) => createBillingCustomer(...args),
  linkCustomerToWorkspace: (...args: unknown[]) =>
    linkCustomerToWorkspace(...args),
}));

vi.mock('../../lib/auth0', () => ({
  auth0: { getSession: (...args: unknown[]) => getSession(...args) },
}));

vi.mock('../../lib/logger', () => ({
  loggerFor: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../lib/posthog-server', () => ({
  captureServerException: (...args: unknown[]) =>
    captureServerException(...args),
}));

const { createMyWorkspace } = await import('./actions');

const USER = 'auth0|newcomer';
const EMAIL = 'newcomer@example.com';
const CUSTOMER = 'cus_new';
const WORKSPACE = 'ws_new';

function form(name: unknown) {
  const data = new FormData();
  if (name !== undefined) data.set('name', name as string);
  return data;
}

/** Run the action, turning the redirect-by-throw back into a value. */
async function run(name: unknown = 'Acme Trading') {
  try {
    return { state: await createMyWorkspace({}, form(name)), redirected: null };
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return { state: null, redirected: error.to };
    }
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { sub: USER, email: EMAIL } });
  listMembershipsForUser.mockResolvedValue([]);
  createBillingCustomer.mockResolvedValue({ customerId: CUSTOMER });
  createWorkspace.mockResolvedValue({ workspaceId: WORKSPACE });
  linkCustomerToWorkspace.mockResolvedValue(undefined);
});

describe('refusals that write nothing', () => {
  it('refuses an expired session', async () => {
    getSession.mockResolvedValue(null);

    const { state } = await run();

    expect(state?.error).toMatch(/session expired/i);
    expect(createBillingCustomer).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('refuses an empty name with the schema message', async () => {
    const { state } = await run('   ');

    expect(state?.error).toBe('Give your workspace a name');
    expect(createBillingCustomer).not.toHaveBeenCalled();
  });

  it('refuses a name the schema rejects', async () => {
    const { state } = await run('<script>alert(1)</script>');

    expect(state?.error).toBeTruthy();
    expect(createBillingCustomer).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('refuses an account with NO email rather than minting an unreachable customer', async () => {
    // Stripe needs somewhere to send receipts and dunning notices. A customer
    // with no email can never be chased for a failed payment.
    getSession.mockResolvedValue({ user: { sub: USER } });

    const { state } = await run();

    expect(state?.error).toMatch(/no email address/i);
    expect(createBillingCustomer).not.toHaveBeenCalled();
  });

  it('refuses when the membership check itself fails, instead of assuming none', async () => {
    // Treating an unreachable database as "no memberships" is how a retry after
    // an outage produces a second workspace and a second Stripe customer.
    listMembershipsForUser.mockRejectedValue(new Error('Couchbase down'));

    const { state } = await run();

    expect(state?.error).toMatch(/could not reach your account/i);
    expect(createBillingCustomer).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });
});

describe('idempotency', () => {
  it('sends an existing member to chat WITHOUT provisioning again', async () => {
    // The double-click case. Two workspaces and two Stripe customers for one
    // person have no natural key to collapse them on afterwards.
    listMembershipsForUser.mockResolvedValue([
      { workspaceId: 'ws_existing', userId: USER, role: 'owner' },
    ]);

    const { redirected } = await run();

    expect(redirected).toBe('/chat');
    expect(createBillingCustomer).not.toHaveBeenCalled();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('re-checks membership immediately BEFORE writing, not from a stale read', async () => {
    await run();

    expect(listMembershipsForUser).toHaveBeenCalledWith(USER);
    expect(listMembershipsForUser.mock.invocationCallOrder[0]).toBeLessThan(
      createBillingCustomer.mock.invocationCallOrder[0]
    );
  });
});

describe('provisioning', () => {
  it('creates the Stripe customer BEFORE the workspace', async () => {
    // The whole ordering argument. If these ever run concurrently or in reverse,
    // a partial failure leaves a workspace that can spend and can never be
    // billed.
    await run();

    expect(createBillingCustomer.mock.invocationCallOrder[0]).toBeLessThan(
      createWorkspace.mock.invocationCallOrder[0]
    );
  });

  it('bills the customer it just created, and tags it with the workspace', async () => {
    const { redirected } = await run('Acme Trading');

    expect(createBillingCustomer).toHaveBeenCalledWith({
      email: EMAIL,
      name: 'Acme Trading',
      ownerUserId: USER,
    });
    expect(createWorkspace).toHaveBeenCalledWith({
      name: 'Acme Trading',
      ownerUserId: USER,
      ownerEmail: EMAIL,
      stripeCustomerId: CUSTOMER,
    });
    expect(linkCustomerToWorkspace).toHaveBeenCalledWith({
      customerId: CUSTOMER,
      workspaceId: WORKSPACE,
    });
    expect(redirected).toBe('/chat');
  });

  it('trims the name before it reaches Stripe and the invoice', async () => {
    await run('  Acme Trading  ');

    expect(createBillingCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme Trading' })
    );
  });
});

describe('failures during provisioning', () => {
  it('does NOT create a workspace when the Stripe customer fails', async () => {
    // The safe direction: no customer, no workspace, nothing to reconcile.
    createBillingCustomer.mockRejectedValue(new Error('Stripe unreachable'));

    const { state } = await run();

    expect(state?.error).toMatch(/could not finish setting up/i);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('reports a workspace write failure without claiming a charge was made', async () => {
    // The leftover is a customer nobody references — free and invisible. Saying
    // "nothing was charged" is true, and is what stops a support ticket.
    createWorkspace.mockRejectedValue(new Error('Couchbase down'));

    const { state } = await run();

    expect(state?.error).toMatch(/nothing was charged/i);
    expect(captureServerException).toHaveBeenCalled();
  });

  it('still succeeds when the best-effort customer tag fails', async () => {
    // The customer is already correct without it. Failing a signup because a
    // metadata write did not land would be absurd.
    linkCustomerToWorkspace.mockRejectedValue(new Error('rate limited'));

    const { state, redirected } = await run();

    expect(redirected).toBe('/chat');
    expect(state).toBeNull();
  });
});

describe('the redirect is not swallowed', () => {
  it('redirects on success rather than returning the failure message', async () => {
    // `redirect` works by throwing. Catching it would turn every successful
    // signup into "we could not finish setting up your workspace" — with the
    // workspace and the Stripe customer both sitting there, created.
    const { state, redirected } = await run();

    expect(redirected).toBe('/chat');
    expect(state).toBeNull();
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it('does not report a successful signup to error tracking', async () => {
    await run();

    expect(captureServerException).not.toHaveBeenCalled();
  });
});
