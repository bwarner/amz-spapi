import type { Metadata } from 'next';
import {
  RECOMMENDED_PLAN,
  dailySpendCeilingUsd,
  effectivePlan,
  planFeatures,
  purchasablePlans,
} from '@farvisionllc/models';
import { Badge } from '@/components/ui/badge';
import { auth0 } from '../../../lib/auth0';
import { currentWorkspace } from '../../../lib/workspace-context';
import { spendTodayUsd } from '../../../lib/cost-ledger';
import { BillingActions } from './billing-actions';
import { BillingPortalButton } from './billing-portal-button';

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
    // max-w-4xl to match `team`, the page next to it in the nav. A 3xl column
    // left the two upgrade cards noticeably narrower than the plan card above
    // them on a wide display, which read as a layout accident.
    <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {workspace.name}
      </p>

      {/* Accented, because the whole point of this card is "the one you are on"
          and a plain border made it look like a third upgrade option. */}
      <div className="mt-6 rounded-lg border border-primary/40 bg-primary/3 p-4 sm:mt-8 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{plan.label}</h2>
            <Badge variant="secondary">Current plan</Badge>
          </div>
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

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4">
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

        {/* Only the owner may reach the portal — it can cancel the
            subscription and change the card. The route enforces that too; this
            just avoids offering an action that would be refused. */}
        {isOwner && workspace.stripeCustomerId ? (
          <BillingPortalButton
            // The same signal `BillingActions` uses, so the two halves of this
            // page cannot disagree about whether a subscription exists.
            hasSubscription={Boolean(workspace.stripeSubscriptionId)}
          />
        ) : null}
      </div>

      {isOwner ? (
        <BillingActions
          currentPlan={plan.id}
          hasSubscription={Boolean(workspace.stripeSubscriptionId)}
          // Write-once, so it stays false after a cancellation — the page must
          // not advertise a free trial the checkout route will refuse.
          trialEligible={!workspace.firstSubscribedAt}
          plans={purchasablePlans().map((p) => ({
            id: p.id,
            label: p.label,
            monthlyCents: p.monthlyCents,
            dailySpendUsd: p.dailySpendUsd,
            seats: p.seats,
            features: planFeatures(p),
            recommended: p.id === RECOMMENDED_PLAN,
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
