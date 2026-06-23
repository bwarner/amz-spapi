import { gateway, generateImage } from 'ai';
import type { LanguageModel } from 'ai';
import type {
  AIProvider,
  AIProviderConfig,
  ImageGenerator,
  ImageModelVariant,
  ModelTier,
} from './types.js';

const DEFAULT_MODELS: Record<ModelTier, string> = {
  default: 'anthropic/claude-sonnet-4.6',
  fast: 'anthropic/claude-haiku-4.5',
};

type AppImageSize = NonNullable<
  Parameters<ImageGenerator['generate']>[0]['size']
>;

/**
 * A/B-switchable image backends. All are gateway "image"-type models driven by
 * the AI SDK's `generateImage` (a dedicated image call — ~8-12s), NOT the old
 * reasoning-model-plus-tool path which took ~190s and blew past route timeouts.
 *
 * `sizing` picks how the requested size is expressed to each model:
 *  - 'size'        → exact pixel sizes (gpt-image-1)
 *  - 'aspectRatio' → ratio strings (Imagen, Grok)
 * The default variant is gpt-image-1; a request can override via PostHog flag.
 */
type ImageModelDef = {
  slug: string;
  sizing: 'size' | 'aspectRatio';
  quality?: 'low' | 'medium' | 'high';
};

const IMAGE_MODELS: Record<ImageModelVariant, ImageModelDef> = {
  openai: {
    slug: process.env['A_PLUS_IMAGE_MODEL_OPENAI'] || 'openai/gpt-image-1',
    sizing: 'size',
    quality:
      (process.env['A_PLUS_IMAGE_QUALITY'] as ImageModelDef['quality']) ||
      'medium',
  },
  google: {
    slug:
      process.env['A_PLUS_IMAGE_MODEL_GOOGLE'] ||
      'google/imagen-4.0-generate-001',
    sizing: 'aspectRatio',
  },
  grok: {
    slug: process.env['A_PLUS_IMAGE_MODEL_GROK'] || 'xai/grok-imagine-image',
    sizing: 'aspectRatio',
  },
};

const DEFAULT_IMAGE_VARIANT: ImageModelVariant =
  (process.env['A_PLUS_IMAGE_VARIANT'] as ImageModelVariant) || 'openai';

/** Map our app image size to gpt-image-1's supported exact sizes. */
function toExactSize(size: AppImageSize | undefined): string {
  switch (size) {
    case '1792x1024':
      return '1536x1024';
    case '1024x1792':
      return '1024x1536';
    default:
      return '1024x1024';
  }
}

/** Map our app image size to an aspect-ratio string (Imagen/Grok). */
function toAspectRatio(size: AppImageSize | undefined): string {
  switch (size) {
    case '1792x1024':
      return '16:9';
    case '1024x1792':
      return '9:16';
    default:
      return '1:1';
  }
}

export function createAIProvider(config: AIProviderConfig = {}): AIProvider {
  const models = { ...DEFAULT_MODELS, ...config.models };

  return {
    providerName: 'gateway',

    modelId(tier: ModelTier = 'default'): string {
      return models[tier];
    },

    languageModel(tier: ModelTier = 'default'): LanguageModel {
      return gateway(models[tier]);
    },

    imageGenerator(
      variant: ImageModelVariant = DEFAULT_IMAGE_VARIANT
    ): ImageGenerator {
      const model =
        IMAGE_MODELS[variant] ?? IMAGE_MODELS[DEFAULT_IMAGE_VARIANT];
      return {
        async generate(params: Parameters<ImageGenerator['generate']>[0]) {
          // Per-request quality wins over the model/env default; only the
          // size-based backend (gpt-image-1) honors it — others ignore it.
          const quality = params.quality ?? model.quality;
          const { image } = await generateImage({
            model: model.slug,
            prompt: params.prompt,
            ...(model.sizing === 'size'
              ? { size: toExactSize(params.size) as `${number}x${number}` }
              : {
                  aspectRatio: toAspectRatio(
                    params.size
                  ) as `${number}:${number}`,
                }),
            ...(quality && model.sizing === 'size'
              ? { providerOptions: { openai: { quality } } }
              : {}),
          });
          return [
            {
              url: `data:${image.mediaType};base64,${image.base64}`,
              mediaType: image.mediaType,
            },
          ];
        },
      };
    },
  };
}
