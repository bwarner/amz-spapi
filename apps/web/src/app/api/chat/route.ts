import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { createSellerAgent, trimHistory } from '@amz-spapi/seller-agent';
import { createAIProvider } from '@amz-spapi/ai-provider';
import { SpApiClient } from '@farvisionllc/sp-client';
import { SpCache } from '@amz-spapi/sp-cache';
import { auth0 } from '../../../lib/auth0';
import { getCredentialStore } from '../../../lib/credential-store';

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  const { messages } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages array is required' }, { status: 400 });
  }

  const aiProvider =
    (process.env['AI_PROVIDER'] as 'bedrock' | 'anthropic' | 'openai') || 'anthropic';

  const provider = createAIProvider({
    provider: aiProvider,
    roleArn: process.env['AWS_BEDROCK_ROLE_ARN'],
    apiKey: process.env['OPENAI_API_KEY'],
  });

  const marketplaceId = process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  // Try to load user's stored SP-API credentials from Couchbase
  // Fall back to env vars for development
  let clientId = process.env['LWA_CLIENT_ID']!;
  let clientSecret = process.env['LWA_CLIENT_SECRET'];
  let refreshToken = process.env['LWA_REFRESH_TOKEN'];
  let userMarketplaceId = marketplaceId;

  try {
    const credStore = getCredentialStore();
    const profile = await credStore.getProfile('default', 'SP_API', session.user.sub);
    if (profile && profile.refresh_token && !('deleted' in profile)) {
      clientId = profile.client_id;
      clientSecret = profile.client_secret;
      refreshToken = profile.refresh_token;
      userMarketplaceId = profile.marketplace_id || marketplaceId;
    }
  } catch {
    // Couchbase not available — fall back to env vars
  }

  if (!clientId || !refreshToken) {
    return Response.json({
      error: 'No Amazon account connected. Please go to Settings to connect your Amazon Seller account.',
    }, { status: 400 });
  }

  const spClient = new SpApiClient({
    clientId,
    clientSecret,
    refreshToken,
    marketplaceId: userMarketplaceId,
  });

  const spCache = new SpCache({
    spClient,
    marketplaceId: userMarketplaceId,
  });

  const agent = createSellerAgent({
    spCache,
    provider,
    marketplaceId: userMarketplaceId,
  });

  const trimmedMessages = trimHistory(messages as UIMessage[], {
    maxMessages: 20,
    minRecentMessages: 10,
  });

  const modelMessages = await convertToModelMessages(trimmedMessages, {
    ignoreIncompleteToolCalls: true,
  });

  let result;
  try {
    result = await agent.stream({ messages: modelMessages });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return Response.json({ error: errorMessage }, { status: 500 });
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.merge(result.toUIMessageStream());
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorMessage;
    },
  });

  return createUIMessageStreamResponse({ stream });
}
