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
import { SpCache } from '@amz-spapi/sp-cache';
import { auth0 } from '../../../lib/auth0';
import {
  resolveAmazonConnection,
  type AmazonConnection,
} from '../../../lib/amazon-connections';
import { spApiClientFor } from '../../../lib/amazon-clients';
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
import { createProcurementOps } from '../../../lib/procurement-ops';
import { createComplianceOps } from '../../../lib/compliance-ops';
import { createReportOps } from '../../../lib/report-ops';
import { createHarvestOps } from '../../../lib/harvest-ops';
import { adsClientFor } from '../../../lib/amazon-clients';
import { listAmazonConnections } from '../../../lib/amazon-connections';
import { createAdsOps } from '../../../lib/ads-ops';
import { costOfUsage, recordModelUsage } from '../../../lib/model-usage';
import {
  assertChatTurnWithinBudget,
  BudgetExceededError,
} from '../../../lib/cost-ledger';
import { captureServerException } from '../../../lib/posthog-server';
import { denyIfWithoutAccess } from '../../../lib/access';
import { after } from 'next/server';
import { flushLogs } from '../../../lib/otel-logs';
import { meterImageGenerator } from '../../../lib/metered-image-generator';
import { createListingWrites } from '../../../lib/listing-writes';
import {
  getChatMeta,
  isValidChatId,
  saveChatTurn,
  type ChatUIMessage,
} from '../../../lib/chat-store';
import { loggerFor } from '../../../lib/logger';
const log = loggerFor('chat');

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
  // Drain buffered log records once the response is done. For a streaming
  // route "done" means after the stream closes, which is exactly right: the
  // records worth having — the mid-stream failure, the metering result — are
  // written long after the headers went out, and would otherwise sit in the
  // batch buffer when the instance freezes.
  after(() => flushLogs());

  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authenticated is not authorised. This route spends on the first message, so
  // the invite gate is enforced here and not only in the UI that leads to it.
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

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

  /**
   * Refuse the turn if the user is already at their daily spend ceiling.
   *
   * Checked here rather than deeper in: everything below this point costs money
   * or sets up something that will, and the cheapest refusal is the one that
   * happens before any of it. 402 rather than 429 — the user is not rate
   * limited, they have exhausted a budget, and the two want different UI.
   *
   * `assertWithinBudget` fails OPEN on a storage error, so a Couchbase outage
   * degrades to the old uncapped behaviour instead of taking chat down.
   */
  try {
    await assertChatTurnWithinBudget(session.user.sub);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return Response.json({ error: error.message }, { status: 402 });
    }
    throw error;
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

  /**
   * The seller's SP-API connection, or nothing (#55).
   *
   * No env-var fallback any more. It read `LWA_CLIENT_SECRET` and
   * `LWA_REFRESH_TOKEN` from the Vercel runtime — a long-lived seller
   * credential in exactly the place this slice exists to remove it from — and
   * it was already inert: neither variable is set in any environment.
   */
  let spConnection: AmazonConnection | undefined;
  let sellerId = process.env['SP_SELLER_ID'];
  let userMarketplaceId = marketplaceId;

  /**
   * True when the credentials could not be READ, as distinct from absent.
   *
   * These are two different situations that used to look identical. Since #11
   * the secrets are KMS-encrypted, so reading them can fail for reasons that
   * have nothing to do with whether the seller connected an account —
   * unreachable KMS, expired AWS credentials, a key policy change. Swallowing
   * that turned every such failure into "your Amazon account isn't connected",
   * which is both wrong and unfixable by the person reading it: the Connections
   * page still says connected, because listing profiles reads metadata only and
   * never decrypts.
   */
  let credentialsUnreadable = false;

  try {
    const userId = session.user.sub;
    const resolved = await resolveAmazonConnection({
      apiType: 'SP_API',
      userId,
    });
    if (resolved.connected) {
      const { profile } = resolved.connection;
      spConnection = resolved.connection;
      sellerId = profile.seller_id || sellerId;
      userMarketplaceId = profile.marketplace_id || marketplaceId;
    }
  } catch (error) {
    // Still falls back to env vars, which is what makes local development
    // without Couchbase work — but it no longer does so in silence.
    credentialsUnreadable = true;
    log.error(
      {
        sub: session.user.sub,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not read stored Amazon credentials for'
    );
  }

  // Create SP client and cache only if credentials are available
  // The agent will work without Amazon connection for basic conversations
  let spCache: SpCache | undefined;
  let listingWrites: SellerListingWrites | undefined;
  let reportOps: ReturnType<typeof createReportOps> | undefined;

  // Ads is deliberately OUTSIDE the SP-API block below. The two are separate
  // Amazon applications with separate consent, and an advertiser can connect
  // Ads without ever connecting a Seller account — gating ads tools on SP
  // credentials would hide them from exactly that user. It resolves its own
  // connections per call, so constructing it is free.
  const adsOps = createAdsOps({ userId: session.user.sub });

  /**
   * Keyword harvest funnels (#147).
   *
   * Needs BOTH halves of the account: the funnel and its campaigns belong to
   * the advertiser profile, but the search-term evidence is stored against the
   * SELLER — so unlike the ads tools above this is gated on a resolved
   * `sellerId`. Without one there are no rows to harvest from, and every plan
   * would refuse on coverage while looking like a configuration problem.
   */
  const harvestOps = sellerId
    ? createHarvestOps({
        userId: session.user.sub,
        sellerId,
        async resolveAds(profileId) {
          const available = (
            await listAmazonConnections({
              apiType: 'ADS_API',
              userId: session.user.sub,
            })
          ).filter((c) => c.profile.advertiser_profile_id);
          if (available.length === 0) {
            throw new Error(
              'No Amazon Ads account is connected, or the connected one has ' +
                'no advertiser profile. Connect one from Settings.'
            );
          }
          // Refuses to guess between several, for the same reason `createAdsOps`
          // does: a funnel keyed to a marketplace the user did not choose is an
          // answer that looks complete and is not.
          const match = profileId
            ? available.find(
                (c) => c.profile.advertiser_profile_id === profileId
              )
            : available.length === 1
            ? available[0]
            : undefined;
          if (!match) {
            throw new Error(
              profileId
                ? `No connected Ads profile with id ${profileId}. Call ` +
                  'list-ad-profiles to see the available ones.'
                : 'This account has several advertiser profiles and none was ' +
                  'named. Call list-ad-profiles and ask which marketplace ' +
                  'they mean.'
            );
          }
          return {
            client: await adsClientFor(match),
            profileId: match.profile.advertiser_profile_id as string,
          };
        },
      })
    : undefined;

  if (spConnection) {
    // Mints through the credentials API and re-mints on a 401. This runtime
    // never holds the refresh token or the client secret that would let it
    // mint one itself.
    const spClient = await spApiClientFor(spConnection, {
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

  /**
   * Tell the agent that the credentials are unreadable, not absent.
   *
   * Without this it sees no `spCache`, concludes the seller never connected an
   * account, and tells them to go and connect one — advice that cannot work,
   * because they already did and the Connections page agrees with them.
   */
  const credentialNotice = credentialsUnreadable
    ? `AMAZON CREDENTIALS COULD NOT BE READ THIS TURN.\n` +
      `This is NOT the same as the seller having no connected account, and it is ` +
      `very likely they do have one — the Connections page reads profile ` +
      `metadata and never decrypts, so it will still show them as connected. ` +
      `Do NOT tell them to connect an account or to re-authorize. Say that their ` +
      `Amazon data is temporarily unreadable on our side, that it is being looked ` +
      `at, and answer whatever you can without it.`
    : undefined;

  const additionalInstructions =
    [registryInstructions, credentialNotice].filter(Boolean).join('\n\n') ||
    undefined;

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
    procurementOps: createProcurementOps({ userId: chatUserId }),
    reportOps,
    adsOps,
    harvestOps,
    listingWrites,
    marketplaceId: userMarketplaceId,
    additionalInstructions,
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
    // Reported, not just returned. This used to hand the raw message to the
    // client and tell nobody — so a misconfigured gateway or a bad model id
    // surfaced as a mystery error in the UI and left no trace on our side.
    log.error(
      {
        chatId,
        error: err instanceof Error ? `${err.name}: ${err.message}` : err,
      },
      'agent stream failed to start'
    );
    await captureServerException(err, {
      distinctId: chatUserId,
      properties: { feature: 'chat', phase: 'stream-start', chatId },
    });
    // Generic text to the client: the underlying message can name internal
    // hosts, model ids and gateway details, none of which help a seller.
    return Response.json(
      { error: 'The assistant could not start. Please try again.' },
      { status: 500 }
    );
  }

  const stream = createUIMessageStream({
    originalMessages: messages as UIMessage[],
    execute: async ({ writer }) => {
      writer.merge(result.toUIMessageStream());
    },
    onFinish: async ({ messages: updatedMessages }) => {
      // Token spend, which nothing recorded before: the gateway bills it and
      // the ledger never saw it, so a heavy month first showed up as a balance
      // running out. Awaited here because `totalUsage` only settles once the
      // whole agent loop has finished, steps included.
      try {
        const [usage, response, steps] = await Promise.all([
          result.totalUsage,
          result.response,
          result.steps,
        ]);
        await recordModelUsage({
          userId: chatUserId,
          feature: 'chat',
          // The model that actually served the turn, not the tier we asked
          // for — a gateway fallback would otherwise be billed to the wrong
          // name and priced with the wrong table.
          modelId: response?.modelId ?? 'unknown',
          usage,
          chatId,
          steps: steps?.length,
        });
        // A runaway context should be visible in the dev terminal AS it
        // happens, not in the ledger afterwards (#133). Cached input is the
        // figure to watch: high cached share means the trim hysteresis is
        // holding; high UNcached input means the prefix moved.
        const { costUsd } = costOfUsage(response?.modelId ?? 'unknown', usage);
        log.info(
          {
            steps: steps?.length,
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            estimatedUsd: Number(costUsd.toFixed(4)),
          },
          'turn usage'
        );
      } catch (error) {
        // Metering must never cost the seller their answer.
        log.error(
          { error: error instanceof Error ? error.message : error },
          'usage not recorded'
        );
      }

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
      // The blind spot this closes: a turn that dies mid-stream has already
      // sent its 200 and its headers, so nothing downstream records it as a
      // failure. Vercel counts a success, the seller sees a half-written
      // answer, and the only trace was a string handed to the browser.
      log.error(
        {
          chatId,
          error:
            error instanceof Error ? `${error.name}: ${error.message}` : error,
        },
        'agent stream failed mid-turn'
      );
      // Fire-and-forget: onError is synchronous, and the stream must not wait
      // on telemetry. captureServerException never throws, so a floating
      // rejection is not possible.
      void captureServerException(error, {
        distinctId: chatUserId,
        properties: { feature: 'chat', phase: 'mid-stream', chatId },
      });

      // The budget message is written for the seller and names no internals,
      // so it passes through intact — being told the cap is reached is
      // actionable in a way that "something went wrong" is not. Tools reach
      // this path through `withPaidCall` after the stream has opened.
      if (error instanceof BudgetExceededError) return error.message;

      return 'The assistant hit an error partway through this answer. Please try again.';
    },
  });

  return createUIMessageStreamResponse({ stream });
}
