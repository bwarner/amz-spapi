import {
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';

/**
 * Reading and repairing workspaces that predate billing.
 *
 * Everything here bypasses `@amz-spapi/identity`, and that is the point: those
 * functions validate against the current schema, which now requires a Stripe
 * customer. They would refuse to load exactly the documents this repairs. A
 * migration has to be able to read the old shape in order to end it.
 */

const DOMAIN = 'identity';
const WORKSPACES = 'workspaces';

export type StaleWorkspace = {
  workspaceId: string;
  name: string;
  ownerUserId: string;
  /** From the owner's membership row — the workspace itself has no email. */
  ownerEmail?: string;
};

/**
 * Workspaces with no Stripe customer, with their owner's email attached.
 *
 * The email comes from `identity_members` because the workspace document never
 * carried one, and Stripe needs somewhere to send receipts. A workspace whose
 * owner membership is also missing is reported without one so the operator sees
 * it rather than having it silently skipped.
 */
export async function findWorkspacesWithoutCustomer(): Promise<
  StaleWorkspace[]
> {
  const { rows } = await executeQuery<StaleWorkspace>(
    DOMAIN,
    `SELECT w.workspaceId, w.name, w.ownerUserId,
            (SELECT RAW m.email
               FROM \`identity_members\` m
              WHERE m.workspaceId = w.workspaceId
                -- Backticked: \`role\` is a reserved word in N1QL, and the
                -- parse error it produces names the column rather than the
                -- reason.
                AND m.\`role\` = 'owner'
              LIMIT 1)[0] AS ownerEmail
       FROM \`identity_workspaces\` w
      WHERE w.stripeCustomerId IS MISSING`
  );
  return rows;
}

/**
 * Write the customer id onto an existing workspace.
 *
 * Read-modify-write of the whole document rather than a targeted N1QL UPDATE,
 * so the stored shape is preserved exactly and only the one field is added.
 * Refuses if the workspace already has a customer — re-running the migration
 * must not replace a good customer with a fresh empty one, which would orphan
 * every subscription attached to it.
 */
export async function attachCustomerToWorkspace(
  workspaceId: string,
  customerId: string
): Promise<void> {
  const doc = await getDocument<Record<string, unknown>>(
    DOMAIN,
    WORKSPACES,
    workspaceId
  );
  if (!doc) throw new Error(`No workspace ${workspaceId}.`);
  if (doc['stripeCustomerId']) {
    throw new Error(
      `${workspaceId} already bills to ${String(doc['stripeCustomerId'])}.`
    );
  }

  await upsertDocument(DOMAIN, WORKSPACES, workspaceId, {
    ...doc,
    stripeCustomerId: customerId,
    updatedAt: Date.now(),
  });
}

export type TrialHistoryCandidate = {
  workspaceId: string;
  name: string;
  stripeCustomerId: string;
};

/**
 * Workspaces with a Stripe customer but no `firstSubscribedAt`.
 *
 * These predate the field. Each has to be asked about individually, because
 * nothing stored locally can distinguish "never subscribed" from "subscribed
 * and cancelled" — cancellation clears `stripeSubscriptionId`, which is the
 * whole reason the field was added.
 */
export async function findWorkspacesWithoutTrialHistory(): Promise<
  TrialHistoryCandidate[]
> {
  const { rows } = await executeQuery<TrialHistoryCandidate>(
    DOMAIN,
    `SELECT w.workspaceId, w.name, w.stripeCustomerId
       FROM \`identity_workspaces\` w
      WHERE w.firstSubscribedAt IS MISSING
        AND w.stripeCustomerId IS NOT MISSING`
  );
  return rows;
}

/**
 * Stamp `firstSubscribedAt` on a workspace that predates it.
 *
 * Write-once here too: refuses if the field is already set, so re-running can
 * never move the date forward. Moving it forward would be indistinguishable
 * from a fresh customer and would hand out another free trial — the exact
 * failure the field exists to prevent.
 */
export async function backfillFirstSubscribedAt(
  workspaceId: string,
  firstSubscribedAt: number
): Promise<void> {
  const doc = await getDocument<Record<string, unknown>>(
    DOMAIN,
    WORKSPACES,
    workspaceId
  );
  if (!doc) throw new Error(`No workspace ${workspaceId}.`);
  if (doc['firstSubscribedAt']) {
    throw new Error(
      `${workspaceId} already records a first subscription at ` +
        `${String(doc['firstSubscribedAt'])}.`
    );
  }

  await upsertDocument(DOMAIN, WORKSPACES, workspaceId, {
    ...doc,
    firstSubscribedAt,
    updatedAt: Date.now(),
  });
}
