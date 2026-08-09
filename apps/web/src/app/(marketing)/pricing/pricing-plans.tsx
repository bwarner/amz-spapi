'use client';

import { useState } from 'react';
import { type BillingInterval, type PlanId } from '@farvisionllc/models';

/**
 * The pricing accordion.
 *
 * One row per plan, expanding to show what it includes. Written here rather
 * than taken from a component library because the paid block this imitates is
 * a licence we do not hold — and because the interesting behaviour (the
 * interval toggle changing every price at once, one row open at a time) is a
 * dozen lines, not a dependency.
 *
 * A CLIENT component, unusually for this codebase: the interval toggle and the
 * accordion are both local state, and re-rendering three cards on the server
 * for a radio button would be a round trip for nothing. Everything it needs is
 * computed on the server and handed down as plain data — it never reads the
 * plan table or a price itself, so there is no way for it to disagree with what
 * checkout will charge.
 */

export type PricingRow = {
  id: PlanId;
  label: string;
  tagline: string;
  /** Formatted, because the server owns money formatting. */
  monthly: string;
  yearly: string;
  /** Per-month equivalent when paying yearly. */
  yearlyPerMonth: string;
  savingPercent: number;
  features: string[];
  /** Absent for the free tier, which is not bought. */
  href?: { month: string; year: string };
  ctaLabel: string;
  highlight: boolean;
};

export type ActivePromo = {
  code: string;
  description: string;
};

export function PricingPlans({
  plans,
  promo,
  trialDays,
}: {
  plans: PricingRow[];
  promo?: ActivePromo | null;
  trialDays: number;
}) {
  const [interval, setInterval] = useState<BillingInterval>('month');
  // Open the recommended row by default: an accordion where everything is shut
  // shows three names and no reason to choose between them.
  const [open, setOpen] = useState<PlanId | null>(
    plans.find((p) => p.highlight)?.id ?? null
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      {promo ? (
        /**
         * The code is shown, not just the fact of a discount. Somebody who
         * arrived on another device has no cookie, and reading the code here is
         * how they can still type it into Stripe's own field at checkout.
         */
        <div
          className="mb-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm"
          role="status"
        >
          <span className="font-medium text-emerald-700 dark:text-emerald-300">
            {promo.description}
          </span>
          <span className="text-muted-foreground">
            applied with code{' '}
            <code className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold">
              {promo.code}
            </code>
          </span>
        </div>
      ) : null}

      <div className="mb-8 flex justify-center">
        <div
          className="inline-flex rounded-full border bg-muted/40 p-1"
          role="radiogroup"
          aria-label="Billing interval"
        >
          {(['month', 'year'] as const).map((value) => {
            const active = interval === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setInterval(value)}
                className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {value === 'month' ? 'Monthly' : 'Annually'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y rounded-xl border bg-background">
        {plans.map((plan) => {
          const expanded = open === plan.id;
          const price =
            interval === 'year' ? plan.yearlyPerMonth : plan.monthly;
          const free = !plan.href;

          return (
            <div key={plan.id} className={plan.highlight ? 'bg-muted/20' : ''}>
              <div className="flex flex-wrap items-center gap-4 px-5 py-5 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{plan.label}</h3>
                    {plan.highlight ? (
                      <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                        Best value
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {plan.tagline}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : plan.id)}
                    aria-expanded={expanded}
                    aria-controls={`plan-${plan.id}-features`}
                    className="mt-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {expanded
                      ? 'Hide features'
                      : `${plan.features.length} features included`}
                  </button>
                </div>

                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-2xl font-semibold tabular-nums">
                    {free ? 'Free' : price}
                  </span>
                  {free ? null : (
                    <span className="text-sm text-muted-foreground">/mo</span>
                  )}
                </div>

                <div className="w-full sm:w-auto">
                  {plan.href ? (
                    <a
                      href={plan.href[interval]}
                      className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 sm:w-auto"
                    >
                      {plan.ctaLabel}
                    </a>
                  ) : (
                    <a
                      href="/auth/login?screen_hint=signup"
                      className="inline-flex w-full items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted sm:w-auto"
                    >
                      {plan.ctaLabel}
                    </a>
                  )}
                </div>
              </div>

              {expanded ? (
                <div
                  id={`plan-${plan.id}-features`}
                  className="border-t bg-muted/30 px-5 py-4"
                >
                  <ul className="grid gap-2 text-sm sm:grid-cols-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 text-emerald-600 dark:text-emerald-400"
                        >
                          ✓
                        </span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {interval === 'year' && plan.savingPercent > 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {plan.yearly} billed yearly — saves {plan.savingPercent}%
                      against monthly.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {/* Says a card IS required. The free tier is the no-card route, and
            promising otherwise here would be a surprise at the worst moment. */}
        Paid plans include a {trialDays}-day free trial. Card required, cancel
        any time. The Free plan needs no card.
      </p>
    </div>
  );
}
