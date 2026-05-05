import { gateway, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type {
  AIProvider,
  AIProviderConfig,
  ImageGenerator,
  ModelTier,
} from './types.js';

const DEFAULT_MODELS: Record<ModelTier, string> = {
  default: 'anthropic/claude-sonnet-4.6',
  fast: 'anthropic/claude-haiku-4.5',
};

const DEFAULT_IMAGE_DRIVER_MODEL =
  process.env['IMAGE_DRIVER_MODEL'] || 'openai/gpt-5.4';

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

function aspectHint(size: string | undefined): string {
  switch (size) {
    case '1792x1024':
      return 'Render this as a 16:9 landscape image. ';
    case '1024x1792':
      return 'Render this as a 9:16 portrait image. ';
    case '1024x1024':
      return 'Render this as a 1:1 square image. ';
    default:
      return '';
  }
}

export function createAIProvider(config: AIProviderConfig = {}): AIProvider {
  const models = { ...DEFAULT_MODELS, ...config.models };
  const imageDriverModel = config.imageModelId ?? DEFAULT_IMAGE_DRIVER_MODEL;

  return {
    providerName: 'gateway',

    modelId(tier: ModelTier = 'default'): string {
      return models[tier];
    },

    languageModel(tier: ModelTier = 'default'): LanguageModel {
      return gateway(models[tier]);
    },

    imageGenerator(): ImageGenerator {
      return {
        async generate(params: Parameters<ImageGenerator['generate']>[0]) {
          const result = await generateText({
            model: imageDriverModel,
            prompt: `${aspectHint(params.size)}${params.prompt}`,
            tools: {
              image_generation: openai.tools.imageGeneration({
                outputFormat: 'png',
                quality: 'high',
              }),
            },
          });

          const generated: { url: string; mediaType: string }[] = [];
          for (const toolResult of result.staticToolResults) {
            if (toolResult.toolName !== 'image_generation') continue;
            const base64 = (toolResult.output as { result?: string })?.result;
            if (!base64) continue;
            const bytes = Buffer.from(base64, 'base64');
            const mediaType = 'image/png';
            generated.push({
              url: bytesToDataUrl(bytes, mediaType),
              mediaType,
            });
          }
          return generated;
        },
      };
    },
  };
}
