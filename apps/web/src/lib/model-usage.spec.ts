import { describe, expect, it } from 'vitest';
import { costOfUsage, pricesFor } from './model-usage';

/**
 * Token pricing, where every failure is silent.
 *
 * A wrong rate does not throw — it produces a number that looks like money and
 * is not, and nobody notices until the gateway invoice disagrees. The two that
 * matter most are double-charging cached tokens and pricing an unknown model at
 * zero.
 */

describe('pricesFor', () => {
  it('matches a gateway-prefixed, version-suffixed model id', () => {
    // Ids arrive as `anthropic/claude-sonnet-4.6`, never bare.
    const prices = pricesFor('anthropic/claude-sonnet-4.6');

    expect(prices.known).toBe(true);
    expect(prices.input).toBe(3);
    expect(prices.output).toBe(15);
  });

  /**
   * The models the app can actually select.
   *
   * The bug this exists to prevent: the first table keyed on hyphenated version
   * numbers (`claude-sonnet-4-5`) while the provider ids use dots
   * (`claude-sonnet-4.6`). Nothing matched, every turn priced at the default
   * with `priceKnown: false`, and the ledger under-reported for as long as it
   * took someone to notice. The original test asserted a model id that appears
   * nowhere in the app — it checked the table against itself.
   *
   * Image models are excluded: they are billed per image by `cost-ledger`, not
   * per token.
   */
  const SELECTABLE_TEXT_MODELS = [
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-haiku-4.5',
    'anthropic/claude-opus-4.8',
    'openai/gpt-5.5',
    'openai/gpt-5.4',
    'openai/gpt-5.4-mini',
  ];

  it.each(SELECTABLE_TEXT_MODELS)('prices %s as a known model', (modelId) => {
    expect(pricesFor(modelId).known).toBe(true);
  });

  it('does not silently price a dotted id as unknown', () => {
    // The exact failure mode: a dot/hyphen mismatch does not throw, it just
    // quietly bills at the fallback rate.
    expect(pricesFor('anthropic/claude-sonnet-4.6').known).toBe(true);
    expect(pricesFor('anthropic/claude-sonnet-4-6').known).toBe(false);
  });

  it('prefers the longest match, so a mini is not priced as its parent', () => {
    const mini = pricesFor('openai/gpt-5.2-mini');
    const full = pricesFor('openai/gpt-5.2');

    expect(mini.input).toBeLessThan(full.input);
  });

  it('falls back for an unknown model, and says the price is unknown', () => {
    const prices = pricesFor('someone/brand-new-model');

    expect(prices.known).toBe(false);
    expect(prices.input).toBeGreaterThan(0);
  });
});

describe('costOfUsage', () => {
  it('does not charge full rate for tokens that were cache reads', () => {
    // Cached tokens are reported INSIDE inputTokens. Charging both rates on the
    // same tokens would roughly double the input cost of a long conversation —
    // exactly where caching is supposed to save money.
    const { costUsd, billedInputTokens } = costOfUsage(
      'anthropic/claude-sonnet-4-5',
      { inputTokens: 100_000, cachedInputTokens: 90_000, outputTokens: 0 }
    );

    expect(billedInputTokens).toBe(10_000);
    // 10k uncached at $3/Mtok + 90k cached at $0.30/Mtok.
    expect(costUsd).toBeCloseTo(0.03 + 0.027, 6);
  });

  it('costs a fully cached prompt far less than an uncached one', () => {
    const cached = costOfUsage('anthropic/claude-sonnet-4-5', {
      inputTokens: 100_000,
      cachedInputTokens: 100_000,
    });
    const cold = costOfUsage('anthropic/claude-sonnet-4-5', {
      inputTokens: 100_000,
      cachedInputTokens: 0,
    });

    expect(cached.costUsd).toBeLessThan(cold.costUsd / 5);
  });

  it('never bills negative input when cached exceeds the reported total', () => {
    const { billedInputTokens, costUsd } = costOfUsage('x', {
      inputTokens: 10,
      cachedInputTokens: 50,
    });

    expect(billedInputTokens).toBe(0);
    expect(costUsd).toBeGreaterThanOrEqual(0);
  });

  it('charges output at the higher rate', () => {
    const output = costOfUsage('anthropic/claude-sonnet-4-5', {
      outputTokens: 1_000_000,
    });
    const input = costOfUsage('anthropic/claude-sonnet-4-5', {
      inputTokens: 1_000_000,
    });

    expect(output.costUsd).toBeGreaterThan(input.costUsd);
    expect(output.costUsd).toBeCloseTo(15, 6);
  });

  it('prices an unknown model above zero', () => {
    // Zero would make adding a model silently stop the ledger reporting it,
    // which is the failure mode this whole change exists to end.
    const { costUsd, priceKnown } = costOfUsage('someone/unknown', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(priceKnown).toBe(false);
    expect(costUsd).toBeGreaterThan(0);
  });
});
