import { gateway, generateImage } from 'ai';
import type { LanguageModel } from 'ai';
import type {
  AIProvider,
  AIProviderConfig,
  ImageGenerator,
  ImageModelVariant,
  ModelTier,
} from './types.js';

/**
 * Two tiers, and what each is for.
 *
 * `default` carries the seller agent, which orchestrates ~77 tools across
 * SP-API, Ads, harvest funnels and A+ content. Multi-step tool sequencing is
 * where smaller models come apart, and that agent IS the product — cheaper
 * turns that pick the wrong campaign are not a saving. So this tier is chosen
 * for capability and made cheaper by picking a better-priced model of the same
 * class, never by dropping a class.
 *
 * `fast` carries A+ generation and section regeneration: bounded, single-shot
 * writing tasks with a human reading every result.
 *
 * Sonnet 5 rather than Sonnet 4.6 because it is a LATER model at a LOWER price
 * — $2/$10 per Mtok against $3/$15, and $0.20 against $0.30 on cached input,
 * which matters most here because the agent's 50-70k token prefix is cached on
 * every turn. Roughly a third off the chat bill with no change of class.
 *
 * `AI_DEFAULT_MODEL` overrides this without a deploy, which is the rollback if
 * quality regresses.
 */
const DEFAULT_MODELS: Record<ModelTier, string> = {
  default: 'anthropic/claude-sonnet-5',
  fast: 'anthropic/claude-haiku-4.5',
};

/**
 * Embedding model for semantic search over stored documents.
 *
 * Its width is baked into the Search index, so CHANGING THIS INVALIDATES EVERY
 * STORED VECTOR: the index declares a fixed dimension, and a 3072-wide vector
 * queried against a 1536-wide index does not degrade gracefully, it fails.
 * Changing the model means a new index and a re-embed of the corpus — which is
 * why `embeddingModelId()` exists and each stored vector records the model that
 * produced it, rather than the width being assumed to be whatever is current.
 */
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

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
  const embeddingModelId =
    config.embeddingModelId ||
    process.env['AI_EMBEDDING_MODEL'] ||
    DEFAULT_EMBEDDING_MODEL;

  return {
    providerName: 'gateway',

    modelId(tier: ModelTier = 'default'): string {
      return models[tier];
    },

    languageModel(tier: ModelTier = 'default'): LanguageModel {
      return gateway(models[tier]);
    },

    embeddingModelId(): string {
      return embeddingModelId;
    },

    embeddingModel() {
      return gateway.textEmbeddingModel(embeddingModelId);
    },

    imageGenerator(
      variant: ImageModelVariant = DEFAULT_IMAGE_VARIANT
    ): ImageGenerator {
      const model =
        IMAGE_MODELS[variant] ?? IMAGE_MODELS[DEFAULT_IMAGE_VARIANT];
      return {
        modelSlug: model.slug,
        async generate(params: Parameters<ImageGenerator['generate']>[0]) {
          // Per-request quality wins over the model/env default; only the
          // size-based backend (gpt-image-1) honors it — others ignore it.
          const quality = params.quality ?? model.quality;
          // Reference-generate (image-to-image): only the size-based backend
          // (gpt-image-1) accepts image inputs; others get text-only.
          const references =
            model.sizing === 'size' && params.referenceImages?.length
              ? params.referenceImages
              : undefined;
          const { image } = await generateImage({
            model: model.slug,
            prompt: references
              ? { images: references, text: params.prompt }
              : params.prompt,
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
