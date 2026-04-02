import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import type { AIProvider, AIProviderConfig, ModelTier } from './types';

const DEFAULT_MODELS: Record<ModelTier, string> = {
  default: 'claude-sonnet-4-20250514',
  fast: 'claude-3-5-haiku-20241022'
};

export function createAnthropicProvider(config: AIProviderConfig): AIProvider {
  const models = { ...DEFAULT_MODELS, ...config.models };

  const anthropicProvider = createAnthropic({
    name: 'anthropic'
  });

  return {
    providerName: 'anthropic',

    modelId(tier: ModelTier = 'default'): string {
      return models[tier];
    },

    languageModel(tier: ModelTier = 'default'): LanguageModelV2 {
      return anthropicProvider.languageModel(models[tier]) as unknown as LanguageModelV2;
    },

    embeddingModel() {
      throw new Error(
        'Anthropic does not support embedding models. Use Bedrock or OpenAI instead.'
      );
    }
  };
}
