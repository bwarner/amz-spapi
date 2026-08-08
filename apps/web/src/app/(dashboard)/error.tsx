'use client';

import { useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for the signed-in app.
 *
 * Two jobs, and the second is the reason it exists. The visible one is giving
 * the seller a way out of a broken page. The other is reporting: React does not
 * route an error caught by a boundary through `window.onerror`, so exception
 * autocapture never sees it. Without an explicit capture here, every render
 * crash inside the dashboard would be invisible — the one class of error a user
 * is guaranteed to notice and we are guaranteed not to.
 *
 * Rendered inside `PostHogProvider` (see `(dashboard)/layout.tsx`), so the hook
 * resolves to the same identified client the rest of the app uses.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const posthog = usePostHog();

  useEffect(() => {
    posthog.captureException(error, {
      boundary: 'dashboard',
      // Next.js replaces the message with a digest in production builds; it is
      // the only handle that ties this report to the server-side log line.
      digest: error.digest,
    });
  }, [posthog, error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-foreground">
        Something went wrong
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        This page failed to load. The error has been reported. You can retry, or
        carry on somewhere else in the app.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <a href="/chat">Back to chat</a>
        </Button>
      </div>
    </div>
  );
}
