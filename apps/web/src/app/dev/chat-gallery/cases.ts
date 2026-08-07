import type { AppMessage } from '../../(dashboard)/chat/message-bubble';

/**
 * Every state a chat message can be in, as fixtures.
 *
 * These exist because the states are hard to provoke and easy to break. A tool
 * call has seven states from the SDK plus "stalled", which is ours; an approval
 * has three faces; a table looks different depending on whether its cells hold
 * identifiers, figures or prose. Reaching any particular one through the agent
 * means getting a live model to do a specific thing, which is slow, costs money
 * and cannot be relied on to produce the case you wanted.
 *
 * Rendered through the real `MessageBubble`, inside the real page, on purpose.
 * The table bug in #110 was Tailwind typography winning on specificity because
 * the table sits inside a `prose` block — a component rendered in isolation
 * would have looked perfectly correct.
 *
 * Fixtures only: no network, no Amazon account, no model. Deterministic, so a
 * screenshot of one is worth comparing against a screenshot taken later.
 */

export type GalleryCase = {
  /** Stable id, used by the screenshot spec for the file name. */
  id: string;
  title: string;
  /** Why this state is worth looking at, shown beside it. */
  note?: string;
  message: AppMessage;
  /** The last message in a streaming conversation — a call may be in flight. */
  isLast?: boolean;
  isStreaming?: boolean;
};

/** Parts are built loosely: the SDK's union is stricter than a fixture needs. */
function assistant(parts: unknown[]): AppMessage {
  return {
    id: 'fixture',
    role: 'assistant',
    parts,
  } as unknown as AppMessage;
}

function text(value: string) {
  return { type: 'text', text: value };
}

function toolPart(overrides: Record<string, unknown>) {
  return {
    type: 'tool-get-orders',
    toolCallId: 'call_fixture',
    state: 'output-available',
    input: { days: 7, status: 'Shipped' },
    ...overrides,
  };
}

const ORDERS_OUTPUT = {
  orders: [
    { amazonOrderId: '111-2223334-5556667', total: '29.99', status: 'Shipped' },
    { amazonOrderId: '111-9998887-6665554', total: '54.10', status: 'Pending' },
  ],
  count: 2,
};

const LISTING_TABLE = `Here are the listings I found.

| SKU | ASIN | Product | Storage fee | Status |
|---|---|---|---|---|
| FB-COF-GEI-250 | B0DCQHBQNM | Gran Del Val Geisha Coffee Whole Beans – Washed, 250g | $2.16 | ✅ Active |
| FB-LFP-WHT-1600-100 | B0FRD9RR2B | Filtered Blend 1.6L French Press Coffee Maker, 54oz Large Capacity Stainless Steel | $27.65 | ✅ Active |
| PCM-FB-15OZ-BLK-101 | B0D7ZNF71P | 15oz Double Wall Stainless Steel Insulated French Press Coffee and Tea Maker | $1,234.56 | ⚠️ Not Buyable |`;

/** Enough rows to trip the collapse control. */
const TALL_TABLE = [
  'A month of storage, by fulfilment centre.',
  '',
  '| FC | ASIN | Fee |',
  '|---|---|---|',
  ...Array.from(
    { length: 24 },
    (_, index) =>
      `| ${
        ['XAB4', 'MDW2', 'ACY1', 'BDL4'][index % 4]
      }${index} | B0FRD9RR2B | $${(index * 0.37 + 0.02).toFixed(2)} |`
  ),
].join('\n');

export const GALLERY_CASES: GalleryCase[] = [
  // ---------------------------------------------------------------- tools
  {
    id: 'tool-running',
    title: 'Tool — running',
    note: 'In flight: last message, conversation streaming.',
    message: assistant([
      text('Let me pull those orders.'),
      toolPart({ state: 'input-available', output: undefined }),
    ]),
    isLast: true,
    isStreaming: true,
  },
  {
    id: 'tool-stalled',
    title: 'Tool — stalled',
    note: 'Same state, nothing streaming. #72: this must NOT read as running.',
    message: assistant([
      text('Let me pull those orders.'),
      toolPart({ state: 'input-available', output: undefined }),
    ]),
  },
  {
    id: 'tool-complete',
    title: 'Tool — complete, expandable',
    note: 'Parameters and result were unreachable before #107.',
    message: assistant([
      text('Two orders in the last week.'),
      toolPart({ output: ORDERS_OUTPUT }),
    ]),
  },
  {
    id: 'tool-error',
    title: 'Tool — error',
    message: assistant([
      toolPart({
        state: 'output-error',
        output: undefined,
        errorText:
          'SP-API 403 AccessDenied — application is not authorized for Finance and Accounting (/finances/v0/financialEvents)',
      }),
    ]),
  },
  // --------------------------------------------------------- confirmation
  {
    id: 'confirmation-request',
    title: 'Approval — asked',
    note: 'A live listing write, awaiting a decision.',
    message: assistant([
      text('Ready to write these to the live listing.'),
      toolPart({
        type: 'tool-apply-listing-images',
        state: 'approval-requested',
        input: { sku: 'FB-LFP-WHT-1600-100', imageAssetIds: ['a', 'b', 'c'] },
        output: undefined,
        approval: { id: 'appr_1' },
      }),
    ]),
  },
  {
    id: 'confirmation-accepted',
    title: 'Approval — accepted',
    note: 'The decision stays on the record. Before #107 both question and answer vanished.',
    message: assistant([
      toolPart({
        type: 'tool-apply-listing-images',
        state: 'output-available',
        input: { sku: 'FB-LFP-WHT-1600-100', imageAssetIds: ['a', 'b', 'c'] },
        output: { submissionId: 'sub_9912', status: 'ACCEPTED' },
        approval: { id: 'appr_1', approved: true },
      }),
    ]),
  },
  {
    id: 'confirmation-rejected',
    title: 'Approval — rejected',
    message: assistant([
      toolPart({
        type: 'tool-create-purchase-order',
        state: 'output-denied',
        input: { vendorId: 'v_1' },
        output: undefined,
        approval: { id: 'appr_2', approved: false },
      }),
    ]),
  },
  // -------------------------------------------------------------- tables
  {
    id: 'table-mixed',
    title: 'Table — identifiers, prose and figures',
    note: 'Per-cell typesetting (#110): SKUs unbroken, product names wrap, money right-aligned.',
    message: assistant([text(LISTING_TABLE)]),
  },
  {
    id: 'table-tall',
    title: 'Table — tall, collapsed',
    note: 'Fade and "Show all rows" once past the height cap.',
    message: assistant([text(TALL_TABLE)]),
  },
  // ------------------------------------------------------------ artifacts
  {
    id: 'artifact-download',
    title: 'Artifact — produced file',
    note: 'Read from the tool result, not from a markdown link the model had to remember (#111).',
    message: assistant([
      text('Rendered it.'),
      toolPart({
        type: 'tool-render-purchase-order',
        input: { poNumber: 'PO-1042', format: 'pdf' },
        output: {
          success: true,
          downloadUrl: '/api/dev/not-a-real-file.pdf',
          fileName: 'PO-1042.pdf',
          sizeBytes: 148_221,
        },
      }),
    ]),
  },
  {
    id: 'artifact-photo-set',
    title: 'Artifact — photo set',
    message: assistant([
      toolPart({
        type: 'tool-export-photo-set',
        input: { zipName: 'french-press' },
        output: {
          success: true,
          downloadUrl: '/api/dev/not-a-real-file.zip',
          fileCount: 7,
          sizeBytes: 5_242_880,
        },
      }),
    ]),
  },
  // --------------------------------------------------------------- images
  {
    id: 'listing-images',
    title: 'Listing images',
    note: 'SP-API returns one entry per RESOLUTION per variant. Before #114 this rendered MAIN three times.',
    message: assistant([
      toolPart({
        type: 'tool-get-listing',
        input: { asin: 'B0FRD9RR2B' },
        output: {
          asin: 'B0FRD9RR2B',
          images: [
            {
              marketplaceId: 'ATVPDKIKX0DER',
              images: [
                {
                  variant: 'MAIN',
                  link: 'https://m.media-amazon.com/images/I/71nhxp7ZiBL.jpg',
                  width: 2560,
                  height: 2560,
                },
                {
                  variant: 'MAIN',
                  link: 'https://m.media-amazon.com/images/I/41rLpjaoOvL.jpg',
                  width: 500,
                  height: 500,
                },
                {
                  variant: 'MAIN',
                  link: 'https://m.media-amazon.com/images/I/41rLpjaoOvL._SL75_.jpg',
                  width: 75,
                  height: 75,
                },
                {
                  variant: 'PT01',
                  link: 'https://m.media-amazon.com/images/I/51NXZkQ4uYL.jpg',
                  width: 1080,
                  height: 1080,
                },
                {
                  variant: 'PT01',
                  link: 'https://m.media-amazon.com/images/I/41zUcpoEscL.jpg',
                  width: 500,
                  height: 500,
                },
                {
                  variant: 'PT01',
                  link: 'https://m.media-amazon.com/images/I/41zUcpoEscL._SL75_.jpg',
                  width: 75,
                  height: 75,
                },
                {
                  variant: 'PT02',
                  link: 'https://m.media-amazon.com/images/I/61aiFka5HjL.jpg',
                  width: 1080,
                  height: 1080,
                },
                {
                  variant: 'PT02',
                  link: 'https://m.media-amazon.com/images/I/41iUrII3xiL.jpg',
                  width: 500,
                  height: 500,
                },
                {
                  variant: 'PT02',
                  link: 'https://m.media-amazon.com/images/I/41iUrII3xiL._SL75_.jpg',
                  width: 75,
                  height: 75,
                },
              ],
            },
          ],
        },
      }),
    ]),
  },
  // ----------------------------------------------------------------- prose
  {
    id: 'thinking',
    title: 'Waiting for the first token',
    message: assistant([]),
    isLast: true,
    isStreaming: true,
  },
  {
    id: 'user-message',
    title: 'A user turn',
    message: {
      id: 'fixture-user',
      role: 'user',
      parts: [text('What did storage cost me for B0FRD9RR2B last month?')],
    } as unknown as AppMessage,
  },
];
