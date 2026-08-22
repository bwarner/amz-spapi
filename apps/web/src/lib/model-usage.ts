import { recordCost, userRef } from './cost-ledger';
import { captureServerEvent } from './posthog-server';

/**
 * Record what a model turn cost (#74-adjacent).
 *
 * The gap this fills: `ops.cost_ledger` recorded scraper runs and image
 * generation, but not model tokens — those are billed by the AI Gateway and
 * appeared nowhere on our side. So the first sign of a heavy month was the
 * gateway balance running out, with no per-turn record to look at afterwards.
 *
 * Tokens are billed per million and vary by model, so this cannot reuse the
 * per-call price table. Same principles though: prices are a dated list, the
 * figure is `estimated` and never `measured`, the vendor invoice is the
 * authority, and every rate is overridable by env so a price change is not a
 * code change.
 */

/** Per MILLION tokens, USD. Verified 2026-08-01 against published list prices. */
const MODEL_PRICES_PER_MTOK: Record<
  string,
  { input: number; output: number; cachedInput: number }
> = {
  // Keyed on the ids the app actually selects. The first version of this table
  // used hyphenated version numbers (`claude-sonnet-4-5`) while the provider
  // ids use dots (`claude-sonnet-4.6`), so NOTHING matched and every turn was
  // priced at the default with `priceKnown: false`. The table was self
  // consistent and disagreed with reality — see `pricesEveryModel` in the spec,
  // which now derives its cases from the model registry instead of restating
  // the keys here.
  // Verified 2026-08-22 against the gateway's own /v1/models pricing, which is
  // the authority — this table is a copy and drifts.
  'claude-sonnet-5': { input: 2, output: 10, cachedInput: 0.2 },
  'claude-sonnet-4.6': { input: 3, output: 15, cachedInput: 0.3 },
  'claude-haiku-4.5': { input: 1, output: 5, cachedInput: 0.1 },
  'claude-opus-4.8': { input: 5, output: 25, cachedInput: 0.5 },
  'gpt-5.5': { input: 1.25, output: 10, cachedInput: 0.125 },
  'gpt-5.4': { input: 1.25, output: 10, cachedInput: 0.125 },
  'gpt-5.4-mini': { input: 0.25, output: 2, cachedInput: 0.025 },
  'gpt-5.2': { input: 1.25, output: 10, cachedInput: 0.125 },
  'gpt-5.2-mini': { input: 0.25, output: 2, cachedInput: 0.025 },
};

/**
 * What an unknown model is assumed to cost.
 *
 * Deliberately not zero, for the same reason `defaultCallCostUsd` is not: a
 * turn we cannot price must still show up as spend, or adding a model silently
 * makes the ledger under-report. Set at roughly mid-market so the error is
 * visible rather than convenient.
 */
const DEFAULT_PRICE_PER_MTOK = { input: 3, output: 15, cachedInput: 0.3 };

function envRate(modelId: string, kind: string): number | undefined {
  const slug = modelId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  const raw = process.env[`COST_${kind}_PER_MTOK_${slug}`];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Prices for a model id, which arrives gateway-prefixed (`anthropic/claude-…`)
 * and often version-suffixed. Matched on the longest known key it contains, so
 * a dated build of a known model still prices correctly instead of silently
 * falling back to the default.
 */
/**
 * Dots and hyphens are the same separator. The table keys use the gateway's
 * dotted ids (`claude-sonnet-4.6`); the RESPONSE reports Anthropic's own
 * hyphenated id (`claude-sonnet-4-6`), and that response id is what gets
 * recorded — so an exact-substring match misses every Anthropic turn and
 * silently prices it at the default. Seen live: seven turns, all
 * `priceKnown: false`, for a model whose price was in the table the whole
 * time.
 */
function normalizeModelId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function pricesFor(modelId: string): {
  input: number;
  output: number;
  cachedInput: number;
  known: boolean;
} {
  const normalized = normalizeModelId(modelId);
  const match = Object.keys(MODEL_PRICES_PER_MTOK)
    .filter((key) => normalized.includes(normalizeModelId(key)))
    .sort((a, b) => b.length - a.length)[0];

  const base = match ? MODEL_PRICES_PER_MTOK[match] : DEFAULT_PRICE_PER_MTOK;
  return {
    input: envRate(modelId, 'INPUT') ?? base.input,
    output: envRate(modelId, 'OUTPUT') ?? base.output,
    cachedInput: envRate(modelId, 'CACHED_INPUT') ?? base.cachedInput,
    known: Boolean(match),
  };
}

/** What the AI SDK reports; every field can be undefined. */
export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export function costOfUsage(
  modelId: string,
  usage: ModelUsage
): { costUsd: number; priceKnown: boolean; billedInputTokens: number } {
  const prices = pricesFor(modelId);
  const cached = usage.cachedInputTokens ?? 0;
  // Cached tokens are reported INSIDE inputTokens, so charging both rates on
  // the same tokens would roughly double the input cost of a long
  // conversation — which is exactly where caching is meant to save money.
  const billedInputTokens = Math.max((usage.inputTokens ?? 0) - cached, 0);
  const output = usage.outputTokens ?? 0;

  const costUsd =
    (billedInputTokens * prices.input) / 1_000_000 +
    (cached * prices.cachedInput) / 1_000_000 +
    (output * prices.output) / 1_000_000;

  return { costUsd, priceKnown: prices.known, billedInputTokens };
}

/**
 * Write a model turn to the ledger and to PostHog.
 *
 * Both, because they answer different questions: the ledger reconciles against
 * the gateway invoice and feeds the daily cap, while PostHog answers which
 * features and which sellers are actually driving the spend. Neither is allowed
 * to fail the request.
 */
export async function recordModelUsage(params: {
  userId: string;
  feature: string;
  modelId: string;
  usage: ModelUsage;
  chatId?: string;
  /** Agent loop steps, so an expensive turn can be told from a long one. */
  steps?: number;
}): Promise<void> {
  const { userId, feature, modelId, usage, chatId } = params;

  const totalTokens =
    usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (!totalTokens) return;

  const { costUsd, priceKnown, billedInputTokens } = costOfUsage(
    modelId,
    usage
  );

  await Promise.allSettled([
    recordCost({
      userId,
      feature,
      vendor: 'llm',
      operation: modelId,
      units: totalTokens,
      costUsd,
      // Token counts come from the provider; the PRICES are a list we keep, so
      // the product of the two is an estimate.
      costSource: 'estimated',
      priceKnown,
      chatId,
      // The breakdown, not just the total: 900k cached tokens and 180k
      // uncached ones cost the same, and only these fields say which a turn
      // was — the difference between "long conversation, cache working" and
      // "cache miss, money burning".
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      steps: params.steps,
    }),
    captureServerEvent({
      // The SAME id the browser identifies with — `posthog.identify(
      // session.user.sub, …)` in `PostHogProvider`. This used to be
      // `userRef(userId)`, a hash, which produced a second PostHog person that
      // `identify` never merged with: AI usage could not be joined to the
      // account that incurred it, or to any funnel, and the split was invisible
      // because both populations looked plausible on their own.
      //
      // The hash bought no privacy here. `identify` already attaches the user's
      // EMAIL, so PostHog holds a far more direct identifier than the Auth0
      // subject either way.
      distinctId: userId,
      event: 'ai_model_turn',
      properties: {
        feature,
        model: modelId,
        // Kept as a PROPERTY, which is what the original comment was really
        // after: `ops.cost_ledger` and the OTel spans key on this hash, so
        // spend still joins across all three without the ledger having to
        // carry an Auth0 id.
        user_ref: userRef(userId),
        input_tokens: usage.inputTokens ?? 0,
        billed_input_tokens: billedInputTokens,
        cached_input_tokens: usage.cachedInputTokens ?? 0,
        output_tokens: usage.outputTokens ?? 0,
        reasoning_tokens: usage.reasoningTokens ?? 0,
        total_tokens: totalTokens,
        cost_usd: Number(costUsd.toFixed(6)),
        price_known: priceKnown,
        steps: params.steps,
        chat_id: chatId,
      },
    }),
  ]);
}
