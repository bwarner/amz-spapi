import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import {
  createSellerAgent,
  trimHistory,
  type SellerAssetStore,
} from '@amz-spapi/seller-agent';
import { createAIProvider } from '@amz-spapi/ai-provider';
import { SpApiClient } from '@farvisionllc/sp-client';
import { SpCache } from '@amz-spapi/sp-cache';
import { auth0 } from '../../../lib/auth0';
import { resolveAmazonConnection } from '../../../lib/amazon-connections';
import {
  loadAssetBytes,
  persistGeneratedImageAsset,
} from '../../../lib/media-assets';
import { createImageOps } from '../../../lib/image-ops';
import {
  getChatMeta,
  isValidChatId,
  saveChatTurn,
  type ChatUIMessage,
} from '../../../lib/chat-store';

const MANIFEST_IMAGE_PATTERN =
  /!\[(Photo [A-Z]{1,2})\]\(\/api\/a-plus\/assets\/([a-zA-Z0-9_-]+)/g;

/** Tool parts whose outputs carry labeled photos ({proposals} or {images}). */
const PHOTO_TOOL_PART_TYPES = new Set([
  'tool-propose-listing-photos',
  'tool-generate-image',
  'tool-crop-image',
  'tool-scale-image',
  'tool-remove-image-background',
  'tool-compose-image',
  'tool-generate-infographic',
]);

/**
 * Photo label → asset id mappings from the FULL transcript (attachment
 * manifests + photo tool outputs). Injected into the agent's instructions so
 * labels stay resolvable after history trimming drops their origin message.
 */
function collectPhotoRegistry(messages: UIMessage[]): Map<string, string> {
  const registry = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type === 'text') {
        const text = (part as { text?: string }).text ?? '';
        for (const match of text.matchAll(MANIFEST_IMAGE_PATTERN)) {
          registry.set(match[1], match[2]);
        }
        continue;
      }
      if (
        PHOTO_TOOL_PART_TYPES.has(part.type) &&
        (part as { state?: string }).state === 'output-available'
      ) {
        const output = (part as { output?: unknown }).output as {
          proposals?: Array<{ label?: string; assetId?: string }>;
          images?: Array<{ label?: string; assetId?: string }>;
        } | null;
        for (const entry of [
          ...(output?.proposals ?? []),
          ...(output?.images ?? []),
        ]) {
          if (entry?.label && entry.assetId) {
            registry.set(entry.label, entry.assetId);
          }
        }
      }
    }
  }
  return registry;
}

// Listing-photo proposals fan out several image generations (~15-30s each,
// run in parallel) on top of the agent's own steps.
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { id?: unknown; messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid or empty request body' },
      { status: 400 }
    );
  }

  const { messages } = body;
  const chatId = isValidChatId(body.id) ? body.id : undefined;

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
  let sellerId = process.env['SP_SELLER_ID'];
  let userMarketplaceId = marketplaceId;

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
      sellerId = profile.seller_id || sellerId;
      userMarketplaceId = profile.marketplace_id || marketplaceId;
    }
  } catch {
    // Couchbase not available — fall back to env vars
  }

  // Create SP client and cache only if credentials are available
  // The agent will work without Amazon connection for basic conversations
  let spCache: SpCache | undefined;

  if (clientId && refreshToken) {
    const spClient = new SpApiClient({
      clientId,
      clientSecret,
      refreshToken,
      sellerId,
      marketplaceId: userMarketplaceId,
    });

    spCache = new SpCache({
      spClient,
      sellerId,
      marketplaceId: userMarketplaceId,
    });
  }

  const imageGenerator = provider.imageGenerator?.();

  // Asset ids reaching these callbacks come from model tool calls — both
  // operations are scoped to the session user (ownership-checked reads,
  // owner-keyed writes).
  const chatUserId = session.user.sub;
  const assetStore: SellerAssetStore = {
    loadImageBytes: (assetId) =>
      loadAssetBytes({ userId: chatUserId, assetId }),
    saveGeneratedImage: async ({ dataUrl }) => {
      const asset = await persistGeneratedImageAsset({
        userId: chatUserId,
        dataUrl,
        feature: 'listings',
      });
      return {
        assetId: asset.assetId,
        url: `/api/a-plus/assets/${asset.assetId}`,
      };
    },
  };

  // Labels from the sent window, merged over the durable registry in the
  // conversation meta — so labels survive trimming, paging, AND message TTL.
  const scannedRegistry = collectPhotoRegistry(messages as UIMessage[]);
  let storedRegistry: Record<string, string> = {};
  if (chatId) {
    try {
      const meta = await getChatMeta({ userId: session.user.sub, chatId });
      storedRegistry = meta?.photoRegistry ?? {};
    } catch {
      // Meta unavailable — fall back to the scanned window.
    }
  }
  const photoRegistry = new Map<string, string>([
    ...Object.entries(storedRegistry),
    ...scannedRegistry.entries(),
  ]);
  const registryInstructions =
    photoRegistry.size > 0
      ? `PHOTO LABEL REGISTRY (every labeled photo in this conversation, ` +
        `including ones no longer visible in the trimmed history):\n${[
          ...photoRegistry.entries(),
        ]
          .map(([label, assetId]) => `- ${label} = ${assetId}`)
          .join('\n')}`
      : undefined;

  const agent = createSellerAgent({
    spCache,
    provider,
    imageGenerator,
    assetStore,
    imageOps: createImageOps(chatUserId),
    marketplaceId: userMarketplaceId,
    additionalInstructions: registryInstructions,
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
    // Client Stop (or a dropped connection) aborts the whole agent loop —
    // model calls and tool fan-outs included — instead of running to completion.
    result = await agent.stream({
      messages: modelMessages,
      abortSignal: request.signal,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return Response.json({ error: errorMessage }, { status: 500 });
  }

  const stream = createUIMessageStream({
    originalMessages: messages as UIMessage[],
    execute: async ({ writer }) => {
      writer.merge(result.toUIMessageStream());
    },
    onFinish: async ({ messages: updatedMessages }) => {
      if (!chatId) return;
      try {
        await saveChatTurn({
          userId: chatUserId,
          chatId,
          messages: updatedMessages as unknown as ChatUIMessage[],
          photoLabels: Object.fromEntries(
            collectPhotoRegistry(updatedMessages)
          ),
        });
      } catch {
        // Persistence is best-effort — never fail the response over it.
      }
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return errorMessage;
    },
  });

  return createUIMessageStreamResponse({ stream });
}
