'use client';

import { useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { TRIAL_DAYS } from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type PlanOption = {
  id: string;
  label: string;
  /**
   * Monthly list price. Read from the PLAN TABLE, not the price catalogue:
   * `syncPriceCatalog` refuses to write a row whose amount disagrees with the
   * table, so the two cannot differ — and this way the page still renders if
   * Couchbase is unreachable.
   */
  monthlyCents: number;
  dailySpendUsd: number;
  seats: number;
  /** Derived from the plan table by `planFeatures`, never written out here. */
  features: string[];
  recommended: boolean;
};

/** "$99" — whole dollars, because every plan price is one. */
function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Choosing a plan, for the workspace owner.
 *
 * Managing an existing arrangement — invoices, card, cancellation — lives in
 * `BillingPortalButton` on the plan card instead, where somebody looking for it
 * will actually look.
 *
 * Each button asks the SERVER for a Stripe URL and then navigates, rather than
 * posting a form straight at Stripe. The server is the only place that knows
 * which customer this workspace bills to, and putting a price id in a form the
 * browser controls would let anyone subscribe anybody to anything. It is also
 * where an existing subscription is turned into a plan change rather than a
 * second purchase.
 */
export function BillingActions({
  currentPlan,
  hasSubscription,
  trialEligible,
  plans,
}: {
  currentPlan: string;
  /** Whether this is a plan CHANGE rather than a first purchase. */
  hasSubscription: boolean;
  /**
   * Whether a trial would actually be granted. Derived from the workspace's
   * write-once `firstSubscribedAt`, which is the same field the checkout route
   * reads — so the page cannot promise free weeks the server will refuse.
   */
  trialEligible: boolean;
  plans: PlanOption[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which card's features are expanded, on NARROW screens only.
   *
   * Stacked one per column, an eight-item list made each card most of a phone
   * viewport and pushed the second tier entirely below the fold — so somebody
   * comparing plans could not see that a second one existed. Collapsed by
   * default under `sm`, always open above it, matching the disclosure the
   * marketing pricing page already uses.
   */
  const [openFeatures, setOpenFeatures] = useState<string | null>(null);

  // Exactly one solid CTA, so there is a single obvious default action and the
  // recommendation carries weight rather than resting on a badge alone.
  //
  // Only ever an UPGRADE. Picking "the recommended tier that is not the current
  // one" reads well until somebody is on the top tier, at which point the
  // recommended tier is BELOW them and the page starts soliciting a downgrade
  // in the most emphatic style it has. Ordered by price rather than by array
  // position, so reordering `purchasablePlans()` cannot quietly invert this.
  const currentPrice =
    plans.find((plan) => plan.id === currentPlan)?.monthlyCents ?? 0;
  const upgrades = plans.filter((plan) => plan.monthlyCents > currentPrice);
  // Undefined on the top tier — nothing to sell, so nothing is emphasised.
  const emphasised =
    upgrades.find((plan) => plan.recommended)?.id ?? upgrades[0]?.id;

  async function go(path: string, body?: unknown, key = path) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        setError(data.error ?? 'Could not reach billing. Please try again.');
        setBusy(null);
        return;
      }
      // Full navigation, not a router push: Stripe is a different origin.
      window.location.href = data.url;
    } catch {
      setError('Could not reach billing. Please try again.');
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-3 sm:mt-8 sm:space-y-4">
      <h2 className="text-lg font-semibold">
        {hasSubscription ? 'Change your plan' : 'Upgrade'}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const current = plan.id === currentPlan;
          return (
            <div
              key={plan.id}
              className={
                'flex flex-col rounded-lg border p-3 sm:p-4' +
                // `emphasised`, not `plan.recommended`, drives the accent, the
                // badge and the button fill alike — one notion of "the plan we
                // are steering you to", so they cannot contradict each other.
                // It is upgrades-only by construction, which is what stops the
                // top tier being told to downgrade.
                (plan.id === emphasised ? ' border-primary/50' : '')
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{plan.label}</p>
                {plan.id === emphasised ? <Badge>Recommended</Badge> : null}
              </div>

              {/* THE PRICE. Previously this card showed only the allowance and
                  the seat count, so "Choose Pilot" took somebody to a Stripe
                  page quoting a number they had never been shown. What you are
                  about to be charged belongs on the button's own card.

                  Monthly because that is what the button buys: the checkout
                  call below sends no interval, and the route defaults to
                  'month'. Saying "/month" here and posting a yearly price would
                  be the same class of lie the price catalogue exists to stop.

                  Deliberately NOT `tabular-nums`: tabular figures pad every
                  digit to a uniform advance width, and the padding lands
                  between the `$` and the number — it renders as "$ 99". */}
              <p className="mt-2">
                <span className="text-xl font-semibold text-foreground">
                  {usd(plan.monthlyCents)}
                </span>
                <span className="text-sm text-muted-foreground">/month</span>
                {trialEligible && TRIAL_DAYS > 0 ? (
                  // Inline rather than on its own line: it is a qualifier on
                  // the price, and stacked it cost a whole line of height on a
                  // phone, where the second plan is already fighting for the
                  // fold.
                  //
                  // Gated on the SAME signal the checkout route uses, so this
                  // promise and the Stripe session cannot disagree. It is not
                  // `!hasSubscription`: somebody who cancelled has no
                  // subscription but has already had their trial.
                  <span className="text-xs text-muted-foreground">
                    {' · '}
                    {TRIAL_DAYS}-day free trial
                  </span>
                ) : null}
              </p>

              <p className="mt-2 text-sm text-muted-foreground">
                ${plan.dailySpendUsd}/day of AI usage ·{' '}
                {plan.seats === -1 ? 'Unlimited' : plan.seats} seats
              </p>

              {/* A real control, not a text link.

                  It was `text-xs` with `hover:underline`, which on a phone is
                  neither: there is no hover, so the only affordance never
                  fired, and the tap area was the height of the text — around
                  16px against the 44px that WCAG 2.5.5 and every mobile HIG
                  ask for. The border, the full width and the chevron say
                  "this does something"; `min-h-11` is the 44px. */}
              <button
                type="button"
                onClick={() =>
                  setOpenFeatures(openFeatures === plan.id ? null : plan.id)
                }
                aria-expanded={openFeatures === plan.id}
                aria-controls={`plan-${plan.id}-features`}
                className="mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm text-muted-foreground sm:hidden"
              >
                <span>
                  {openFeatures === plan.id
                    ? 'Hide features'
                    : `${plan.features.length} features included`}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={
                    'h-4 w-4 shrink-0 transition-transform' +
                    (openFeatures === plan.id ? ' rotate-180' : '')
                  }
                />
              </button>

              <ul
                id={`plan-${plan.id}-features`}
                className={
                  'mt-3 space-y-1.5 text-sm text-muted-foreground sm:block ' +
                  (openFeatures === plan.id ? 'block' : 'hidden')
                }
              >
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* `mt-auto` on the WRAPPER, not the button: it absorbs the free
                  space so the buttons line up across cards whose feature lists
                  differ in length, while `pt-4` guarantees a gap above even
                  when there is no free space to absorb. On the button itself,
                  padding would just make the button taller. */}
              <div className="mt-auto pt-3 sm:pt-4">
                <Button
                  className="w-full"
                  variant={
                    current || plan.id !== emphasised ? 'outline' : 'default'
                  }
                  disabled={current || busy !== null}
                  onClick={() =>
                    go('/api/billing/checkout', { plan: plan.id }, plan.id)
                  }
                >
                  {busy === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {/* "Switch to" once subscribed, because that is what the
                      server does: an existing subscription is moved to the new
                      price in the portal, with proration, rather than a second
                      one being bought. "Choose" would describe a purchase that
                      no longer happens. */}
                  {current
                    ? 'Current plan'
                    : hasSubscription
                    ? `Switch to ${plan.label}`
                    : `Choose ${plan.label}`}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
