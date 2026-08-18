import Stripe from 'stripe';
import { PRODUCT_TAG, PRODUCT_TAG_KEY } from './product-tag.js';

/**
 * Stripe customers, and the client that makes them.
 *
 * Deliberately small. This library exists so that `libs/identity` never has to
 * know Stripe exists — a workspace is created with a customer id handed to it,
 * not by reaching for a billing SDK. Subscriptions, checkout and the webhook
 * come later and belong here too; customer creation is first because a
 * workspace cannot legitimately exist without one.
 */

let client: Stripe | null | undefined;

export class BillingNotConfiguredError extends Error {
  constructor() {
    super(
      'Stripe is not configured. Set STRIPE_SECRET_KEY to create workspaces.'
    );
    this.name = 'BillingNotConfiguredError';
  }
}

/**
 * The shared Stripe client, or null when no key is configured.
 *
 * Module scope so a warm serverless invocation reuses the connection pool.
 * Returns null rather than throwing so a caller can decide — some paths want to
 * degrade, and the one that must not is `createBillingCustomer`, which throws
 * explicitly.
 *
 * The API version is pinned from env rather than left to the SDK default: an
 * SDK upgrade silently moving the API version is how webhook payload shapes
 * change under a running system.
 */
export function stripeClient(): Stripe | null {
  if (client !== undefined) return client;

  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) {
    client = null;
    return client;
  }

  const apiVersion = process.env['STRIPE_API_VERSION'];
  client = new Stripe(key, {
    ...(apiVersion
      ? { apiVersion: apiVersion as Stripe.LatestApiVersion }
      : {}),
    // Shows up in Stripe's dashboard next to each request, which is what tells
    // you whether a customer came from us or from the sibling project sharing
    // this account.
    appInfo: { name: 'sellavant' },
  });
  return client;
}

/** Test seam: drop the memoised client so a test can swap the key. */
export function resetStripeClient(): void {
  client = undefined;
}

export type NewCustomer = {
  /** The owner's email. Stripe uses it for receipts and dunning. */
  email: string;
  /** Workspace name — what appears on the invoice. */
  name: string;
  /** Auth0 subject of the person creating it. */
  ownerUserId: string;
};

/**
 * Create the Stripe customer a workspace will bill to.
 *
 * Called BEFORE the workspace exists, which fixes the failure ordering. If this
 * succeeds and the workspace write then fails, the result is a customer nobody
 * references — invisible, free, and identifiable later by its metadata. The
 * reverse would be a workspace that can spend and can never be charged, and
 * repairing that means guessing which customer belongs to which workspace.
 *
 * `ownerUserId` goes in metadata for exactly that reconciliation: it is the one
 * field that ties an orphan back to a person.
 */
export async function createBillingCustomer(
  params: NewCustomer
): Promise<{ customerId: string }> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingNotConfiguredError();

  const customer = await stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: {
      ownerUserId: params.ownerUserId,
      // This Stripe account is shared with another product, so every record we
      // create says so. Without it, reconciling a customer list means guessing
      // from the name.
      [PRODUCT_TAG_KEY]: PRODUCT_TAG,
    },
  });

  return { customerId: customer.id };
}

/**
 * Record which workspace a customer belongs to, once it exists.
 *
 * Best-effort and deliberately not awaited into the critical path by callers:
 * the customer is already correct without it, and failing a signup because a
 * metadata write did not land would be absurd. It exists so that somebody
 * reading the Stripe dashboard can get from a charge back to a workspace.
 */
export async function linkCustomerToWorkspace(params: {
  customerId: string;
  workspaceId: string;
}): Promise<void> {
  const stripe = stripeClient();
  if (!stripe) return;

  await stripe.customers.update(params.customerId, {
    metadata: { workspaceId: params.workspaceId },
  });
}
