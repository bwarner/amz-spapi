import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import {
  createSellerAgent,
  dropStaleToolImages,
  trimHistory,
  type SellerAssetStore,
  type SellerListingWrites,
} from '@amz-spapi/seller-agent';
import { createAIProvider } from '@amz-spapi/ai-provider';
import { SpApiClient } from '@farvisionllc/sp-client';
import { SpCache } from '@amz-spapi/sp-cache';
import { auth0 } from '../../../lib/auth0';
import { resolveAmazonConnection } from '../../../lib/amazon-connections';
import { zipSync } from 'fflate';
import {
  extensionForMime,
  loadAssetBytes,
  persistGeneratedFileAsset,
  persistGeneratedImageAsset,
} from '../../../lib/media-assets';
import { createImageOps } from '../../../lib/image-ops';
import { createSourcingOps, createWebOps } from '../../../lib/web-ops';
import { createDocumentOps } from '../../../lib/document-ops';
import { createComplianceOps } from '../../../lib/compliance-ops';
import { createReportOps } from '../../../lib/report-ops';
import { meterImageGenerator } from '../../../lib/metered-image-generator';
import { createListingWrites } from '../../../lib/listing-writes';
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
  'tool-trim-image',
  'tool-scale-image',
  'tool-remove-image-background',
  'tool-compose-image',
  'tool-generate-infographic',
  'tool-render-graphic',
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
  let listingWrites: SellerListingWrites | undefined;
  let reportOps: ReturnType<typeof createReportOps> | undefined;

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

    // Report rows are stored against the seller account, so this needs a
    // resolved sellerId — without one there is nothing to key them to.
    if (sellerId) {
      reportOps = createReportOps({
        sellerId,
        spClient,
        marketplaceId: userMarketplaceId,
      });
    }

    // Live listing writes: preview is Amazon's dry run; apply/revert sit
    // behind chat-side human approval. Optional env allowlist restricts
    // writes to designated test SKUs (the trust-ladder training wheels).
    if (sellerId) {
      const skuAllowlist = (process.env['LISTING_WRITE_SKU_ALLOWLIST'] ?? '')
        .split(',')
        .map((sku) => sku.trim())
        .filter(Boolean);
      listingWrites = createListingWrites({
        userId: session.user.sub,
        sellerId,
        marketplaceId: userMarketplaceId,
        spClient,
        skuAllowlist: skuAllowlist.length ? skuAllowlist : undefined,
      });
    }
  }

  // Image generation is the priciest per-call vendor in a chat turn and the
  // agent fires it on its own initiative (proposal fan-outs run several at
  // once), so it goes through the same cap and ledger as the scrapers.
  const rawImageGenerator = provider.imageGenerator?.();
  const imageGenerator = rawImageGenerator
    ? meterImageGenerator(rawImageGenerator, {
        userId: session.user.sub,
        chatId,
      })
    : undefined;

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
    exportPhotoZip: async ({ zipName, productId, files }) => {
      const entries: Record<string, Uint8Array> = {};
      for (const file of files) {
        const asset = await loadAssetBytes({
          userId: chatUserId,
          assetId: file.assetId,
        });
        if (!asset) {
          throw new Error(
            `Asset ${file.assetId} not found — use asset ids from this conversation's photos.`
          );
        }
        // Amazon's auto-assign convention: <productId>.<VARIANT>.<ext>. The
        // extension comes from the stored asset, not from the model — a .jpg
        // name on PNG bytes is rejected on upload.
        const baseName = file.variant
          ? `${productId}.${file.variant}.${extensionForMime(asset.mimeType)}`
          : file.fileName;
        if (!baseName) {
          throw new Error(
            `File for asset ${file.assetId} has neither a variant code nor a fileName.`
          );
        }
        // Model-chosen names could collide; suffix duplicates instead of
        // silently overwriting an entry.
        let name = baseName;
        for (let n = 2; entries[name]; n++) {
          name = baseName.replace(/(\.[a-z]+)$/i, `-${n}$1`);
        }
        entries[name] = asset.bytes;
      }
      // Photos are already compressed — store, don't deflate (same as the
      // A+ export kit).
      const zipped = zipSync(entries, { level: 0 });
      const zipAsset = await persistGeneratedFileAsset({
        userId: chatUserId,
        bytes: Buffer.from(zipped),
        mimeType: 'application/zip',
        extension: 'zip',
        feature: 'listings',
      });
      return {
        downloadUrl: `/api/a-plus/assets/${zipAsset.assetId}?download=1&filename=${zipName}.zip`,
        fileCount: files.length,
        sizeBytes: zipAsset.sizeBytes,
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
    webOps: createWebOps(chatUserId, chatId),
    sourcingOps: createSourcingOps(chatUserId, chatId),
    complianceOps: createComplianceOps(chatUserId),
    documentOps: createDocumentOps({ userId: chatUserId }),
    reportOps,
    listingWrites,
    marketplaceId: userMarketplaceId,
    additionalInstructions: registryInstructions,
  });

  const trimmedMessages = trimHistory(messages as UIMessage[], {
    maxMessages: 20,
    minRecentMessages: 10,
  });

  // `tools` is what enables multi-modal tool results: without it, a persisted
  // tool part is converted back as plain JSON and any image a tool returned via
  // toModelOutput is silently dropped — so look-at-photo would show the model
  // geometry and never the pixels.
  const modelMessages = dropStaleToolImages(
    await convertToModelMessages(trimmedMessages, {
      ignoreIncompleteToolCalls: true,
      tools: agent.tools,
    })
  );

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
