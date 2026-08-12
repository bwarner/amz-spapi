/**
 * How a tool call is described in the transcript.
 *
 * Pure, and separate from the bubble that renders it, so the rules that have
 * cost us bugs — chiefly "is this call running or did it simply stop" — can be
 * tested without a DOM.
 */

/** Verb pairs: what a call says while it runs, and once it has finished. */
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
  'update-ad-campaigns': [
    'Updating ad campaigns...',
    'Ad campaign update submitted',
  ],
  'update-ad-groups': ['Updating ad groups...', 'Ad group update submitted'],
  'update-ad-keywords': [
    'Updating keyword bids...',
    'Keyword update submitted',
  ],
  'create-ad-negative-keywords': [
    'Adding negative keywords...',
    'Negative keywords submitted',
  ],
  'update-ad-negative-keywords': [
    'Updating negative keywords...',
    'Negative keyword update submitted',
  ],
  'total-report-rows': ['Totalling report rows...', 'Report totals ready'],
  'check-report-coverage': [
    'Checking report coverage...',
    'Report coverage checked',
  ],
  'get-inventory-ledger': [
    'Reading the inventory ledger...',
    'Inventory ledger read',
  ],
  'sync-report': ['Pulling the report from Amazon...', 'Report imported'],
};

/** A call that carries a result. */
export const SETTLED_TOOL_STATES = new Set([
  'output-available',
  'output-error',
  'output-denied',
]);

/**
 * Whether an unsettled call has actually stopped.
 *
 * `state` alone cannot tell "running" from "never finished" — both are simply
 * "not settled". Before #72 anything unsettled span, so reopening a
 * conversation showed spinners for calls that had stopped days earlier and
 * would never complete; seven of them, in the case that prompted it.
 *
 * `isActive` is the missing half: a call is only in flight if it is in the last
 * message AND the conversation is streaming. An outstanding approval is the
 * exception — it is not stalled, it is waiting on the reader and resumes the
 * moment they answer.
 *
 * The AI Elements `tool` component maps state straight to a badge and cannot
 * express any of this, which is why it is computed here and passed in.
 */
export function isStalled(state: string, isActive: boolean): boolean {
  if (SETTLED_TOOL_STATES.has(state)) return false;
  if (state === 'approval-requested') return false;
  return !isActive;
}

/** The heading for a call: its verb where we have one, its name otherwise. */
export function toolTitle(toolName: string, state: string): string {
  const labels = TOOL_LABELS[toolName];
  if (!labels) return toolName;
  return SETTLED_TOOL_STATES.has(state) ? labels[1] : labels[0];
}

/** Plain-language descriptions for the approval-gated (live write) tools. */
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
  'update-ad-campaigns':
    'Change campaign states/daily budgets on the LIVE ad account',
  'update-ad-groups':
    'Change ad group states/default bids on the LIVE ad account',
  'update-ad-keywords': 'Change keyword bids/states on the LIVE ad account',
  'create-ad-negative-keywords':
    'Add negative keywords to the LIVE ad account (blocks matching search terms)',
  'update-ad-negative-keywords':
    'Pause or re-enable negative keywords on the LIVE ad account',
};

/** The batch a bulk ads write is asking to apply, for the approval line. */
function adsBatchCount(input: unknown): number | undefined {
  const batch = input as {
    campaigns?: unknown[];
    adGroups?: unknown[];
    keywords?: unknown[];
    negativeKeywords?: unknown[];
  } | null;
  const items =
    batch?.campaigns ??
    batch?.adGroups ??
    batch?.keywords ??
    batch?.negativeKeywords;
  return Array.isArray(items) ? items.length : undefined;
}

export function approvalSummary(toolName: string, input: unknown): string {
  const base = APPROVAL_TOOL_SUMMARIES[toolName] ?? `Run ${toolName}`;
  const sku = (input as { sku?: string } | null)?.sku;
  const imageCount = (input as { imageAssetIds?: string[] } | null)
    ?.imageAssetIds?.length;
  const itemCount = adsBatchCount(input);
  return [
    base,
    sku ? `— SKU ${sku}` : '',
    imageCount ? `(${imageCount} image${imageCount === 1 ? '' : 's'})` : '',
    itemCount ? `(${itemCount} item${itemCount === 1 ? '' : 's'})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
