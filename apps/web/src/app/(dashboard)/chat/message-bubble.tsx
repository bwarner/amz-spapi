'use client';

import { memo } from 'react';

import {
  Bot,
  User,
  Loader2,
  ChevronRight,
  CircleSlash,
  CircleDashed,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { UIMessage } from 'ai';
import { APlusDocumentSchema, type APlusDocument } from '@farvisionllc/models';
import { APlusPreview } from '@/components/aplus-preview/aplus-preview';
import {
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableHead,
  MarkdownTableRow,
} from './markdown-table';

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
  /**
   * Tables get their own component: bordered, scrollable in both directions,
   * collapsed behind a control once tall, and typeset per cell rather than per
   * table. See `markdown-table.tsx` for why the old blanket monospace was the
   * thing making listing tables unreadable.
   */
  table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
  td: ({ children }) => <MarkdownTableCell>{children}</MarkdownTableCell>,
  th: ({ children }) => <MarkdownTableHead>{children}</MarkdownTableHead>,
  tr: ({ children }) => <MarkdownTableRow>{children}</MarkdownTableRow>,
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
  'look-at-photo': ['Looking at the photo...', 'Photo reviewed'],
  'check-image-compliance': [
    'Checking image compliance...',
    'Compliance check complete',
  ],
  'search-suppliers': ['Searching suppliers...', 'Suppliers found'],
  'read-page': ['Reading page...', 'Page read'],
  'compose-image': ['Compositing images...', 'Images composited'],
  'generate-infographic': ['Rendering infographic...', 'Infographic rendered'],
  'render-graphic': ['Rendering graphic...', 'Graphic rendered'],
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
  'save-vendor': ['Saving vendor...', 'Vendor saved'],
  'set-buyer-profile': ['Saving buyer profile...', 'Buyer profile saved'],
  'get-fc-address': ['Looking up Amazon FC...', 'FC lookup complete'],
  'save-fc-address': ['Saving FC address...', 'FC address saved'],
  'list-fc-addresses': ['Loading FC address book...', 'FC address book loaded'],
  'get-buyer-profile': ['Loading buyer profile...', 'Buyer profile retrieved'],
  'list-vendors': ['Loading vendors...', 'Vendors retrieved'],
  'create-purchase-order': [
    'Creating purchase order...',
    'Purchase order created',
  ],
  'revise-purchase-order': [
    'Revising purchase order...',
    'Purchase order revised',
  ],
  'cancel-purchase-order': [
    'Cancelling purchase order...',
    'Purchase order cancelled',
  ],
  'render-purchase-order': [
    'Rendering purchase order PDF...',
    'Purchase order ready to download',
  ],
  'list-purchase-orders': [
    'Loading purchase orders...',
    'Purchase orders retrieved',
  ],
  'get-purchase-order': [
    'Loading purchase order...',
    'Purchase order retrieved',
  ],
};

/** Human-readable descriptions for approval-gated (live write) tools. */
const APPROVAL_TOOL_SUMMARIES: Record<string, string> = {
  'apply-listing-images':
    'Write these images to the LIVE Amazon listing (a snapshot is saved first)',
  'revert-listing-images':
    'Restore this listing’s images from the stored snapshot',
  'create-purchase-order':
    'Create this purchase order (a PO number is assigned and it becomes a business record)',
  'revise-purchase-order':
    'Revise this purchase order in place (revision increments; old downloads are invalidated)',
  'cancel-purchase-order':
    'Cancel this purchase order (it stays on the record but can no longer be revised or rendered)',
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
  'tool-render-graphic',
  // Public catalog tools — competitor images render side by side with yours.
  'tool-get-listing',
  'tool-search-catalog',
]);

/** Cap for one catalog item's image set so a single lookup can't flood the grid. */
const CATALOG_IMAGES_MAX = 8;

/**
 * One renderable step of an assistant turn, in the order it happened.
 *
 * Rendering by sequence rather than by kind is what keeps a tool badge next to
 * the sentence that explains it.
 */
type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; toolName: string; state: string }
  | { kind: 'aplus'; doc: APlusDocument }
  | { kind: 'images'; images: Array<{ url: string; label?: string }> }
  | {
      kind: 'approval';
      approvalId: string;
      toolName: string;
      input: unknown;
    };

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

const SETTLED_TOOL_STATES = new Set([
  'output-available',
  'output-error',
  'output-denied',
]);

/**
 * A tool row.
 *
 * `state` alone cannot tell "running" from "never finished" — both are simply
 * "not settled". Before, anything unsettled span, so reopening a conversation
 * showed spinners for calls that had stopped days earlier and would never
 * complete. Seven of them, in the case that prompted this.
 *
 * `isActive` is the missing half: a call is only in flight if this is the last
 * message AND the conversation is streaming. Otherwise an unsettled call is
 * stale — the turn ended without it resolving — and saying so is the honest
 * thing. A spinner claims work is happening; there is no request.
 */
function ToolCallDisplay({
  toolName,
  state,
  isActive,
}: {
  toolName: string;
  state: string;
  /** This message is the last one and the conversation is streaming. */
  isActive: boolean;
}) {
  const settled = SETTLED_TOOL_STATES.has(state);
  const awaitingApproval = state === 'approval-requested';
  // Unsettled and nothing is running: it stopped, and will not resume on its own.
  const stalled = !settled && !isActive && !awaitingApproval;
  const running = !settled && isActive;

  const labels = TOOL_LABELS[toolName];
  const label = labels ? (settled ? labels[1] : labels[0]) : toolName;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      {running && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {awaitingApproval && !isActive && (
        <CircleDashed className="h-3 w-3 text-amber-600" />
      )}
      {stalled && <CircleSlash className="h-3 w-3 text-muted-foreground/60" />}
      {settled && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      <span
        className={cn(
          'text-muted-foreground',
          running && 'animate-pulse',
          stalled && 'text-muted-foreground/60 line-through'
        )}
      >
        {label}
      </span>
      {stalled && (
        <span className="text-xs text-muted-foreground/60">
          didn&rsquo;t finish
        </span>
      )}
      {awaitingApproval && !isActive && (
        <span className="text-xs text-amber-600">awaiting approval</span>
      )}
    </div>
  );
}

/**
 * One message, memoized.
 *
 * The chat input's state lives in the page component that renders this list, so
 * every keystroke re-renders that component — and without `memo`, every message
 * in the conversation with it. Each bubble renders markdown, tables and images,
 * so on a long conversation that is hundreds of subtrees rebuilt per character
 * and typing visibly lags.
 *
 * Memo only helps if the props are referentially stable, which is why
 * `onApprovalResponse` is a `useCallback` at the call site. An inline arrow
 * there would be a new function every render and every bubble would re-render
 * anyway — the failure mode where `memo` looks applied and does nothing.
 *
 * `message` identity comes from `useChat` and is stable per message; `isLast`
 * and `isStreaming` change only for the last bubble, and only while streaming.
 * So a keystroke re-renders none of them.
 */
function MessageBubbleImpl({
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

  /**
   * The turn, in the order it happened.
   *
   * Previously every text part was concatenated into one string and every tool
   * call collected into a separate list, so a turn that went
   * `text → removeBackground → text → composite → text` rendered as all the
   * tool badges followed by all the prose. The reader lost which commentary
   * belonged to which step, and the text parts were glued together with no
   * separator — running the last sentence of one into the first of the next.
   *
   * Walking the parts in sequence fixes both: the concatenation bug is a
   * consequence of the ordering bug, not a separate defect.
   */
  const blocks: MessageBlock[] = [];
  const seenImageUrls = new Set<string>();

  /**
   * Adjacent text parts join with no separator, because streaming splits text
   * at arbitrary points — a paragraph break between them would land mid
   * sentence. A tool part is what ends a block, so the next text starts a new
   * one.
   */
  const appendText = (text: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'text') last.text += text;
    else blocks.push({ kind: 'text', text });
  };

  if (message.parts) {
    for (const part of message.parts as ToolPart[]) {
      if (part.type === 'text') {
        appendText((part as { type: 'text'; text: string }).text);
        continue;
      }
      const toolName = getToolName(part.type);
      if (!toolName) continue;

      blocks.push({
        kind: 'tool',
        toolName,
        state: part.state ?? 'input-streaming',
      });

      if (part.state === 'approval-requested') {
        const approval = (part as unknown as { approval?: { id?: string } })
          .approval;
        if (approval?.id) {
          blocks.push({
            kind: 'approval',
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
        if (doc) blocks.push({ kind: 'aplus', doc });
      }

      if (
        LISTING_IMAGE_TOOL_TYPES.has(part.type) &&
        part.state === 'output-available'
      ) {
        // Deduped across the whole message: two tools reporting the same image
        // should not show it twice, even from different steps.
        const images = extractListingToolImages(part.output).filter((image) => {
          if (seenImageUrls.has(image.url)) return false;
          seenImageUrls.add(image.url);
          return true;
        });
        if (images.length) blocks.push({ kind: 'images', images });
      }
    }
  }

  const hasAPlusDoc = blocks.some((block) => block.kind === 'aplus');
  const hasText = blocks.some(
    (block) => block.kind === 'text' && block.text.trim()
  );
  const hasTool = blocks.some((block) => block.kind === 'tool');

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
          hasAPlusDoc
            ? 'w-full max-w-full sm:max-w-[95%]'
            : 'max-w-[92%] sm:max-w-[80%]',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {/* Every step in the order it happened (#72). */}
        {blocks.map((block, index) => {
          switch (block.kind) {
            case 'text':
              return block.text.trim() ? (
                <div
                  key={index}
                  className={cn(
                    // The block fills the bubble so tables, code and images use
                    // the width; only paragraphs and list items are held to a
                    // reading measure. Capping the whole block instead would
                    // narrow exactly the content that wanted the room (#72).
                    'prose prose-sm max-w-none prose-p:max-w-[70ch] prose-li:max-w-[70ch]',
                    // Not the first block means prose that follows a tool,
                    // which needs air above it or it reads as a caption.
                    index > 0 && 'mt-3',
                    isUser ? 'prose-invert' : 'dark:prose-invert'
                  )}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={MARKDOWN_COMPONENTS}
                  >
                    {block.text}
                  </ReactMarkdown>
                </div>
              ) : null;

            case 'tool':
              return (
                <div key={index} className={cn(index > 0 && 'mt-2')}>
                  <ToolCallDisplay
                    toolName={block.toolName}
                    state={block.state}
                    isActive={Boolean(isLast && isStreaming)}
                  />
                </div>
              );

            case 'aplus':
              return (
                <div key={index} className="mt-3">
                  <APlusPreview doc={block.doc} />
                </div>
              );

            case 'images':
              return (
                <div key={index} className="mt-3 flex flex-wrap gap-2">
                  {block.images.map((image) => (
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
              );

            case 'approval':
              return (
                <div
                  key={index}
                  className="mt-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/30"
                >
                  <p className="text-sm font-medium">Approval required</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {approvalSummary(block.toolName, block.input)}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onApprovalResponse?.(block.approvalId, true)
                      }
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onApprovalResponse?.(block.approvalId, false)
                      }
                      className="rounded-md border px-3 py-1.5 text-sm"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
          }
        })}

        {/* Streaming indicator */}
        {isLast && isStreaming && !hasText && !hasTool && (
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

export const MessageBubble = memo(MessageBubbleImpl);
