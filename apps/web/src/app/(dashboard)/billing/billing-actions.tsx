'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PlanOption = {
  id: string;
  label: string;
  dailySpendUsd: number;
  seats: number;
};

/**
 * Upgrade and manage, for the workspace owner.
 *
 * Both buttons ask the server for a Stripe URL and then navigate, rather than
 * posting a form straight at Stripe. The server is the only place that knows
 * which customer this workspace bills to, and putting a price id in a form the
 * browser controls would let anyone subscribe anybody to anything.
 */
export function BillingActions({
  currentPlan,
  hasSubscription,
  plans,
}: {
  currentPlan: string;
  hasSubscription: boolean;
  plans: PlanOption[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="mt-8 space-y-4">
      <h2 className="text-lg font-semibold">
        {hasSubscription ? 'Change your plan' : 'Upgrade'}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const current = plan.id === currentPlan;
          return (
            <div key={plan.id} className="rounded-lg border p-4">
              <p className="font-medium">{plan.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                ${plan.dailySpendUsd}/day of AI usage ·{' '}
                {plan.seats === -1 ? 'unlimited' : plan.seats} seats
              </p>
              <Button
                className="mt-3 w-full"
                variant={current ? 'outline' : 'default'}
                disabled={current || busy !== null}
                onClick={() =>
                  go('/api/billing/checkout', { plan: plan.id }, plan.id)
                }
              >
                {busy === plan.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {current ? 'Current plan' : `Choose ${plan.label}`}
              </Button>
            </div>
          );
        })}
      </div>

      {hasSubscription ? (
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => go('/api/billing/portal')}
        >
          {busy === '/api/billing/portal' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Manage payment and invoices
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
