import type { AIProvider, AIProviderConfig } from './types';
import { createBedrockProvider } from './bedrock-provider';
import { createAnthropicProvider } from './anthropic-provider';
import { createOpenAIProvider } from './openai-provider';

export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case 'bedrock':
      return createBedrockProvider(config);
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai':
      return createOpenAIProvider(config);
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}
