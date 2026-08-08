'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import './global.css';

/**
 * Last-resort boundary: a crash in the root layout itself.
 *
 * Next.js replaces the entire document when this renders, so it must supply its
 * own `<html>`/`<body>` and re-import the stylesheet — the root layout, and
 * everything it mounts, is gone by this point.
 *
 * That includes `PostHogProvider`, which is why this reaches for the module
 * singleton instead of `usePostHog()`. The singleton is only configured if a
 * provider mounted earlier in the session; on a marketing page that never did,
 * the capture is a no-op and the fallback still renders. Reporting is
 * best-effort here by necessity — showing the user something is not.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      posthog.captureException(error, {
        boundary: 'global',
        digest: error.digest,
      });
    } catch {
      // No initialised client on this page. Nothing further to try, and
      // throwing from the last boundary would white-screen the user.
    }
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-xl font-semibold">Sellavant is unavailable</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Something failed while loading the application. Please try again in
            a moment.
          </p>
          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
