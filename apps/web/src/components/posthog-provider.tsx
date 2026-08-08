'use client';

import { useEffect } from 'react';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';

/**
 * Identifies the signed-in user to PostHog using the SAME id the server uses for
 * flag evaluation (Auth0 `sub`), so client analytics and the server-side
 * `aplus-image-model` A/B decision bucket the user consistently.
 *
 * Also turns on exception autocapture, which is what makes PostHog our error
 * tracker rather than only our analytics. Done imperatively because
 * `capture_exceptions` is not a typed config option in posthog-js 1.396.x —
 * `startExceptionAutocapture()` is the supported entry point. Calling it here
 * rather than relying on the project's remote-config toggle keeps the decision
 * in the repo: a fresh PostHog project, or someone flipping the dashboard
 * switch off, cannot silently stop error reporting.
 */
function PostHogBootstrap({
  distinctId,
  email,
}: {
  distinctId?: string;
  email?: string;
}) {
  const posthog = usePostHog();

  useEffect(() => {
    posthog.startExceptionAutocapture();
  }, [posthog]);

  useEffect(() => {
    if (!distinctId) return;
    posthog.identify(distinctId, email ? { email } : undefined);
  }, [posthog, distinctId, email]);

  return null;
}

/**
 * Client-side PostHog provider (posthog-js/react). No-ops gracefully when
 * NEXT_PUBLIC_POSTHOG_KEY is unset so local/dev without PostHog still works.
 */
export function PostHogProvider({
  distinctId,
  email,
  children,
}: {
  distinctId?: string;
  email?: string;
  children: React.ReactNode;
}) {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return <>{children}</>;
  return (
    <PHProvider
      apiKey={apiKey}
      options={{
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        capture_pageview: true,
        person_profiles: 'identified_only',
      }}
    >
      <PostHogBootstrap distinctId={distinctId} email={email} />
      {children}
    </PHProvider>
  );
}
