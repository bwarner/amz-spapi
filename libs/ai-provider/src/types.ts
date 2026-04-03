export type ModelTier = 'default' | 'fast';

export interface AIProviderConfig {
  provider: 'bedrock' | 'anthropic' | 'openai';
  roleArn?: string;
  apiKey?: string;
  openaiApiKey?: string; // For DALL-E image generation
  models?: Partial<Record<ModelTier, string>>;
  embeddingModelId?: string;
  imageModelId?: string;
}

export interface ImageGenerator {
  generate(params: {
    prompt: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    style?: 'natural' | 'vivid';
    n?: number;
  }): Promise<{ url: string; revisedPrompt?: string }[]>;

  edit?(params: {
    image: Buffer | string; // Base64 or file path
    prompt: string;
    mask?: Buffer | string;
    size?: '1024x1024';
    n?: number;
  }): Promise<{ url: string }[]>;
}

export interface AIProvider {
  languageModel(tier?: ModelTier): import('@ai-sdk/provider').LanguageModelV2;
  embeddingModel?(): import('@ai-sdk/provider').EmbeddingModelV2<string>;
  imageGenerator?(): ImageGenerator;
  readonly providerName: string;
  modelId(tier?: ModelTier): string;
}
