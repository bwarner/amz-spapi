import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModelV2, LanguageModelV2 } from '@ai-sdk/provider';
import type { AIProvider, AIProviderConfig, ModelTier } from './types';

const DEFAULT_MODELS: Record<ModelTier, string> = {
  default: 'gpt-4o',
  fast: 'gpt-4o-mini',
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export function createOpenAIProvider(config: AIProviderConfig): AIProvider {
  const models = { ...DEFAULT_MODELS, ...config.models };
  const embeddingModelId = config.embeddingModelId ?? DEFAULT_EMBEDDING_MODEL;

  const openaiProvider = createOpenAI({
    apiKey: config.apiKey,
    name: 'openai',
  });

  return {
    providerName: 'openai',

    modelId(tier: ModelTier = 'default'): string {
      return models[tier];
    },

    languageModel(tier: ModelTier = 'default'): LanguageModelV2 {
      return openaiProvider.languageModel(
        models[tier]
      ) as unknown as LanguageModelV2;
    },

    embeddingModel(): EmbeddingModelV2<string> {
      return openaiProvider.embeddingModel(
        embeddingModelId
      ) as unknown as EmbeddingModelV2<string>;
    },
  };
}
