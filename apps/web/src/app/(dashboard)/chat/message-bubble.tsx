'use client';

import { Bot, User, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UIMessage } from 'ai';
import { APlusDocumentSchema, type APlusDocument } from '@farvisionllc/models';
import { APlusPreview } from '@/components/aplus-preview/aplus-preview';

export type AppMessage = UIMessage;

const APLUS_TOOL_PART_TYPE = 'tool-generate-aplus-preview';

type ToolPart = {
  type: string;
  state?: string;
  output?: unknown;
  errorText?: string;
};

function getToolName(partType: string): string | null {
  return partType.startsWith('tool-') ? partType.slice('tool-'.length) : null;
}

function parseAPlusDoc(output: unknown): APlusDocument | null {
  const parsed = APlusDocumentSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

const MARKDOWN_COMPONENTS: Components = {
  img: ({ src, alt, title }) => {
    if (!src) return null;
    return (
      <img
        src={typeof src === 'string' ? src : undefined}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        decoding="async"
        // @ts-expect-error fetchpriority is a valid HTML attribute not yet in React types
        fetchpriority="low"
        className="my-2 h-auto max-w-full rounded-md bg-muted-foreground/5"
      />
    );
  },
};

const TOOL_LABELS: Record<string, [string, string]> = {
  'search-catalog': ['Searching catalog...', 'Catalog search complete'],
  'get-listing': ['Fetching listing details...', 'Listing details retrieved'],
  'get-orders': ['Fetching orders...', 'Orders retrieved'],
  'get-order-details': ['Fetching order details...', 'Order details retrieved'],
  'get-inventory': ['Checking inventory...', 'Inventory retrieved'],
  'get-inbound-shipments': [
    'Fetching inbound shipments...',
    'Inbound shipments retrieved',
  ],
  'get-settlements': ['Fetching settlements...', 'Settlements retrieved'],
  'get-financial-events': [
    'Fetching financial events...',
    'Financial events retrieved',
  ],
  'get-my-listing': ['Fetching your listing...', 'Your listing retrieved'],
  'search-my-listings': [
    'Searching your listings...',
    'Your listings retrieved',
  ],
  'generate-image': ['Generating image...', 'Image generated'],
  'propose-listing-photos': [
    'Generating photo proposals...',
    'Photo proposals ready',
  ],
  'crop-image': ['Cropping image...', 'Image cropped'],
  'trim-image': ['Trimming empty space...', 'Image trimmed'],
  'read-page': ['Reading page...', 'Page read'],
  'compose-image': ['Compositing images...', 'Images composited'],
  'generate-infographic': ['Rendering infographic...', 'Infographic rendered'],
  'export-photo-set': ['Bundling photo set...', 'Photo set ready to download'],
  'scale-image': ['Scaling image...', 'Image scaled'],
  'remove-image-background': ['Removing background...', 'Background removed'],
  'preview-listing-images': [
    'Validating with Amazon (dry run)...',
    'Amazon validation preview complete',
  ],
  'apply-listing-images': [
    'Updating the live listing...',
    'Listing update submitted',
  ],
  'revert-listing-images': [
    'Reverting listing images...',
    'Listing revert submitted',
  ],
  'check-listing-status': [
    'Checking listing health...',
    'Listing status retrieved',
  ],
};

/** Human-readable descriptions for approval-gated (live write) tools. */
const APPROVAL_TOOL_SUMMARIES: Record<string, string> = {
  'apply-listing-images':
    'Write these images to the LIVE Amazon listing (a snapshot is saved first)',
  'revert-listing-images':
    'Restore this listing’s images from the stored snapshot',
};

function approvalSummary(toolName: string, input: unknown): string {
  const base = APPROVAL_TOOL_SUMMARIES[toolName] ?? `Run ${toolName}`;
  const sku = (input as { sku?: string } | null)?.sku;
  const count = (input as { imageAssetIds?: string[] } | null)?.imageAssetIds
    ?.length;
  return [
    base,
    sku ? `— SKU ${sku}` : '',
    count ? `(${count} image${count === 1 ? '' : 's'})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const LISTING_IMAGE_TOOL_TYPES = new Set([
  'tool-get-my-listing',
  'tool-search-my-listings',
  'tool-propose-listing-photos',
  'tool-generate-image',
  'tool-crop-image',
  'tool-trim-image',
  'tool-scale-image',
  'tool-remove-image-background',
  'tool-compose-image',
  'tool-generate-infographic',
  // Public catalog tools — competitor images render side by side with yours.
  'tool-get-listing',
  'tool-search-catalog',
]);

/** Cap for one catalog item's image set so a single lookup can't flood the grid. */
const CATALOG_IMAGES_MAX = 8;

type CatalogImageEntry = { variant?: string; link?: string };
type CatalogImageSet = { images?: CatalogImageEntry[] };

function mainFirst(images: CatalogImageEntry[]): CatalogImageEntry[] {
  return [...images].sort((a, b) =>
    a.variant === 'MAIN' ? -1 : b.variant === 'MAIN' ? 1 : 0
  );
}

function listingSlotLabel(slot: string): string {
  if (slot === 'main_product_image_locator') return 'Main';
  if (slot === 'swatch_product_image_locator') return 'Swatch';
  const other = slot.match(/^other_product_image_locator_(\d+)$/);
  return other ? `Image ${other[1]}` : slot;
}

/** Pull renderable images out of listing / photo tool outputs. */
function extractListingToolImages(
  output: unknown
): Array<{ url: string; label?: string }> {
  if (!output || typeof output !== 'object') return [];
  const data = output as {
    // Own-listing tools: flat {slot|label, url}. Catalog tools: nested
    // SP-API sets {marketplaceId, images: [{variant, link}]}.
    images?: Array<
      { slot?: string; label?: string; url?: string } | CatalogImageSet
    >;
    listings?: Array<{ mainImage?: string; title?: string; sku?: string }>;
    proposals?: Array<{ label?: string; url?: string }>;
    // Catalog search: one MAIN image per result item.
    items?: Array<{
      asin?: string;
      summaries?: Array<{ itemName?: string }>;
      images?: CatalogImageSet[];
    }>;
  };
  const collected: Array<{ url: string; label?: string }> = [];
  const catalogEntries: CatalogImageEntry[] = [];
  for (const image of data.images ?? []) {
    if (!image) continue;
    if ('url' in image && image.url) {
      collected.push({
        url: image.url,
        label:
          image.label ??
          (image.slot ? listingSlotLabel(image.slot) : undefined),
      });
      continue;
    }
    if ('images' in image && Array.isArray(image.images)) {
      catalogEntries.push(...image.images);
    }
  }
  for (const entry of mainFirst(catalogEntries).slice(0, CATALOG_IMAGES_MAX)) {
    if (entry.link) {
      collected.push({ url: entry.link, label: entry.variant });
    }
  }
  for (const item of data.items ?? []) {
    const images = item?.images?.flatMap((set) => set.images ?? []) ?? [];
    const main = mainFirst(images)[0];
    if (main?.link) {
      collected.push({
        url: main.link,
        label: item.summaries?.[0]?.itemName ?? item.asin,
      });
    }
  }
  for (const listing of data.listings ?? []) {
    if (listing?.mainImage) {
      collected.push({
        url: listing.mainImage,
        label: listing.title ?? listing.sku,
      });
    }
  }
  for (const proposal of data.proposals ?? []) {
    if (proposal?.url) {
      collected.push({ url: proposal.url, label: proposal.label });
    }
  }
  return collected;
}

function ToolCallDisplay({
  toolName,
  state,
}: {
  toolName: string;
  state: string;
}) {
  const isLoading =
    state !== 'output-available' &&
    state !== 'output-error' &&
    state !== 'output-denied';
  const labels = TOOL_LABELS[toolName];
  const label = labels ? (isLoading ? labels[0] : labels[1]) : toolName;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      {isLoading && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {!isLoading && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      <span
        className={cn('text-muted-foreground', isLoading && 'animate-pulse')}
      >
        {label}
      </span>
    </div>
  );
}

export function MessageBubble({
  message,
  isLast,
  isStreaming,
  onApprovalResponse,
}: {
  message: AppMessage;
  isLast: boolean;
  isStreaming: boolean;
  onApprovalResponse?: (id: string, approved: boolean) => void;
}) {
  const isUser = message.role === 'user';

  // Collect tool calls + special-render any A+ preview / listing image output
  const toolCalls: { toolName: string; state: string }[] = [];
  const aplusDocs: APlusDocument[] = [];
  const listingImages: Array<{ url: string; label?: string }> = [];
  const pendingApprovals: Array<{
    approvalId: string;
    toolName: string;
    input: unknown;
  }> = [];
  const seenImageUrls = new Set<string>();
  let textContent = '';

  if (message.parts) {
    for (const part of message.parts as ToolPart[]) {
      if (part.type === 'text') {
        textContent += (part as { type: 'text'; text: string }).text;
        continue;
      }
      const toolName = getToolName(part.type);
      if (!toolName) continue;

      toolCalls.push({ toolName, state: part.state ?? 'input-streaming' });

      if (part.state === 'approval-requested') {
        const approval = (part as unknown as { approval?: { id?: string } })
          .approval;
        if (approval?.id) {
          pendingApprovals.push({
            approvalId: approval.id,
            toolName,
            input: (part as unknown as { input?: unknown }).input,
          });
        }
      }

      if (
        part.type === APLUS_TOOL_PART_TYPE &&
        part.state === 'output-available'
      ) {
        const doc = parseAPlusDoc(part.output);
        if (doc) aplusDocs.push(doc);
      }

      if (
        LISTING_IMAGE_TOOL_TYPES.has(part.type) &&
        part.state === 'output-available'
      ) {
        for (const image of extractListingToolImages(part.output)) {
          if (seenImageUrls.has(image.url)) continue;
          seenImageUrls.add(image.url);
          listingImages.push(image);
        }
      }
    }
  }

  return (
    <div
      className={cn(
        'flex gap-2 sm:gap-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3',
          aplusDocs.length > 0
            ? 'w-full max-w-full sm:max-w-[95%]'
            : 'max-w-[92%] sm:max-w-[80%]',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {/* Tool call indicators */}
        {toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {toolCalls.map((tc, i) => (
              <ToolCallDisplay
                key={i}
                toolName={tc.toolName}
                state={tc.state}
              />
            ))}
          </div>
        )}

        {/* A+ preview docs (rendered before text so user sees the artifact first) */}
        {aplusDocs.length > 0 && (
          <div className="mb-3 space-y-4">
            {aplusDocs.map((doc, i) => (
              <APlusPreview key={i} doc={doc} />
            ))}
          </div>
        )}

        {/* Live-write approval prompts */}
        {pendingApprovals.length > 0 && (
          <div className="mb-3 space-y-2">
            {pendingApprovals.map((approval) => (
              <div
                key={approval.approvalId}
                className="rounded-lg border border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/30"
              >
                <p className="text-sm font-medium">Approval required</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {approvalSummary(approval.toolName, approval.input)}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onApprovalResponse?.(approval.approvalId, true)
                    }
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onApprovalResponse?.(approval.approvalId, false)
                    }
                    className="rounded-md border px-3 py-1.5 text-sm"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Listing images from tool output */}
        {listingImages.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {listingImages.map((image) => (
              <figure key={image.url} className="w-24">
                <a href={image.url} target="_blank" rel="noreferrer">
                  <img
                    src={image.url}
                    alt={image.label ?? 'Listing image'}
                    loading="lazy"
                    decoding="async"
                    className="h-24 w-24 rounded-md border bg-white object-contain"
                  />
                </a>
                {image.label && (
                  <figcaption className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {image.label}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}

        {/* Text content with markdown */}
        {textContent && (
          <div
            className={cn(
              'prose prose-sm max-w-none',
              isUser ? 'prose-invert' : 'dark:prose-invert'
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MARKDOWN_COMPONENTS}
            >
              {textContent}
            </ReactMarkdown>
          </div>
        )}

        {/* Streaming indicator */}
        {isLast && isStreaming && !textContent && toolCalls.length === 0 && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {isUser && (
        <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}
