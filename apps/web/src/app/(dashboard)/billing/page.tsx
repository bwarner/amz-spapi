import type { Metadata } from 'next';
import {
  dailySpendCeilingUsd,
  effectivePlan,
  purchasablePlans,
} from '@farvisionllc/models';
import { auth0 } from '../../../lib/auth0';
import { currentWorkspace } from '../../../lib/workspace-context';
import { spendTodayUsd } from '../../../lib/cost-ledger';
import { BillingActions } from './billing-actions';

export const metadata: Metadata = { title: 'Billing' };

/**
 * What the workspace is on, what it has spent, and how to change it.
 *
 * The daily figure is shown because the limit is a DAILY one, and a plan page
 * that only names a monthly price leaves somebody who just hit the cap with no
 * idea why. It is read from the same counter the cap enforces, so the number
 * here and the refusal they saw in chat cannot disagree.
 */
export default async function BillingPage() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) return null;

  const context = await currentWorkspace(session.user.sub);
  if (!context) return null;

  const { workspace, membership } = context;
  const plan = effectivePlan({
    plan: workspace.plan,
    subscriptionStatus: workspace.subscriptionStatus,
  });
  const ceiling = dailySpendCeilingUsd({
    plan: workspace.plan,
    subscriptionStatus: workspace.subscriptionStatus,
  });
  const spent = await spendTodayUsd(session.user.sub).catch(() => 0);
  const isOwner = membership.role === 'owner';

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {workspace.name}
      </p>

      <div className="mt-8 rounded-lg border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{plan.label}</h2>
          {workspace.subscriptionStatus ? (
            <span className="text-sm text-muted-foreground">
              Subscription {workspace.subscriptionStatus}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              No subscription
            </span>
          )}
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Today
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              ${spent.toFixed(2)}
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                / ${ceiling.toFixed(2)}
              </span>
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              AI usage, image generation and supplier lookups. Resets daily.
            </p>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Seats
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {plan.seats === -1 ? 'Unlimited' : plan.seats}
            </dd>
            {workspace.currentPeriodEnd ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Renews{' '}
                {new Date(workspace.currentPeriodEnd).toLocaleDateString(
                  undefined,
                  { year: 'numeric', month: 'short', day: 'numeric' }
                )}
              </p>
            ) : null}
          </div>
        </dl>
      </div>

      {isOwner ? (
        <BillingActions
          currentPlan={plan.id}
          hasSubscription={Boolean(workspace.stripeSubscriptionId)}
          plans={purchasablePlans().map((p) => ({
            id: p.id,
            label: p.label,
            dailySpendUsd: p.dailySpendUsd,
            seats: p.seats,
          }))}
        />
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          {/* Deliberately not a disabled upgrade button. Offering an action
              that cannot work is worse than saying who can take it. */}
          Only the workspace owner can change the plan. Ask them if you need a
          higher limit.
        </p>
      )}
    </div>
  );
}
