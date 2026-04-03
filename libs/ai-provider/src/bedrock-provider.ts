import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { EmbeddingModelV2, LanguageModelV2 } from '@ai-sdk/provider';
import type {
  AIProvider,
  AIProviderConfig,
  ImageGenerator,
  ModelTier,
} from './types';
import { createDalleImageGenerator } from './dalle-image-generator';

const DEFAULT_MODELS: Record<ModelTier, string> = {
  default: 'us.anthropic.claude-sonnet-4-6',
  fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
};

const DEFAULT_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const DEFAULT_IMAGE_MODEL = 'amazon.nova-canvas-v1:0';

/**
 * Direct Bedrock provider.
 *
 * Two credential modes:
 * 1. OIDC (Vercel production/preview): roleArn + VERCEL env.
 * 2. Default credential chain (local dev): SSO profiles, env vars, etc.
 */
export function createBedrockProvider(config: AIProviderConfig): AIProvider {
  const models = { ...DEFAULT_MODELS, ...config.models };
  const embeddingModelId = config.embeddingModelId ?? DEFAULT_EMBEDDING_MODEL;
  const useOidc = Boolean(config.roleArn && process.env['VERCEL']);

  // Use DALL-E for image generation if OpenAI key is available
  const openaiKey = config.openaiApiKey || process.env['OPENAI_API_KEY'];
  let imageGen: ImageGenerator | undefined;
  if (openaiKey) {
    imageGen = createDalleImageGenerator(openaiKey);
  }

  let bedrockInstance: ReturnType<typeof createAmazonBedrock> | null = null;

  function getBedrock() {
    if (!bedrockInstance) {
      if (useOidc) {
        const {
          awsCredentialsProvider,
        } = require('@vercel/oidc-aws-credentials-provider');
        bedrockInstance = createAmazonBedrock({
          region: 'us-east-1',
          credentialProvider: awsCredentialsProvider({
            roleArn: config.roleArn!,
          }),
        });
      } else {
        const {
          defaultProvider,
        } = require('@aws-sdk/credential-provider-node');
        const provider = defaultProvider();
        bedrockInstance = createAmazonBedrock({
          region: 'us-east-1',
          credentialProvider: () => provider(),
        });
      }
    }
    return bedrockInstance;
  }

  return {
    providerName: 'bedrock',

    modelId(tier: ModelTier = 'default'): string {
      return models[tier];
    },

    languageModel(tier: ModelTier = 'default'): LanguageModelV2 {
      return getBedrock().languageModel(
        models[tier]
      ) as unknown as LanguageModelV2;
    },

    embeddingModel(): EmbeddingModelV2<string> {
      return getBedrock().embeddingModel(
        embeddingModelId
      ) as unknown as EmbeddingModelV2<string>;
    },

    imageGenerator(): ImageGenerator | undefined {
      return imageGen;
    },
  };
}
