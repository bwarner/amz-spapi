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
  /** Resolved backend model slug (e.g. "openai/gpt-image-1") — ground truth
   * for anything user-facing, so the agent never guesses its own backend. */
  readonly modelSlug?: string;
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
    /**
     * Reference photos of the REAL product (image-to-image). Backends that
     * support image inputs (gpt-image-1) generate the scene with THIS exact
     * product; others ignore them and fall back to text-only.
     */
    referenceImages?: Uint8Array[];
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
  /**
   * Text embedding model, for semantic search over stored documents.
   *
   * Typed V3, not V2: the gateway returns `EmbeddingModelV3`, and while this
   * said V2 the method could not be implemented without a cast — which is why
   * it stayed unimplemented. Both types are still exported by
   * `@ai-sdk/provider`, so the mismatch raised no error anywhere; it just left
   * a declared capability that silently did not exist.
   */
  embeddingModel?(): import('@ai-sdk/provider').EmbeddingModelV3;
  /** Resolved embedding model slug, so stored vectors can record their origin. */
  embeddingModelId?(): string;
  imageGenerator?(variant?: ImageModelVariant): ImageGenerator;
  readonly providerName: string;
  modelId(tier?: ModelTier): string;
}
