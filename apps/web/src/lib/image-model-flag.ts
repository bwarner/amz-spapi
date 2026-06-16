import { PostHog } from 'posthog-node';
import type { ImageModelVariant } from '@amz-spapi/ai-provider';

/**
 * A/B switch for the A+ image backend. Driven by the PostHog multivariate flag
 * `aplus-image-model` with variants: `openai` (default), `google`, `grok`.
 *
 * Resolution is best-effort: if PostHog is not configured (no POSTHOG_KEY) or
 * the lookup fails, we fall back to `openai` so image generation never breaks on
 * a flag problem.
 */
export const IMAGE_MODEL_FLAG = 'aplus-image-model';

const VALID_VARIANTS: readonly ImageModelVariant[] = [
  'openai',
  'google',
  'grok',
];

// Module-scope singleton — reused across warm serverless invocations / the dev
// server. `undefined` = not yet initialized, `null` = PostHog not configured.
let client: PostHog | null | undefined;

function getClient(): PostHog | null {
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
    // We only read flags here; keep the client from buffering analytics events.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * Resolve which image backend to use for a given user (Auth0 `sub` as the
 * PostHog distinct id). Returns `openai` when unconfigured/unknown.
 */
export async function resolveImageModelVariant(
  distinctId: string
): Promise<ImageModelVariant> {
  // Dev/local override — takes precedence over the PostHog flag.
  const override = process.env['A_PLUS_IMAGE_VARIANT'];
  if (override && (VALID_VARIANTS as readonly string[]).includes(override)) {
    return override as ImageModelVariant;
  }
  const ph = getClient();
  if (!ph) return 'openai';
  try {
    const value = await ph.getFeatureFlag(IMAGE_MODEL_FLAG, distinctId);
    if (
      typeof value === 'string' &&
      (VALID_VARIANTS as readonly string[]).includes(value)
    ) {
      return value as ImageModelVariant;
    }
  } catch {
    // Flag service unavailable — fall through to the safe default.
  }
  return 'openai';
}

/**
 * A/B switch for how the generator writes modules. PostHog flag
 * `aplus-generation-mode` with variants: `single` (one LLM call writes the whole
 * package — default) or `parallel` (one call per module, run concurrently).
 */
export const GENERATION_MODE_FLAG = 'aplus-generation-mode';
export type AplusGenerationMode = 'single' | 'parallel';

export async function resolveAplusGenerationMode(
  distinctId: string
): Promise<AplusGenerationMode> {
  // Dev/local override — takes precedence over the PostHog flag.
  const override = process.env['A_PLUS_GENERATION_MODE'];
  if (override === 'single' || override === 'parallel') return override;
  const ph = getClient();
  if (!ph) return 'single';
  try {
    const value = await ph.getFeatureFlag(GENERATION_MODE_FLAG, distinctId);
    if (value === 'single' || value === 'parallel') return value;
  } catch {
    // Flag service unavailable — fall through to the safe default.
  }
  return 'single';
}
