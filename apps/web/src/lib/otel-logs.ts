import { logs } from '@opentelemetry/api-logs';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';

/**
 * Ships server logs to PostHog Logs over OTLP.
 *
 * ## The gap this closes
 *
 * Pino writes to stdout. On Vercel that is a short-retention log with no
 * alerting and no search worth the name, so every `log.error` in this app — the
 * credential-read failures, the metering failures, the agent stream that died
 * mid-turn — was effectively write-only. `captureServerException` fixed the
 * *exceptions*; this fixes everything else, which is the breadcrumbs you need
 * to understand why an exception happened.
 *
 * ## Why the whole pino stream rather than new call sites
 *
 * The obvious alternative is a `logInfo`/`logError` helper that emits OTel
 * records directly, and call it from the places that matter. That is what the
 * sibling project does, and the result there is instructive: 19 server files
 * log only through `console` and never reach the pipeline at all. An opt-in
 * bridge is one everybody forgets.
 *
 * Bridging pino's OUTPUT stream instead means every existing `loggerFor(...)`
 * call site is carried with no edit, and — the part that matters more — records
 * arrive **after** pino's redaction has run. Tokens and authorization codes are
 * already `[redacted]` by the time this sees them. A bridge that hooked the log
 * method instead would run before redaction and would ship the secrets.
 *
 * ## Serverless delivery
 *
 * `BatchLogRecordProcessor`, never `SimpleLogRecordProcessor`. Simple fires each
 * export as an untracked `void doExport()`, so its `forceFlush()` awaits
 * nothing: the lambda freezes with the request in flight and the record arrives
 * minutes late on the next thaw, or never if the instance is reclaimed. Batch's
 * `forceFlush()` drains the buffer and awaits the exporter, which is what makes
 * `flushLogs()` mean anything.
 */

let provider: LoggerProvider | null = null;
let warned = false;

/** The service name every record is tagged with, matching the tracer's. */
const SERVICE_NAME = 'sellavant-web';

function posthogKey(): string | undefined {
  return process.env['POSTHOG_KEY'] ?? process.env['NEXT_PUBLIC_POSTHOG_KEY'];
}

function posthogHost(): string {
  return (
    process.env['POSTHOG_HOST'] ??
    process.env['NEXT_PUBLIC_POSTHOG_HOST'] ??
    'https://us.i.posthog.com'
  );
}

/**
 * Surfaces delivery failures instead of swallowing them.
 *
 * Without this a rejected export — a bad token, a network error, PostHog
 * returning 4xx — is invisible, and the pipeline looks healthy precisely when
 * it has stopped working. Writes with `console.warn` rather than the app logger
 * on purpose: routing a logging failure back through the logger that failed is
 * how you get a loop.
 */
class WarnOnFailureLogExporter implements LogRecordExporter {
  constructor(private readonly inner: OTLPLogExporter) {}

  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void
  ): void {
    this.inner.export(records, (result) => {
      if (result.code === ExportResultCode.FAILED) {
        console.warn(
          '[otel-logs] export to PostHog failed:',
          result.error?.message ?? 'unknown error'
        );
      }
      resultCallback(result);
    });
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

/**
 * Register the global logger provider. Idempotent; called from
 * `instrumentation.ts` at server start.
 *
 * Returns whether a pipeline was installed, so the pino bridge can skip its own
 * setup rather than serialising records nothing will read.
 */
export function initLogs(): boolean {
  if (provider) return true;

  const apiKey = posthogKey();
  if (!apiKey) {
    if (!warned) {
      warned = true;
      // Loud rather than silent: in production this means logs are going
      // nowhere durable, which is exactly the condition this module exists to
      // end, and a no-op would hide it.
      console.warn(
        '[otel-logs] No POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_KEY — server logs ' +
          'will reach stdout only, with no durable retention.'
      );
    }
    return false;
  }

  const exporter = new OTLPLogExporter({
    // The `/i/` ingestion prefix is required and the exporter does NOT append
    // `/v1/logs` itself, so the full path is spelled out here. Getting this
    // wrong produces a 404 per batch and no records, with nothing in the app
    // to indicate why — see WarnOnFailureLogExporter above.
    url: `${posthogHost().replace(/\/$/, '')}/i/v1/logs`,
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  provider = new LoggerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new WarnOnFailureLogExporter(exporter),
      }),
    ],
  });

  logs.setGlobalLoggerProvider(provider);
  return true;
}

/**
 * Drain buffered records before the response returns.
 *
 * Call from `after()` in a route handler. Without it a serverless instance can
 * be frozen with a full buffer, and the records for the request you most want
 * to read — the one that just failed — are the ones most likely to be lost.
 */
export async function flushLogs(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
  } catch {
    // Telemetry must never break a request, and a failed flush has already
    // been reported by the exporter wrapper.
  }
}
