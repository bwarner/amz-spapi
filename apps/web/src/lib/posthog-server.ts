import { PostHog } from 'posthog-node';
import { loggerFor } from './logger';
const log = loggerFor('posthog');

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
 * Report a server-side exception to PostHog error tracking, never throwing.
 *
 * The gap this fills: exceptions on the server reached nobody. Pino writes them
 * to stdout, which on Vercel is a short-retention log with no alerting, so a
 * failing agent turn was invisible unless somebody happened to be tailing.
 * PostHog is already here for analytics and does error tracking too — one
 * fewer vendor than adding Sentry alongside it.
 *
 * `captureExceptionImmediate` rather than `captureException` for the same
 * reason `captureServerEvent` flushes explicitly: the serverless process can be
 * frozen the moment a response is sent, and a buffered exception is a lost one.
 *
 * `distinctId` is optional because the most valuable reports — a failure in
 * auth, or before the session is read — are exactly the ones with no user yet.
 * PostHog groups those separately rather than dropping them.
 */
export async function captureServerException(
  error: unknown,
  params: {
    distinctId?: string;
    properties?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const posthog = getPostHog();
  if (!posthog) return;

  try {
    await posthog.captureExceptionImmediate(
      error,
      params.distinctId,
      params.properties
    );
  } catch (reportingError) {
    // Losing the report must not escalate into a second failure on a path that
    // is already handling one.
    log.error(
      {
        error:
          reportingError instanceof Error
            ? reportingError.message
            : reportingError,
      },
      'exception capture failed'
    );
  }
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
    log.error(
      {
        event: params.event,
        error: error instanceof Error ? error.message : error,
      },
      'capture failed'
    );
  }
}
