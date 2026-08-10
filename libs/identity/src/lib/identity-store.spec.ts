import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `firstSubscribedAt`, the field the free trial depends on.
 *
 * The trial is meant for a workspace that has never subscribed. That check used
 * to read `stripeSubscriptionId` — which the cancellation webhook CLEARS — so
 * it answered "never subscribed" again the moment somebody cancelled. Subscribe,
 * cancel, resubscribe minted a fresh trial every time, on the same card, for as
 * long as anybody cared to repeat it.
 *
 * The fix only holds if this field is written once and never cleared, and the
 * failure is silent in both directions: never set, and every returning customer
 * gets free weeks; cleared on cancellation, and the loophole is back with the
 * same shape. Neither shows up anywhere except the gateway bill.
 */

const store = new Map<string, unknown>();

vi.mock('@amz-spapi/couchbase-utils', () => ({
  collectionName: (domain: string, collection: string) =>
    `${domain}_${collection}`,
  getDocument: async (_d: string, _c: string, key: string) =>
    store.has(key) ? store.get(key) : null,
  upsertDocument: async (_d: string, _c: string, key: string, doc: unknown) => {
    store.set(key, doc);
  },
  insertDocument: async (_d: string, _c: string, key: string, doc: unknown) => {
    store.set(key, doc);
  },
  executeQuery: async () => ({ rows: [...store.values()] }),
}));

const { updateWorkspaceSubscription } = await import('./identity-store.js');

const WORKSPACE = 'ws_trialguard00000000000';

function seedWorkspace(over: Record<string, unknown> = {}) {
  store.set(WORKSPACE, {
    workspaceId: WORKSPACE,
    type: 'workspace',
    name: 'Acme',
    ownerUserId: 'auth0|owner',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    stripeCustomerId: 'cus_1',
    ...over,
  });
}

beforeEach(() => {
  store.clear();
});

describe('updateWorkspaceSubscription', () => {
  it('stamps firstSubscribedAt when the first subscription arrives', async () => {
    seedWorkspace();

    const updated = await updateWorkspaceSubscription({
      workspaceId: WORKSPACE,
      plan: 'pilot',
      subscriptionStatus: 'trialing',
      stripeSubscriptionId: 'sub_1',
    });

    expect(updated?.firstSubscribedAt).toBeTypeOf('number');
  });

  it('does NOT move firstSubscribedAt on later events', async () => {
    // Write-once. A renewal or a status change must not refresh it, or the
    // "have they subscribed before" answer drifts forward forever.
    seedWorkspace({ firstSubscribedAt: 1_600_000_000_000 });

    const updated = await updateWorkspaceSubscription({
      workspaceId: WORKSPACE,
      plan: 'scale',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_2',
    });

    expect(updated?.firstSubscribedAt).toBe(1_600_000_000_000);
  });

  it('KEEPS firstSubscribedAt when the subscription is deleted', async () => {
    // The regression that reopens the loophole. Cancellation clears the status
    // and the subscription id — deliberately, so entitlement drops — but this
    // field is the record that a trial has already been consumed.
    seedWorkspace({
      firstSubscribedAt: 1_600_000_000_000,
      plan: 'pilot',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_1',
    });

    const updated = await updateWorkspaceSubscription({
      workspaceId: WORKSPACE,
      // What the webhook sends for `customer.subscription.deleted`.
      subscriptionStatus: undefined,
      stripeSubscriptionId: undefined,
      currentPeriodEnd: undefined,
    });

    expect(updated?.stripeSubscriptionId).toBeUndefined();
    expect(updated?.subscriptionStatus).toBeUndefined();
    expect(updated?.firstSubscribedAt).toBe(1_600_000_000_000);
    // The plan is kept too — it records what they bought, and `effectivePlan`
    // needs the status alongside it to decide the allowance.
    expect(updated?.plan).toBe('pilot');
  });

  it('does not invent firstSubscribedAt for a status-only event', async () => {
    // No subscription id means nothing has been subscribed to yet; stamping it
    // here would burn the trial of a workspace that never bought anything.
    seedWorkspace();

    const updated = await updateWorkspaceSubscription({
      workspaceId: WORKSPACE,
      subscriptionStatus: undefined,
      stripeSubscriptionId: undefined,
    });

    expect(updated?.firstSubscribedAt).toBeUndefined();
  });
});
