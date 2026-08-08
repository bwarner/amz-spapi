import { registerOTel } from '@vercel/otel';

// Loaded once per server runtime (Node + Edge) by Next.js before any request.
// Traces export via OTLP: on Vercel they flow to any connected observability
// integration/drain; locally they no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is
// set (e.g. a local collector on :4318).
export async function register() {
  registerOTel({ serviceName: 'sellavant-web' });

  // Logs go to PostHog over OTLP, separately from traces — PostHog ingests
  // logs but not OTLP metrics, and `@vercel/otel` does not wire the logs SDK.
  //
  // Node only. The logs SDK is not edge-compatible, and the dynamic import
  // keeps it out of the edge bundle entirely rather than relying on a
  // never-taken branch surviving tree-shaking. `middleware.ts` is the only edge
  // entry point here, and it does not log.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initLogs } = await import('./lib/otel-logs');
    initLogs();
  }
}
