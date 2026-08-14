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
  // ---------------------------------------------------------------- charts
  {
    id: 'chart-line-spend-vs-sales',
    title: 'Dual-axis chart, with a gap in the data',
    note:
      'Spend as bars against ACOS as a line — two units, so two axes. Jul 4 ' +
      'has spend and no sales, so its ACOS is null: the line must BREAK there ' +
      'rather than drop to zero, which would draw pure waste as the most ' +
      'efficient day on the chart.',
    message: assistant([
      toolPart({
        type: 'tool-render-chart',
        input: { title: 'Spend vs ACOS' },
        output: {
          success: true,
          chart: {
            title: 'Spend vs ACOS — Sponsored Products',
            // A time axis: days are ordered, so joining them is a real claim.
            xKind: 'time',
            caption:
              'Jul 1–8 2026, US profile, 14d attribution window. All 12 ' +
              'enabled campaigns.',
            currencyCode: 'USD',
            series: [
              { label: 'Spend', render: 'bar', format: 'currency' },
              {
                label: 'ACOS',
                render: 'line',
                format: 'percent',
                axis: 'right',
              },
            ],
            points: [
              { label: 'Jul 1', values: [120.5, 0.22] },
              { label: 'Jul 2', values: [98.25, 0.31] },
              { label: 'Jul 3', values: [143.8, 0.19] },
              { label: 'Jul 4', values: [86.4, null] },
              { label: 'Jul 5', values: [0, null] },
              { label: 'Jul 6', values: [151.2, 0.27] },
              { label: 'Jul 7', values: [133.65, 0.24] },
              { label: 'Jul 8', values: [110.900001, 0.29] },
            ],
          },
        },
      }),
      text(
        'Spend held steady through the week while ACOS drifted up on Jul 2 ' +
          'and Jul 6. Jul 5 spent nothing, and Jul 4–5 have no ACOS at all — ' +
          'spend with no attributed sales.'
      ),
    ]),
  },
  {
    id: 'chart-bar-acos-by-campaign',
    title: 'Bar chart with real campaign names',
    note:
      'Amazon campaign names are long. Twelve of them under vertical bars ' +
      'overlap into an unreadable band, so the layout flips sideways on its ' +
      'own — the model has no say in orientation.',
    message: assistant([
      toolPart({
        type: 'tool-render-chart',
        input: { title: 'ACOS by campaign' },
        output: {
          success: true,
          chart: {
            title: 'ACOS by campaign',
            xKind: 'category',
            caption:
              'Last 30 days, 14d attribution. Top 10 of 137 campaigns by ' +
              'spend — this is not the whole account.',
            series: [{ label: 'ACOS', render: 'bar', format: 'percent' }],
            points: [
              { label: 'SP | Brand Defense | Exact', values: [0.18] },
              { label: 'SP | Auto | Discovery', values: [0.62] },
              { label: 'SP | Competitor ASINs | Product', values: [0.44] },
              { label: 'SP | Category | Broad', values: [0.51] },
              { label: 'SP | Long Tail | Phrase', values: [0.29] },
              { label: 'SP | Retargeting | Views', values: [0.37] },
              { label: 'SP | Seasonal Q3 | Exact', values: [0.22] },
              { label: 'SP | New Launch | Auto', values: [0.78] },
              { label: 'SP | Bestseller | Exact', values: [0.15] },
              { label: 'SP | Clearance | Broad', values: [0.83] },
            ],
          },
        },
      }),
    ]),
  },
  {
    id: 'chart-combo-many-campaigns',
    title: 'Combo chart over a dozen long campaign names',
    note:
      'The shape the first real chart took: bars plus a line, so the sideways ' +
      'rule declines it — and then the axis silently thinned twelve names down ' +
      'to six, leaving bars the prose referred to and the reader could not ' +
      'find. Every category now keeps a tilted, elided label; the full name is ' +
      'still on the tooltip.',
    message: assistant([
      toolPart({
        type: 'tool-render-chart',
        input: { title: 'Spend vs Sales by campaign' },
        output: {
          success: true,
          chart: {
            title: 'Spend vs. Sales by Campaign (Top 12 by Spend)',
            // Campaigns have no order, so ACOS is points — a line here would
            // change shape purely by re-sorting the list.
            xKind: 'category',
            caption:
              'Jul 15 – Aug 13 2026 (30 days), 14-day attribution. Top 12 by ' +
              'spend, excluding Camping Mug and Gran del Val (different ' +
              'product lines). Null ACOS = spend with no attributed sales.',
            currencyCode: 'USD',
            series: [
              { label: 'Spend', render: 'bar', format: 'currency' },
              { label: 'Sales', render: 'bar', format: 'currency' },
              {
                label: 'ACOS',
                render: 'point',
                format: 'percent',
                axis: 'right',
              },
            ],
            points: [
              { label: 'Auto - Triple Wall Cups', values: [483, 1327, 0.36] },
              { label: 'SP- Phrase Camping Mug', values: [1002, 2044, 0.49] },
              { label: 'Broad - coffee press', values: [268, 352, 0.76] },
              { label: 'Exact 2 - coffee press', values: [210, 305, 0.69] },
              { label: 'E/P/B - insulated cups', values: [188, 308, 0.61] },
              { label: 'PATA 1 - Insulated Cup', values: [96, 214, 0.45] },
              { label: 'Phrase - 15oz Press', values: [64, 492, 0.13] },
              { label: 'Auto (All) - Tumbler', values: [88, 119, 0.74] },
              { label: 'B/P/E - SKW - teapot', values: [79, 63, 1.27] },
              { label: 'Exact - 500pk cups', values: [33, 21, 1.58] },
              { label: 'Broad Modifier - Tea Pot', values: [41, 58, 0.71] },
              // Live today: impressions but no clicks, so no ACOS at all.
              { label: 'New 500PK Cups - Auto', values: [4, null, null] },
            ],
          },
        },
      }),
    ]),
  },
  {
    id: 'chart-isolated-point',
    title: 'A line value stranded between two gaps',
    note:
      'Campaign 3 is the ONLY one with an ACOS — its neighbours are spend ' +
      'with no attributed sales. A line segment needs two points, so a lone ' +
      'value has nothing to connect to and, without a dot, draws nothing at ' +
      'all. The chart would then under-report: a real figure rendered as ' +
      'absent, indistinguishable from the nulls around it.',
    message: assistant([
      toolPart({
        type: 'tool-render-chart',
        input: { title: 'Isolated ACOS' },
        output: {
          success: true,
          chart: {
            title: 'Spend vs ACOS — mostly unattributed',
            xKind: 'category',
            caption:
              'Jul 15 – Aug 13 2026, 14-day attribution. Null ACOS = spend ' +
              'with no attributed sales.',
            currencyCode: 'USD',
            series: [
              { label: 'Spend', render: 'bar', format: 'currency' },
              {
                label: 'ACOS',
                render: 'point',
                format: 'percent',
                axis: 'right',
              },
            ],
            points: [
              { label: 'Broad Modifier - Tea Pot', values: [5.1, null] },
              { label: 'SP - PATA - Dec 3', values: [8.4, null] },
              { label: 'SP - Auto - Dec 3', values: [28.0, 1.4] },
              { label: 'PATA 2 - Dec 3', values: [5.2, null] },
              { label: 'PATA 1 - Dec 3', values: [1.1, null] },
            ],
          },
        },
      }),
    ]),
  },
  {
    id: 'chart-invalid',
    title: 'A chart spec that no longer parses',
    note:
      'Tool output survives storage and comes back later. A spec that fails ' +
      'validation must fall back to the plain tool card — one bad historical ' +
      'chart cannot be allowed to throw inside the message list and take the ' +
      'whole conversation down with it.',
    message: assistant([
      toolPart({
        type: 'tool-render-chart',
        input: { title: 'Broken' },
        output: {
          success: true,
          // Two series, one value per point: the arity rule rejects this.
          chart: {
            title: 'Mismatched',
            xKind: 'category',
            caption: 'Should not render',
            series: [
              { label: 'Spend', render: 'bar', format: 'count' },
              { label: 'Sales', render: 'bar', format: 'count' },
            ],
            points: [
              { label: 'Jul 1', values: [1] },
              { label: 'Jul 2', values: [2] },
            ],
          },
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
