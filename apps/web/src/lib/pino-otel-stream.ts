import { Writable } from 'node:stream';
import {
  logs,
  SeverityNumber,
  type LogAttributes,
} from '@opentelemetry/api-logs';

/**
 * A pino destination that re-emits each record as an OpenTelemetry log record.
 *
 * Sits on the OUTPUT side of pino, which is the whole point: by the time a line
 * reaches here it is the final serialised JSON, so `redact` has already
 * replaced every token and authorization code with `[redacted]`. A bridge built
 * on `hooks.logMethod` would see the arguments as passed and ship the secrets.
 *
 * Runs in the main thread rather than a pino `transport` worker. Workers cannot
 * see the OTel global provider registered in `instrumentation.ts`, and would
 * need their own exporter and their own flush — two pipelines to reason about
 * where one will do.
 */

/** pino numeric levels → the OTel severity pair. */
const SEVERITY: Array<{
  min: number;
  text: string;
  number: SeverityNumber;
}> = [
  { min: 60, text: 'FATAL', number: SeverityNumber.FATAL },
  { min: 50, text: 'ERROR', number: SeverityNumber.ERROR },
  { min: 40, text: 'WARN', number: SeverityNumber.WARN },
  { min: 30, text: 'INFO', number: SeverityNumber.INFO },
  { min: 20, text: 'DEBUG', number: SeverityNumber.DEBUG },
  { min: 0, text: 'TRACE', number: SeverityNumber.TRACE },
];

function severityFor(level: unknown) {
  const numeric = typeof level === 'number' ? level : 30;
  return SEVERITY.find((entry) => numeric >= entry.min) ?? SEVERITY[3];
}

/**
 * Fields consumed into the record's own shape rather than copied as attributes.
 * `pid` and `hostname` are dropped outright — on Vercel they identify an
 * ephemeral lambda instance and are noise in every single record.
 */
const CONSUMED = new Set([
  'level',
  'time',
  'msg',
  'pid',
  'hostname',
  'trace_id',
  'span_id',
]);

/**
 * Attribute names PostHog uses to associate a record with a person.
 *
 * `posthogDistinctId` is camelCase and is a LOG attribute — distinct from the
 * `posthog.distinct_id` resource attribute that traces and AI spans use. They
 * are not interchangeable, and using the trace spelling here silently produces
 * records attached to nobody.
 */
const DISTINCT_ID_ATTRIBUTE = 'posthogDistinctId';

/** Record fields that carry an Auth0 subject, in order of preference. */
const DISTINCT_ID_FIELDS = ['userId', 'sub', 'distinctId'];

function toAttributes(record: Record<string, unknown>): LogAttributes {
  const attributes: LogAttributes = {};

  for (const [key, value] of Object.entries(record)) {
    if (CONSUMED.has(key)) continue;
    if (value === undefined || value === null) continue;

    // OTel attributes are scalars or arrays of scalars. Anything structured is
    // JSON-encoded rather than dropped — a nested error object is usually the
    // most useful part of the line.
    attributes[key] =
      typeof value === 'object' ? JSON.stringify(value) : (value as never);
  }

  // Correlation with the span waterfall. The logger's mixin already stamps
  // these in OTel spelling; carried through as attributes so a record can be
  // matched to its trace without the emit-time context, which is gone by the
  // time pino has serialised the line.
  if (typeof record['trace_id'] === 'string') {
    attributes['trace_id'] = record['trace_id'];
  }
  if (typeof record['span_id'] === 'string') {
    attributes['span_id'] = record['span_id'];
  }

  for (const field of DISTINCT_ID_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value) {
      attributes[DISTINCT_ID_ATTRIBUTE] = value;
      break;
    }
  }

  return attributes;
}

/**
 * Build the destination. Never throws: a malformed line, or a provider that was
 * never registered, must not take down the request that was being logged.
 */
export function createOtelLogStream(): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      // pino writes newline-delimited JSON, and a single write can carry
      // several lines when records are produced in a tight loop.
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;

        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          const severity = severityFor(record['level']);

          logs.getLogger('sellavant-web').emit({
            severityText: severity.text,
            severityNumber: severity.number,
            body: typeof record['msg'] === 'string' ? record['msg'] : line,
            timestamp:
              typeof record['time'] === 'number' ? record['time'] : undefined,
            attributes: toAttributes(record),
          });
        } catch {
          // Not JSON, or the emit failed. The same bytes are already on stdout
          // via the other stream in the multistream, so nothing is lost that
          // was not already going to be lost.
        }
      }
      callback();
    },
  });
}
