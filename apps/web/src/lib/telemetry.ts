import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

/**
 * Thin OTel span helper for metered vendor calls.
 *
 * Complements the cost ledger rather than replacing it: spans are sampled and
 * short-retention, so they answer "why was this turn slow and expensive" in the
 * same waterfall as the request, while the ledger in Couchbase stays the system
 * of record for money. A tracer provider is registered in instrumentation.ts;
 * with no provider (local dev, tests) these calls are no-ops.
 *
 * Attribute naming: OTel semantic conventions have nothing for vendor spend, so
 * cost attributes live under a `sellavant.` prefix. LLM usage is already emitted
 * as `gen_ai.*` by the AI SDK — don't duplicate it here.
 */

const tracer = trace.getTracer('sellavant.cost');

export type VendorSpanAttributes = {
  vendor: string;
  operation: string;
  feature?: string;
  /** Hash or opaque id — never an email or raw PII. */
  userRef?: string;
  chatId?: string;
};

export type VendorSpanOutcome = {
  units?: number;
  costUsd?: number;
  costSource?: 'measured' | 'estimated';
  cacheHit?: boolean;
};

function toAttributes(
  attrs: VendorSpanAttributes,
  outcome?: VendorSpanOutcome
): Attributes {
  return {
    'sellavant.vendor': attrs.vendor,
    'sellavant.vendor.operation': attrs.operation,
    ...(attrs.feature ? { 'sellavant.feature': attrs.feature } : {}),
    ...(attrs.userRef ? { 'sellavant.user.ref': attrs.userRef } : {}),
    ...(attrs.chatId ? { 'sellavant.chat.id': attrs.chatId } : {}),
    ...(outcome?.units !== undefined
      ? { 'sellavant.units': outcome.units }
      : {}),
    ...(outcome?.costUsd !== undefined
      ? { 'sellavant.cost.usd': outcome.costUsd }
      : {}),
    ...(outcome?.costSource
      ? { 'sellavant.cost.source': outcome.costSource }
      : {}),
    ...(outcome?.cacheHit !== undefined
      ? { 'sellavant.cache.hit': outcome.cacheHit }
      : {}),
  };
}

/**
 * Run `fn` inside a span. `fn` reports what the call actually consumed via the
 * `report` callback, so cost lands on the span even when the call throws
 * partway (a failed actor run still bills).
 */
export async function withVendorSpan<T>(
  attrs: VendorSpanAttributes,
  fn: (report: (outcome: VendorSpanOutcome) => void) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    `${attrs.vendor}.${attrs.operation}`,
    { attributes: toAttributes(attrs) },
    async (span) => {
      let reported: VendorSpanOutcome | undefined;
      try {
        const result = await fn((outcome) => {
          reported = { ...reported, ...outcome };
          span.setAttributes(toAttributes(attrs, reported));
        });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message:
            error instanceof Error ? error.message : 'vendor call failed',
        });
        if (error instanceof Error) span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
}
