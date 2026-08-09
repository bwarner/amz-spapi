'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createMyWorkspace, type OnboardingState } from './actions';

/**
 * Separate from the submit button so `useFormStatus` can see the pending state.
 * That hook reads the nearest enclosing form, so it has to live in a child of
 * it rather than alongside the `useActionState` call.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {pending ? 'Setting things up…' : 'Create workspace'}
    </Button>
  );
}

/**
 * The one form a new account sees.
 *
 * Disabling the button while pending is not cosmetic here. The submit creates a
 * Stripe customer, and a double-click would otherwise start two of them for one
 * person; the server re-checks membership for the same reason, because a
 * disabled button is a courtesy and not a guarantee.
 */
export function OnboardingForm({
  suggestion,
  token,
}: {
  suggestion: string;
  token?: string;
}) {
  const [state, formAction] = useActionState<OnboardingState, FormData>(
    createMyWorkspace,
    {}
  );

  return (
    <form action={formAction} className="mt-8 space-y-4">
      {/* Round-trips the plan they chose before signing up. A hidden field
          rather than a URL parameter so it survives the form POST. */}
      {token ? <input type="hidden" name="token" value={token} /> : null}
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">
          Workspace name
        </label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={suggestion}
          placeholder="Acme Trading"
          autoFocus
          aria-describedby={state.error ? 'workspace-name-error' : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Usually your business name. It appears on invoices, and you can change
          it later.
        </p>
      </div>

      {state.error ? (
        <p
          id="workspace-name-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
