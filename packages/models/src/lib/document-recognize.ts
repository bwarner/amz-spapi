/**
 * Recognise what an uploaded file IS, so the right handler can take it.
 *
 * Three stages, deliberately independent: store the file, recognise it, then
 * handle it. Recognition failing must never mean losing the file — an
 * unrecognised upload is stored and flagged, not rejected.
 *
 * Recognition is deterministic keyword and structure matching, not a model
 * call: classification runs on every upload, must be repeatable, and costs
 * nothing. The model earns its keep later, on extraction, where judgment is
 * actually required.
 *
 * Text is an INPUT here rather than something this module extracts. Plain text
 * and CSV arrive decoded already; PDFs need an extractor upstream. Keeping that
 * boundary means recognition is testable without a PDF stack.
 */

export type RecognisedKind =
  /** Tabular Amazon export — hand to the report parser. */
  | 'amazon-report'
  | 'commercial-invoice'
  /**
   * The seller's OWN order to a supplier. Shares almost all of an invoice's
   * table vocabulary — description, unit price, subtotal, total — which is why
   * it needs its own matcher: without one, every PO scored as a
   * commercial-invoice at threshold with nothing else in the running, and the
   * misfile arrived with "confidence 1.00" attached.
   */
  | 'purchase-order'
  | 'receipt'
  | 'proof-of-delivery'
  | 'transport-document'
  | 'customs-declaration'
  | 'packing-list'
  /**
   * Amazon's own box label for an FBA shipment. Carries the FBA shipment id,
   * destination FC, SKU and quantity — which is the SHIPPED side of
   * reconciliation, available with no API role at all.
   */
  | 'fba-box-label'
  /** FNSKU barcode label for a unit. Maps FNSKU to product. */
  | 'fnsku-label'
  /** Packaging or label artwork — a versioned asset, not a cost document. */
  | 'design-artwork'
  /**
   * A tabular file that is not a recognised Amazon report. Never produced by
   * the matchers — they read paper vocabulary, and running them over CSV text
   * once scored a campaign export 0.13 "unknown, needs confirmation" because
   * it contained the word "total". The import route assigns this kind
   * directly for spreadsheet containers instead of asking the matchers.
   */
  | 'spreadsheet'
  /** Stored, but nobody knows what it is yet. */
  | 'unknown';

export type RecognitionSignal = {
  /** Human-readable reason, so a wrong guess can be argued with. */
  reason: string;
  weight: number;
};

export type Recognition = {
  kind: RecognisedKind;
  confidence: number;
  signals: RecognitionSignal[];
  /** Runners-up, for offering the user a choice instead of a dead end. */
  alternatives: Array<{ kind: RecognisedKind; score: number }>;
  /** True when the file was stored but could not be classified. */
  needsUserChoice: boolean;
};

type Matcher = {
  kind: RecognisedKind;
  /**
   * Phrases that, taken together, identify the document. Matched against
   * lower-cased text, so they must be lower case here.
   */
  phrases: Array<{ text: string; weight: number }>;
  /** Structural patterns worth as much as a phrase — ids, codes. */
  patterns?: Array<{ regex: RegExp; weight: number; label: string }>;
  /**
   * At least one of these must be present for the matcher to fire at all.
   *
   * Needed because an id is evidence a document CONCERNS something, not that it
   * IS that thing: a 16-page claim about shipment FBA19CBC1Q88 quotes the same
   * id a box label carries, and scored as a box label until this existed.
   */
  requires?: string[];
  /**
   * Longest text this matcher can apply to. Labels are physically small; a
   * document with pages of prose is not one however many ids it quotes.
   */
  maxTextLength?: number;
  /** Any of these present rules the matcher out entirely. */
  disqualifiers?: string[];
};

/**
 * Weights encode precedence between overlapping documents. A DHL POD says both
 * "proof of delivery" AND "waybill number", so the POD phrase has to outweigh
 * the waybill one or every POD would be filed as a transport document — which
 * would double-count its weight in freight allocation.
 */
const MATCHERS: Matcher[] = [
  {
    // Checked before the paperwork matchers: a box label mentions ship-to and
    // quantities and would otherwise score as a packing list.
    kind: 'fba-box-label',
    phrases: [
      { text: 'please leave this label uncovered', weight: 8 },
      { text: 'single sku', weight: 5 },
      { text: 'ship from', weight: 2 },
      { text: 'ship to', weight: 2 },
      { text: 'fba box', weight: 6 },
    ],
    patterns: [
      // Amazon's shipment id, the join key to inbound shipments and to the
      // ledger's reference-id on Receipts events.
      { regex: /\bFBA[0-9A-Z]{8,}\b/i, weight: 8, label: 'FBA shipment id' },
    ],
    requires: [
      'please leave this label uncovered',
      'single sku',
      'fba box',
      'ship from',
    ],
    // A box label never calls itself a purchase order; a PO shipping to FBA
    // routinely carries ship-from/ship-to blocks and an FBA reference, and
    // scored 10 as a box label on exactly that.
    disqualifiers: ['purchase order'],
    maxTextLength: 4000,
  },
  {
    kind: 'fnsku-label',
    phrases: [{ text: 'new -', weight: 2 }],
    patterns: [{ regex: /\bX00[0-9A-Z]{7}\b/, weight: 9, label: 'FNSKU' }],
    // A full paperwork document that happens to quote an FNSKU is not a label.
    disqualifiers: ['invoice', 'subtotal', 'amount paid', 'proof of delivery'],
    // An FNSKU label is a barcode and two lines of text; nothing longer.
    maxTextLength: 400,
  },
  {
    kind: 'proof-of-delivery',
    phrases: [
      { text: 'proof of delivery', weight: 10 },
      { text: 'statement of final status', weight: 6 },
      { text: 'shipment status', weight: 3 },
      { text: 'receiver name', weight: 3 },
      { text: 'was delivered on', weight: 5 },
      { text: 'signed', weight: 1 },
    ],
  },
  {
    kind: 'transport-document',
    phrases: [
      { text: 'waybill', weight: 4 },
      { text: 'air waybill', weight: 5 },
      { text: 'bill of lading', weight: 8 },
      { text: 'number of pieces', weight: 3 },
      { text: 'chargeable weight', weight: 4 },
      { text: 'shipper name', weight: 2 },
      { text: 'consignee', weight: 3 },
    ],
    // A POD is about the same consignment but is not the carriage contract.
    disqualifiers: ['proof of delivery', 'statement of final status'],
  },
  {
    kind: 'receipt',
    phrases: [
      { text: 'receipt', weight: 5 },
      { text: 'receipt number', weight: 4 },
      { text: 'amount paid', weight: 5 },
      { text: 'payment history', weight: 4 },
      { text: 'payment method', weight: 3 },
      { text: 'paid on', weight: 3 },
    ],
  },
  {
    kind: 'purchase-order',
    phrases: [
      // The heading is the identity. Weighted so a document HEADED "purchase
      // order" beats its own invoice-like table below — but low enough that a
      // real invoice merely CITING its PO ("your order: PO-1043") keeps the
      // invoice matcher ahead and, at worst, surfaces this as an alternative.
      { text: 'purchase order', weight: 8 },
      { text: 'po number', weight: 3 },
      { text: 'payment terms', weight: 2 },
      { text: 'buyer', weight: 2 },
      { text: 'vendor', weight: 2 },
      { text: 'issue date', weight: 1 },
    ],
    patterns: [
      { regex: /\bPO[-\s]?\d{2,}/i, weight: 3, label: 'PO number' },
      // The HEADING is identity in a way body phrases are not. A real PO
      // opened with the words "PURCHASE ORDER" and still came back unknown at
      // 0.27: its body legitimately said "packing list" (an instruction to
      // the supplier), listed cartons and weights, and carried ship-to blocks
      // — so three other matchers scored nearly as high and diluted the share
      // below the threshold. Body vocabulary is circumstantial; the title the
      // document gives ITSELF is not, and only a position-anchored pattern
      // can see the difference.
      {
        regex: /^[\s"']{0,10}purchase\s*order/i,
        weight: 10,
        label: 'headed "purchase order"',
      },
    ],
    // A PO never records money already moved; a document that does is the
    // paper trail of a transaction, not an instruction to start one.
    disqualifiers: ['amount paid', 'payment history', 'proof of delivery'],
  },
  {
    kind: 'commercial-invoice',
    phrases: [
      { text: 'invoice', weight: 5 },
      { text: 'factura', weight: 5 },
      { text: 'descripción', weight: 3 },
      { text: 'description', weight: 1 },
      { text: 'unit price', weight: 3 },
      { text: 'unitario', weight: 3 },
      { text: 'sub total', weight: 3 },
      { text: 'subtotal', weight: 3 },
      { text: 'total', weight: 1 },
      { text: 'qty', weight: 2 },
    ],
    // "Invoice number" appears on receipts too; an explicit receipt wins.
    disqualifiers: ['payment history', 'proof of delivery'],
  },
  {
    kind: 'customs-declaration',
    phrases: [
      { text: 'customs declaration', weight: 10 },
      { text: 'commercial invoice for customs', weight: 8 },
      { text: 'hs code', weight: 5 },
      { text: 'harmonized', weight: 5 },
      { text: 'country of origin', weight: 3 },
      { text: 'declared value', weight: 3 },
    ],
  },
  {
    kind: 'packing-list',
    phrases: [
      { text: 'packing list', weight: 10 },
      { text: 'carton', weight: 3 },
      { text: 'net weight', weight: 2 },
      { text: 'gross weight', weight: 2 },
    ],
  },
];

/** Design files that never carry meaningful text. */
const ARTWORK_EXTENSIONS = new Set(['ai', 'eps', 'psd', 'indd', 'sketch']);

/**
 * Vocabulary every piece of paperwork has and no artwork does.
 *
 * Text LENGTH is not the signal — a real box label extracted 423 characters of
 * brand copy, roast notes and weights, sailing past a length ceiling and coming
 * back "unknown". What actually separates them is that paperwork always talks
 * about money or quantities owed, and a label never does.
 */
const PAPERWORK_VOCABULARY = [
  'invoice',
  'receipt',
  'total',
  'subtotal',
  'sub total',
  'amount',
  'qty',
  'quantity',
  'unit price',
  'unitario',
  'factura',
  'paid',
  'payment',
  'waybill',
  'shipment',
  'delivered',
  'consignee',
  'packing list',
  'usd',
  '$',
];

/** Total phrase weight a matcher needs before it may claim a document. */
const RECOGNITION_THRESHOLD = 8;

/**
 * Longest text the artwork fallback will apply to.
 *
 * Distinct from the ceiling once used to RECOGNISE a box label, which was wrong
 * because a real label carries 400+ characters of copy — that job belongs to
 * the matcher's `requires`. This bound exists because prose without money words
 * is a document we cannot place, not a picture: a 23-page agency report should
 * come back unknown and be asked about, never filed as packaging artwork.
 */
const ARTWORK_FALLBACK_MAX_LENGTH = 1200;

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function recognizeDocument(params: {
  fileName: string;
  mimeType?: string;
  /** Decoded text, when available. Absent for PDFs with no extractor. */
  text?: string;
  /** Result of the tabular report detector, when the file was tabular. */
  reportKind?: string | null;
  /**
   * Set when extraction returned nothing usable — a scanned page or artwork.
   * Distinguishes "we read it and could not tell" from "there was nothing to
   * read", which need different remedies (ask the user vs OCR).
   */
  noExtractableText?: boolean;
}): Recognition {
  const signals: RecognitionSignal[] = [];
  const extension = extensionOf(params.fileName);

  // A recognised Amazon report is decided by column headers upstream, and that
  // evidence is far stronger than any keyword.
  if (params.reportKind) {
    return {
      kind: 'amazon-report',
      confidence: 1,
      signals: [
        { reason: `column headers match ${params.reportKind}`, weight: 10 },
      ],
      alternatives: [],
      needsUserChoice: false,
    };
  }

  if (ARTWORK_EXTENSIONS.has(extension)) {
    return {
      kind: 'design-artwork',
      confidence: 1,
      signals: [{ reason: `.${extension} is a design file`, weight: 10 }],
      alternatives: [],
      needsUserChoice: false,
    };
  }

  const text = (params.text ?? '').toLowerCase();

  // No text at all: we know nothing. Do not guess from the filename — "BF
  // Warner april 2026.pdf" is dated January inside, which is exactly why
  // filenames get no vote.
  if (!text.trim()) {
    return {
      kind: 'unknown',
      confidence: 0,
      signals: [
        {
          reason: params.noExtractableText
            ? 'no extractable text — scanned image or artwork, needs OCR or a ' +
              'visual read rather than classification'
            : 'no readable text',
          weight: 0,
        },
      ],
      alternatives: [],
      needsUserChoice: true,
    };
  }

  const scores = MATCHERS.map((matcher) => {
    if (matcher.disqualifiers?.some((phrase) => text.includes(phrase))) {
      return { kind: matcher.kind, score: 0, hits: [] as RecognitionSignal[] };
    }
    if (matcher.maxTextLength && text.length > matcher.maxTextLength) {
      return { kind: matcher.kind, score: 0, hits: [] as RecognitionSignal[] };
    }
    if (matcher.requires && !matcher.requires.some((p) => text.includes(p))) {
      return { kind: matcher.kind, score: 0, hits: [] as RecognitionSignal[] };
    }
    const hits = matcher.phrases
      .filter((phrase) => text.includes(phrase.text))
      .map((phrase) => ({
        reason: `contains "${phrase.text}"`,
        weight: phrase.weight,
      }));
    for (const pattern of matcher.patterns ?? []) {
      // Patterns run against the ORIGINAL case: ids and codes are upper case
      // and lower-casing them loses the signal.
      const match = (params.text ?? '').match(pattern.regex);
      if (match) {
        hits.push({
          reason: `${pattern.label} "${match[0]}"`,
          weight: pattern.weight,
        });
      }
    }
    return {
      kind: matcher.kind,
      score: hits.reduce((total, hit) => total + hit.weight, 0),
      hits,
    };
  }).sort((a, b) => b.score - a.score);

  const best = scores[0];

  // No paperwork vocabulary anywhere: this is not a document about money or
  // goods owed, so artwork is the better guess than "unknown".
  const paperworkHits = PAPERWORK_VOCABULARY.filter((term) =>
    text.includes(term)
  );
  if (
    best.score < RECOGNITION_THRESHOLD &&
    paperworkHits.length === 0 &&
    text.length <= ARTWORK_FALLBACK_MAX_LENGTH
  ) {
    return {
      kind: 'design-artwork',
      confidence: 0.6,
      signals: [
        {
          reason:
            `${text.length} characters of text with no invoice, payment or ` +
            'shipping vocabulary',
          weight: 5,
        },
      ],
      alternatives: [],
      needsUserChoice: true,
    };
  }

  // Share of the evidence the winner holds, so a document matching two matchers
  // equally well is honestly reported as uncertain.
  const total = scores.reduce((sum, entry) => sum + entry.score, 0);
  const share = total ? best.score / total : 0;
  signals.push(...best.hits);

  const recognised = best.score >= RECOGNITION_THRESHOLD && share >= 0.4;
  // When nothing was recognised, report how CLOSE we came rather than the
  // winner's share — a bare "unknown, confidence 1.00" is a contradiction.
  const confidence = recognised
    ? share
    : Math.min(best.score / RECOGNITION_THRESHOLD, 0.99) * share;
  return {
    kind: recognised ? best.kind : 'unknown',
    confidence: Math.round(confidence * 100) / 100,
    signals,
    alternatives: scores
      .slice(1)
      .filter((entry) => entry.score > 0)
      .slice(0, 3)
      .map((entry) => ({ kind: entry.kind, score: entry.score })),
    needsUserChoice: !recognised,
  };
}
