'use client';

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The way into the Stripe customer portal.
 *
 * ## Why it is not down with the upgrade cards
 *
 * It used to be: a lone outlined button below the plan grid, labelled with a
 * noun phrase. For somebody who already pays us, this is the most important
 * control on the page — invoices, card, billing address, cancellation — and it
 * sat last, beneath a section trying to sell them something else. Anyone
 * hunting for an invoice had to scroll past the marketing to find it.
 *
 * It belongs on the plan card, because that is where a customer looks for
 * facts about the arrangement they already have.
 *
 * ## Why the label says what it does, and where it goes
 *
 * "Payment methods and invoices" names a destination, not an action, and gives
 * no hint that clicking leaves the application. The portal is a full-page
 * redirect to Stripe, so the button says so — a redirect nobody expected reads
 * as the app breaking.
 *
 * The supporting line is not decoration: `subscription_cancel` is enabled on
 * our portal configuration, so this button is also the cancel route. Hiding
 * that behind "manage" is the kind of omission that turns a cancellation into
 * a support email, or a chargeback.
 */
export function BillingPortalButton({
  hasSubscription,
}: {
  hasSubscription: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        setError(data.error ?? 'Could not reach billing. Please try again.');
        setBusy(false);
        return;
      }
      // Full navigation, not a router push: Stripe is a different origin.
      window.location.href = data.url;
    } catch {
      setError('Could not reach billing. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Billing details</p>
          <p className="text-xs text-muted-foreground">
            {hasSubscription
              ? 'Invoices, payment method, billing address, and cancellation.'
              : 'Invoices and payment method.'}
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={open}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
          )}
          Manage billing in Stripe
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
