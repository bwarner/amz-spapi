import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import pino from 'pino';
import { createOtelLogStream } from './pino-otel-stream';

/**
 * The pino → OpenTelemetry bridge.
 *
 * Two things are being protected here, and the first is a security property.
 *
 * REDACTION. The bridge is deliberately on pino's OUTPUT stream so that
 * `redact` has already run. If someone later "simplifies" it onto
 * `hooks.logMethod` — which is the more obvious place, and is what most
 * examples show — the bridge would see arguments as passed and start shipping
 * Amazon refresh tokens and Auth0 authorization codes to PostHog. That is a
 * silent, unlogged data leak, and `emitsRedactedValues` is what stands in
 * front of it.
 *
 * MAPPING. Everything else here pins detail that fails quietly: a severity that
 * maps every record to INFO, a nested error object stringified into
 * `[object Object]`, or a distinct id under the trace spelling rather than the
 * log spelling — which produces records attached to nobody at all.
 */

type Emitted = {
  severityText?: string;
  severityNumber?: SeverityNumber;
  body?: unknown;
  timestamp?: number;
  attributes?: Record<string, unknown>;
};

const emitted: Emitted[] = [];

beforeEach(() => {
  emitted.length = 0;
  vi.spyOn(logs, 'getLogger').mockReturnValue({
    emit: (record: Emitted) => {
      emitted.push(record);
    },
  } as unknown as ReturnType<typeof logs.getLogger>);
});

/** A pino instance wired exactly as `logger.ts` wires the real one. */
function loggerWritingTo(stream: ReturnType<typeof createOtelLogStream>) {
  const REDACTED = ['access_token', 'refreshToken', 'client_secret'];
  return pino(
    {
      level: 'trace',
      redact: {
        paths: [...REDACTED, ...REDACTED.map((field) => `*.${field}`)],
        censor: '[redacted]',
      },
    },
    stream
  );
}

describe('createOtelLogStream', () => {
  it('emits a record for a log line', () => {
    const log = loggerWritingTo(createOtelLogStream());
    log.info({ name: 'chat' }, 'agent stream failed');

    expect(emitted).toHaveLength(1);
    expect(emitted[0].body).toBe('agent stream failed');
    expect(emitted[0].attributes?.['name']).toBe('chat');
  });

  /**
   * The one that matters. A token passed into a log call must already be
   * `[redacted]` by the time the bridge sees it — the ordering is the control,
   * not a convention anybody has to remember.
   */
  it('only ever sees values pino has already redacted', () => {
    const log = loggerWritingTo(createOtelLogStream());
    log.error(
      {
        access_token: 'Atza|REAL-SECRET',
        profile: { refreshToken: 'Atzr|ANOTHER-SECRET' },
      },
      'credential read failed'
    );

    const serialised = JSON.stringify(emitted[0]);
    expect(serialised).not.toContain('REAL-SECRET');
    expect(serialised).not.toContain('ANOTHER-SECRET');
    expect(emitted[0].attributes?.['access_token']).toBe('[redacted]');
  });

  it.each([
    ['fatal', 'FATAL', SeverityNumber.FATAL],
    ['error', 'ERROR', SeverityNumber.ERROR],
    ['warn', 'WARN', SeverityNumber.WARN],
    ['info', 'INFO', SeverityNumber.INFO],
    ['debug', 'DEBUG', SeverityNumber.DEBUG],
    ['trace', 'TRACE', SeverityNumber.TRACE],
  ] as const)('maps pino %s to OTel %s', (method, text, number) => {
    const log = loggerWritingTo(createOtelLogStream());
    log[method]('a message');

    expect(emitted[0].severityText).toBe(text);
    expect(emitted[0].severityNumber).toBe(number);
  });

  it('json-encodes structured values rather than dropping them', () => {
    const log = loggerWritingTo(createOtelLogStream());
    log.error({ error: { name: 'TypeError', message: 'boom' } }, 'failed');

    // OTel attributes are scalars; an object left as-is becomes useless.
    expect(emitted[0].attributes?.['error']).toBe(
      JSON.stringify({ name: 'TypeError', message: 'boom' })
    );
  });

  it('carries the user id under the LOG distinct-id attribute', () => {
    const log = loggerWritingTo(createOtelLogStream());
    log.info({ userId: 'auth0|abc' }, 'turn complete');

    // camelCase `posthogDistinctId`, NOT the `posthog.distinct_id` resource
    // attribute that traces use. The two are not interchangeable.
    expect(emitted[0].attributes?.['posthogDistinctId']).toBe('auth0|abc');
  });

  it('keeps trace correlation fields', () => {
    const stream = createOtelLogStream();
    stream.write(
      JSON.stringify({
        level: 50,
        time: 123,
        msg: 'boom',
        trace_id: 'abc123',
        span_id: 'def456',
      }) + '\n'
    );

    expect(emitted[0].attributes?.['trace_id']).toBe('abc123');
    expect(emitted[0].attributes?.['span_id']).toBe('def456');
  });

  it('drops per-instance noise', () => {
    const log = loggerWritingTo(createOtelLogStream());
    log.info('hello');

    // On Vercel these name an ephemeral lambda and appear on every record.
    expect(emitted[0].attributes).not.toHaveProperty('pid');
    expect(emitted[0].attributes).not.toHaveProperty('hostname');
  });

  it('handles several records arriving in one write', () => {
    const stream = createOtelLogStream();
    stream.write(
      [
        JSON.stringify({ level: 30, msg: 'first' }),
        JSON.stringify({ level: 30, msg: 'second' }),
        '',
      ].join('\n')
    );

    expect(emitted.map((record) => record.body)).toEqual(['first', 'second']);
  });

  it('survives a line that is not JSON', () => {
    const stream = createOtelLogStream();

    // Must not throw: this runs inside the request that was being logged.
    expect(() => stream.write('not json at all\n')).not.toThrow();
    expect(emitted).toHaveLength(0);
  });
});
