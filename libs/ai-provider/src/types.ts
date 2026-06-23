import type { LanguageModel } from 'ai';

export type ModelTier = 'default' | 'fast';

/**
 * A/B-switchable image backends. Each maps to a concrete gateway image model in
 * create-provider; the active variant is chosen per request (e.g. from a PostHog
 * feature flag) so we can compare quality/cost/latency without code changes.
 */
export type ImageModelVariant = 'openai' | 'google' | 'grok';

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
    /**
     * Cost/quality tier — 'low' for cheap drafts, 'high' for finals. Only
     * applied by backends that support it (e.g. gpt-image-1); ignored otherwise.
     * Falls back to the provider/env default when omitted.
     */
    quality?: 'low' | 'medium' | 'high';
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
  imageGenerator?(variant?: ImageModelVariant): ImageGenerator;
  readonly providerName: string;
  modelId(tier?: ModelTier): string;
}
