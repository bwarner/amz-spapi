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
import { resolveAmazonConnection } from '../../../lib/amazon-connections';

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
    return Response.json(
      { error: 'Invalid or empty request body' },
      { status: 400 }
    );
  }

  const { messages } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: 'messages array is required' },
      { status: 400 }
    );
  }

  const models = {
    ...(process.env['AI_DEFAULT_MODEL']
      ? { default: process.env['AI_DEFAULT_MODEL'] }
      : {}),
    ...(process.env['AI_FAST_MODEL']
      ? { fast: process.env['AI_FAST_MODEL'] }
      : {}),
  };

  const provider = createAIProvider({ models });

  const marketplaceId = process.env['SP_MARKETPLACE_ID'] || 'ATVPDKIKX0DER';

  // Try to load user's stored SP-API credentials from Couchbase
  // Fall back to env vars for development
  let clientId = process.env['LWA_CLIENT_ID'];
  let clientSecret = process.env['LWA_CLIENT_SECRET'];
  let refreshToken = process.env['LWA_REFRESH_TOKEN'];
  let userMarketplaceId = marketplaceId;

  // Debug logging
  console.log(
    '[chat] LWA_CLIENT_ID:',
    clientId ? clientId.substring(0, 30) + '...' : 'NOT SET'
  );
  console.log('[chat] LWA_CLIENT_SECRET:', clientSecret ? 'SET' : 'NOT SET');
  console.log(
    '[chat] LWA_REFRESH_TOKEN:',
    refreshToken ? 'SET (len:' + refreshToken.length + ')' : 'NOT SET'
  );

  try {
    const userId = session.user.sub;
    const resolved = await resolveAmazonConnection({
      apiType: 'SP_API',
      userId,
    });
    if (resolved.connected) {
      const { profile } = resolved.connection;
      clientId = profile.client_id;
      clientSecret = profile.client_secret;
      refreshToken = profile.refresh_token;
      userMarketplaceId = profile.marketplace_id || marketplaceId;
    }
  } catch {
    // Couchbase not available — fall back to env vars
  }

  // Create SP client and cache only if credentials are available
  // The agent will work without Amazon connection for basic conversations
  let spCache: SpCache | undefined;

  if (clientId && refreshToken) {
    console.log('[chat] Creating SpApiClient...');
    const spClient = new SpApiClient({
      clientId,
      clientSecret,
      refreshToken,
      marketplaceId: userMarketplaceId,
    });

    spCache = new SpCache({
      spClient,
      marketplaceId: userMarketplaceId,
    });
    console.log('[chat] SpCache created successfully');
  } else {
    console.log('[chat] No credentials - skipping SP client creation');
  }

  const imageGenerator = provider.imageGenerator?.();

  const agent = createSellerAgent({
    spCache,
    provider,
    imageGenerator,
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return errorMessage;
    },
  });

  return createUIMessageStreamResponse({ stream });
}
