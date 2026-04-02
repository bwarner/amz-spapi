export type ModelTier = 'default' | 'fast';

export interface AIProviderConfig {
  provider: 'bedrock' | 'anthropic' | 'openai';
  roleArn?: string;
  apiKey?: string;
  models?: Partial<Record<ModelTier, string>>;
  embeddingModelId?: string;
}

export interface AIProvider {
  languageModel(tier?: ModelTier): import('@ai-sdk/provider').LanguageModelV2;
  embeddingModel?(): import('@ai-sdk/provider').EmbeddingModelV2<string>;
  readonly providerName: string;
  modelId(tier?: ModelTier): string;
}
