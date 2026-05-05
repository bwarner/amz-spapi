import type { LanguageModel } from 'ai';

export type ModelTier = 'default' | 'fast';

export interface AIProviderConfig {
  models?: Partial<Record<ModelTier, string>>;
  imageModelId?: string;
  embeddingModelId?: string;
}

export interface ImageGenerator {
  generate(params: {
    prompt: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    n?: number;
  }): Promise<
    {
      url: string;
      mediaType: string;
      revisedPrompt?: string;
    }[]
  >;
}

export interface AIProvider {
  languageModel(tier?: ModelTier): LanguageModel;
  embeddingModel?(): import('@ai-sdk/provider').EmbeddingModelV2<string>;
  imageGenerator?(): ImageGenerator;
  readonly providerName: string;
  modelId(tier?: ModelTier): string;
}
