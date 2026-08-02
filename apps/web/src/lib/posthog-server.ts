import { PostHog } from 'posthog-node';

/**
 * The server-side PostHog client, shared.
 *
 * Extracted from `image-model-flag.ts`, which owned the only instance and used
 * it purely to read a flag. A second client would mean a second buffer, a
 * second flush schedule and two places to configure — and both are keyed on the
 * same Auth0 `sub`, so they were always one thing.
 *
 * Best-effort throughout: if PostHog is unconfigured or a call fails, callers
 * carry on. Analytics must never be the reason a seller's request breaks.
 */

// Module scope so warm serverless invocations and the dev server reuse it.
// `undefined` = not yet initialised, `null` = PostHog not configured.
let client: PostHog | null | undefined;

export function getPostHog(): PostHog | null {
  if (client !== undefined) return client;

  const key =
    process.env['POSTHOG_KEY'] ?? process.env['NEXT_PUBLIC_POSTHOG_KEY'];
  if (!key) {
    client = null;
    return client;
  }

  client = new PostHog(key, {
    host:
      process.env['POSTHOG_HOST'] ??
      process.env['NEXT_PUBLIC_POSTHOG_HOST'] ??
      'https://us.i.posthog.com',
    // Serverless: the process can be frozen the moment a response is sent, so
    // a buffered event is a lost event.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * Send one event, never throwing.
 *
 * `capture` is fire-and-forget in posthog-node; the explicit flush is what
 * makes it survive a serverless freeze.
 */
export async function captureServerEvent(params: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const posthog = getPostHog();
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    });
    await posthog.flush();
  } catch (error) {
    console.error(
      '[posthog] capture failed',
      params.event,
      error instanceof Error ? error.message : error
    );
  }
}
