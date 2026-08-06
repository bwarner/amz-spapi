import { trace } from '@opentelemetry/api';
import pino from 'pino';

/**
 * The web app's logger.
 *
 * `apps/web` was the only runtime in the workspace still logging with bare
 * `console.*` — 60 call sites, 16 of them `console.log`, which CLAUDE.md §9
 * forbids outright. The CLIs have used Pino with levels since the beginning and
 * the Lambdas use Powertools; this closes the gap rather than adding a
 * per-feature `DEBUG_*` flag every time something needs to be observable.
 *
 * Configured to match `apps/spcli` and `apps/adscli` exactly — `LOG_LEVEL` and
 * `NO_PRETTY` — so one convention covers every runtime a developer touches.
 *
 * ## Redaction is the part that matters here
 *
 * This app handles Amazon access tokens, Auth0 tokens and OAuth authorization
 * codes. The recurring hazard in this codebase is not a missing log, it is a
 * log that contains a credential: #55 already found one Lambda writing an
 * entire encrypted credential document into CloudWatch through an error
 * message. `redact` makes that a property of the logger instead of a rule
 * everyone has to remember at every call site.
 *
 * It is a safety net, not a licence. Still do not pass a token deliberately —
 * redaction matches known paths, and a secret nested somewhere unanticipated
 * goes straight through.
 */

/**
 * Paths scrubbed before anything is written.
 *
 * Both bare and one level down, because these arrive both as top-level fields
 * and inside a `profile`, `token` or `config` object. Pino's wildcard `*.field`
 * covers one level of nesting, which is where they actually turn up.
 */
const REDACTED = [
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'code',
  'authorization',
  'Authorization',
  'password',
  'encrypted_secrets',
];

/**
 * Stamp every log line with the active trace, so logs and spans join up.
 *
 * Without this, Pino and OpenTelemetry coexist without ever meeting: the
 * telemetry in `telemetry.ts` produces a span waterfall for a chat turn, the
 * logs describe what happened during it, and nothing connects the two. With
 * `trace_id` on each line, a slow or expensive turn in the trace view leads
 * straight to its log lines and back.
 *
 * A `mixin` rather than `@opentelemetry/instrumentation-pino`, which is the
 * usual answer: the mixin needs no new dependency (`@opentelemetry/api` is
 * already here for `telemetry.ts`), it is six lines instead of another
 * instrumentation registered into `@vercel/otel`, and it is explicit about the
 * two fields it adds.
 *
 * It runs in the MAIN thread, before the record is handed to the pretty
 * transport's worker. That ordering matters: span context lives in async
 * storage on this side, and nothing inside the worker could see it.
 *
 * Field names follow the OTel logs convention (`trace_id`, `span_id`), which is
 * what drains expect for correlation.
 */
function traceContext(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};

  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin: traceContext,
  redact: {
    paths: [...REDACTED, ...REDACTED.map((field) => `*.${field}`)],
    censor: '[redacted]',
  },
  // Pretty in a terminal, JSON everywhere else. Vercel ingests stdout, and
  // structured JSON is what makes a log searchable there — so anything that is
  // not an interactive shell gets the machine-readable form.
  transport:
    process.env.NO_PRETTY || process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});

/**
 * A logger tagged with the area it came from.
 *
 * Replaces the `[api-service]` / `[chat]` string prefixes the console calls
 * used. Same readability, but the tag is a field rather than part of the
 * message, so it can be filtered on once these reach a log drain.
 */
export function loggerFor(name: string) {
  return logger.child({ name });
}
