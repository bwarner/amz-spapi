import { registerOTel } from '@vercel/otel';

// Loaded once per server runtime (Node + Edge) by Next.js before any request.
// Traces export via OTLP: on Vercel they flow to any connected observability
// integration/drain; locally they no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is
// set (e.g. a local collector on :4318).
export function register() {
  registerOTel({ serviceName: 'sellavant-web' });
}
