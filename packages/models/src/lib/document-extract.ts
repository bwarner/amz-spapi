import { z } from 'zod';

/**
 * Extracted business documents (supplier invoices, receipts, freight bills).
 *
 * A model reading an invoice will occasionally drop a digit, mis-read a date
 * format, or merge two similar line items. None of that is acceptable in a
 * number that becomes your cost of goods, so every extraction is CHECKED
 * arithmetically before it is trusted: line maths, totals, and date ambiguity.
 * Anything that fails is surfaced for confirmation rather than silently stored.
 *
 * This is the same discipline as measuring an image's bounding box instead of
 * letting the model guess it — the model is good at reading, arithmetic is
 * better at verifying.
 */

/** What a line item IS, which decides how its cost is allocated. */
export const LineKindSchema = z.enum([
  /** Goods — allocates per unit to a SKU. */
  'product',
  /** Freight/shipping — allocates across a shipment's units. */
  'freight',
  /** Duty, customs, inspection, bank fees — allocates like freight. */
  'fee',
  /** Discount or credit; negative contribution. */
  'discount',
  /** Software, services, retainers — business overhead, never per-SKU. */
  'overhead',
]);
export type LineKind = z.infer<typeof LineKindSchema>;

export const ExtractedLineSchema = z.object({
  description: z.string().min(1),
  kind: LineKindSchema,
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  amount: z.number(),
  /** Supplier's own part/SKU code when the document carries one. */
  supplierRef: z.string().optional(),
  /** Weight or volume when stated — the honest basis for freight allocation. */
  weightKg: z.number().optional(),
  /** For subscriptions and retainers: the span the charge covers. */
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});
export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;

export const ExtractedDocumentSchema = z.object({
  documentType: z.enum(['invoice', 'receipt', 'credit-note', 'other']),
  vendorName: z.string().min(1),
  vendorTaxId: z.string().optional(),
  billedTo: z.string().optional(),
  /** ISO date. Ambiguous source formats are flagged, not guessed. */
  documentDate: z.string().optional(),
  /** Exactly as printed, so an ambiguous format can be re-checked. */
  documentDateRaw: z.string().optional(),
  invoiceNumber: z.string().optional(),
  receiptNumber: z.string().optional(),
  currency: z.string().length(3),
  lines: z.array(ExtractedLineSchema).min(1),
  subtotal: z.number().optional(),
  tax: z.number().optional(),
  shipping: z.number().optional(),
  total: z.number(),
  amountPaid: z.number().optional(),
  paymentMethod: z.string().optional(),

  /**
   * Transport details. Present on waybills and bills of lading; these are the
   * fields that let freight be split across the goods it actually carried.
   */
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  /** What the carrier BILLED on — the greater of actual and volumetric. */
  chargeableWeightKg: z.number().optional(),
  actualWeightKg: z.number().optional(),
  pieces: z.number().optional(),
  /** Value stated to customs on the waybill; may differ from the invoice. */
  declaredValue: z.number().optional(),

  /** Proof of delivery: what the carrier says happened at the destination. */
  deliveredAt: z.string().optional(),
  /**
   * When the carrier collected it. Distinct from documentDate: a POD is often
   * ISSUED weeks after delivery, so dating a shipment from the document would
   * be badly wrong.
   */
  pickedUpAt: z.string().optional(),
  signedBy: z.string().optional(),
  receiverName: z.string().optional(),
  /** Destination address — how a delivery is matched to an Amazon FC. */
  deliveryLocation: z.string().optional(),
  piecesDelivered: z.number().optional(),
  /** Carrier piece barcodes, distinct from the waybill number. */
  pieceIds: z.array(z.string()).optional(),
  /** Restated on PODs in pounds as well as kilos; kept to cross-check. */
  weightLb: z.number().optional(),
  shipperName: z.string().optional(),
  contentsDescription: z.string().optional(),
});
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

export type ExtractionIssue = {
  code:
    | 'line-math'
    | 'lines-vs-subtotal'
    | 'subtotal-vs-total'
    | 'paid-vs-total'
    | 'ambiguous-date'
    | 'missing-date'
    | 'no-document-number'
    | 'unallocatable-freight';
  severity: 'blocker' | 'review';
  message: string;
  /** Index into `lines` when the issue is line-specific. */
  line?: number;
};

/** Currency rounding: accept a cent of drift per comparison. */
const TOLERANCE = 0.011;

function near(a: number, b: number, tolerance = TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * A date like 06/01/2026 is 6 January or 1 June depending on the writer's
 * locale, and both readings are valid whenever day and month are both <= 12.
 * Guessing silently moves costs into the wrong period, so say so instead.
 */
export function isAmbiguousDate(raw: string): boolean {
  const match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first <= 12 && second <= 12 && first !== second;
}

/**
 * Check an extraction against itself. Returns every problem found; an empty
 * array means the arithmetic is internally consistent — NOT that the reading is
 * correct, only that it is not self-contradictory.
 */
export function validateExtraction(
  document: ExtractedDocument
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  document.lines.forEach((line, index) => {
    if (line.quantity !== undefined && line.unitPrice !== undefined) {
      const expected = line.quantity * line.unitPrice;
      if (!near(expected, line.amount, Math.max(TOLERANCE, expected * 0.001))) {
        issues.push({
          code: 'line-math',
          severity: 'blocker',
          line: index,
          message:
            `"${line.description}": ${line.quantity} x ${line.unitPrice} = ` +
            `${expected.toFixed(2)}, but the line reads ${line.amount.toFixed(
              2
            )}.`,
        });
      }
    }
  });

  const lineSum = document.lines.reduce(
    (total, line) => total + line.amount,
    0
  );
  const subtotal = document.subtotal ?? lineSum;
  if (
    document.subtotal !== undefined &&
    !near(lineSum, document.subtotal, 0.02)
  ) {
    issues.push({
      code: 'lines-vs-subtotal',
      severity: 'blocker',
      message:
        `Line items total ${lineSum.toFixed(2)} but the subtotal reads ` +
        `${document.subtotal.toFixed(
          2
        )} — a line was probably missed or double read.`,
    });
  }

  const computedTotal =
    subtotal + (document.tax ?? 0) + (document.shipping ?? 0);
  if (!near(computedTotal, document.total, 0.02)) {
    issues.push({
      code: 'subtotal-vs-total',
      severity: 'blocker',
      message:
        `Subtotal plus tax and shipping is ${computedTotal.toFixed(
          2
        )} but the ` + `total reads ${document.total.toFixed(2)}.`,
    });
  }

  if (
    document.amountPaid !== undefined &&
    !near(document.amountPaid, document.total, 0.02)
  ) {
    issues.push({
      code: 'paid-vs-total',
      severity: 'review',
      message:
        `Amount paid ${document.amountPaid.toFixed(
          2
        )} differs from the total ` +
        `${document.total.toFixed(2)} — a partial payment or a deposit?`,
    });
  }

  if (!document.documentDate) {
    issues.push({
      code: 'missing-date',
      severity: 'review',
      message: 'No document date was read; costs cannot be placed in a period.',
    });
  } else if (
    document.documentDateRaw &&
    isAmbiguousDate(document.documentDateRaw)
  ) {
    issues.push({
      code: 'ambiguous-date',
      severity: 'review',
      message:
        `"${document.documentDateRaw}" is ambiguous — day/month order differs ` +
        `by locale. Read as ${document.documentDate}; confirm before using it ` +
        'to date these costs.',
    });
  }

  if (!document.invoiceNumber && !document.receiptNumber) {
    issues.push({
      code: 'no-document-number',
      severity: 'review',
      message:
        'No invoice or receipt number, so re-uploads can only be detected by ' +
        'file content — the same invoice sent twice in different formats would ' +
        'be counted twice.',
    });
  }

  // Freight can only be allocated per unit if SOMETHING says which goods it
  // carried. Weights are the usual tell; without them the split is a guess.
  const freight = document.lines.filter(
    (line) => line.kind === 'freight' || line.kind === 'fee'
  );
  const products = document.lines.filter((line) => line.kind === 'product');
  if (freight.length > 1 && products.length > 1) {
    const anyWeights = document.lines.some(
      (line) => line.weightKg !== undefined
    );
    if (!anyWeights) {
      issues.push({
        code: 'unallocatable-freight',
        severity: 'review',
        message:
          `${freight.length} freight/fee lines cover ${products.length} product ` +
          'lines and nothing states which goods each shipment carried. Confirm ' +
          'the split — allocating by unit count instead of weight can change ' +
          'landed unit cost several-fold.',
      });
    }
  }

  return issues;
}

/** Convenience: does this extraction need a human before it can be trusted? */
export function needsReview(issues: ExtractionIssue[]): boolean {
  return issues.length > 0;
}

/**
 * What a document IS within a purchase, which decides whether it contributes
 * cost or merely evidences it.
 *
 * Suppliers routinely issue more than one document for one order — an Alibaba
 * order record with one set of figures, then a separate invoice with the real
 * items and prices. Both are worth keeping, but only ONE can be the cost basis;
 * summing them silently doubles cost of goods.
 */
export const DocumentRoleSchema = z.enum([
  /** The authoritative statement of what was bought and for how much. */
  'commercial-invoice',
  /** A quote or pro-forma issued before the goods shipped. */
  'proforma',
  /** Proof that money moved: Alibaba order record, bank transfer, card receipt. */
  'payment-record',
  /** Value declared to customs; may differ from the commercial invoice. */
  'customs-declaration',
  /** Carrier's own bill, when freight is invoiced separately. */
  'freight-invoice',
  /**
   * Contract of carriage — a DHL/FedEx air waybill, bill of lading, courier
   * receipt. Bills NOTHING: when the supplier already charged the freight as a
   * line item, costing a waybill too would double it. Its value is the
   * chargeable weight, tracking number and declared value, which are what make
   * freight allocable across the goods it carried.
   */
  'transport-document',
  /**
   * Carrier's confirmation that the goods arrived: date, time, who signed,
   * where. A real DHL POD DOES restate weight, pieces and contents — which is
   * exactly why it cannot be filed as a transport document: it describes the
   * SAME consignment as the waybill, so counting both would double the weight
   * and skew freight allocation. Its job is evidence — it proves delivery
   * happened when Amazon says fewer units arrived than were shipped.
   */
  'proof-of-delivery',
  'packing-list',
  'other',
]);
export type DocumentRole = z.infer<typeof DocumentRoleSchema>;

export type PurchaseDocument = {
  documentId: string;
  role: DocumentRole;
  extracted: ExtractedDocument;
};

/**
 * Which role answers which question about a purchase.
 *
 * The same shape as `LEDGER_AUTHORITY` in sp-cache, for the same reason: when
 * two documents describe the same goods, the defence against counting both is
 * naming which one is authoritative for each question, once, in a place callers
 * can read. An Alibaba order receipt and the invoice the supplier sends
 * afterwards both state a total; only one of them is the cost.
 */
export const PURCHASE_AUTHORITY = {
  /** What was bought, and what it cost. */
  cost: 'commercial-invoice',
  /** What money actually moved — never what the goods cost. */
  payment: 'payment-record',
  /** What the consignment weighed, which is what makes freight allocable. */
  weight: 'transport-document',
  /** Whether the goods arrived, and how many pieces. */
  delivery: 'proof-of-delivery',
  /** What was declared to customs, which duty is charged on. */
  declaredValue: 'customs-declaration',
} as const;

/** How two documents came to be treated as one purchase. */
export type PurchaseJoin = {
  /** The shared identifier that made the join. */
  on: 'invoice-number' | 'receipt-number' | 'tracking-number' | 'piece-id';
  value: string;
  documentIds: string[];
};

/**
 * Documents that look related but were NOT joined, because the only thing they
 * share is a vendor and a nearby date. Offered for a human to confirm.
 */
export type PurchaseSuggestion = {
  documentIds: string[];
  vendorName: string;
  daysApart: number;
  reason: string;
};

export type PurchaseGroup = {
  /** Stable across runs: the lowest document id in the group. */
  purchaseId: string;
  documentIds: string[];
  joins: PurchaseJoin[];
};

export type PurchaseGrouping = {
  purchases: PurchaseGroup[];
  suggestions: PurchaseSuggestion[];
};

/** Identifiers that are strong enough to merge two documents on. */
function joinKeys(
  document: PurchaseDocument
): Array<[PurchaseJoin['on'], string]> {
  const keys: Array<[PurchaseJoin['on'], string]> = [];
  const normalise = (value: string) => value.trim().toUpperCase();

  const { invoiceNumber, receiptNumber, trackingNumber, pieceIds } =
    document.extracted;

  if (invoiceNumber?.trim())
    keys.push(['invoice-number', normalise(invoiceNumber)]);
  if (receiptNumber?.trim())
    keys.push(['receipt-number', normalise(receiptNumber)]);
  if (trackingNumber?.trim())
    keys.push(['tracking-number', normalise(trackingNumber)]);
  for (const pieceId of pieceIds ?? []) {
    if (pieceId.trim()) keys.push(['piece-id', normalise(pieceId)]);
  }

  return keys;
}

function daysBetween(a?: string, b?: string): number | undefined {
  if (!a || !b) return undefined;
  const from = Date.parse(a);
  const to = Date.parse(b);
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.abs(to - from) / 86_400_000;
}

/**
 * Group documents into purchases on shared identifiers only.
 *
 * Deliberately conservative. Merging on a weak signal — same supplier, dates a
 * few days apart — would put two purchases in one group, and then one invoice
 * becomes the cost basis for goods it never covered while the other invoice is
 * demoted to a duplicate. That is the same double-count this module exists to
 * prevent, arrived at from the other direction, and it is silent. Weak matches
 * come back as `suggestions` for a human instead.
 *
 * A proof of delivery joins its waybill on the tracking number, which is what
 * keeps the pair together without their weights ever being added: the POD is
 * evidence, and `PURCHASE_AUTHORITY.weight` names the waybill as the source.
 */
export function groupPurchaseDocuments(
  documents: PurchaseDocument[]
): PurchaseGrouping {
  const parent = new Map<string, string>();
  for (const document of documents)
    parent.set(document.documentId, document.documentId);

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    // Path compression keeps repeated lookups cheap on long chains.
    let walk = id;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk) as string;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB)
      parent.set(rootA < rootB ? rootB : rootA, rootA < rootB ? rootA : rootB);
  };

  // One pass per identifier: every document sharing it lands in one group.
  const byKey = new Map<string, { on: PurchaseJoin['on']; ids: string[] }>();
  for (const document of documents) {
    for (const [on, value] of joinKeys(document)) {
      const key = `${on}:${value}`;
      const bucket = byKey.get(key) ?? { on, ids: [] };
      if (!bucket.ids.includes(document.documentId))
        bucket.ids.push(document.documentId);
      byKey.set(key, bucket);
    }
  }

  const joins: PurchaseJoin[] = [];
  for (const [key, bucket] of byKey) {
    if (bucket.ids.length < 2) continue;
    joins.push({
      on: bucket.on,
      value: key.slice(key.indexOf(':') + 1),
      documentIds: [...bucket.ids].sort(),
    });
    for (const id of bucket.ids.slice(1)) union(bucket.ids[0], id);
  }

  const grouped = new Map<string, string[]>();
  for (const document of documents) {
    const root = find(document.documentId);
    grouped.set(root, [...(grouped.get(root) ?? []), document.documentId]);
  }

  const purchases: PurchaseGroup[] = [...grouped.entries()]
    .map(([root, ids]) => ({
      purchaseId: root,
      documentIds: [...ids].sort(),
      joins: joins.filter((join) =>
        join.documentIds.some((id) => find(id) === root)
      ),
    }))
    .sort((a, b) => a.purchaseId.localeCompare(b.purchaseId));

  // Weak matches across DIFFERENT groups, surfaced rather than applied.
  const suggestions: PurchaseSuggestion[] = [];
  const SUGGEST_WITHIN_DAYS = 14;
  for (let i = 0; i < documents.length; i += 1) {
    for (let j = i + 1; j < documents.length; j += 1) {
      const a = documents[i];
      const b = documents[j];
      if (find(a.documentId) === find(b.documentId)) continue;
      if (
        a.extracted.vendorName.trim().toUpperCase() !==
        b.extracted.vendorName.trim().toUpperCase()
      )
        continue;
      const apart = daysBetween(
        a.extracted.documentDate,
        b.extracted.documentDate
      );
      if (apart === undefined || apart > SUGGEST_WITHIN_DAYS) continue;
      suggestions.push({
        documentIds: [a.documentId, b.documentId].sort(),
        vendorName: a.extracted.vendorName,
        daysApart: Math.round(apart),
        reason:
          `Same supplier, ${Math.round(apart)} day(s) apart, but no shared ` +
          'invoice, receipt or tracking number. Confirm before treating these ' +
          'as one purchase — grouping them makes one invoice the cost basis ' +
          'for both.',
      });
    }
  }

  return { purchases, suggestions };
}

export type PurchaseReconciliation = {
  /** Document whose lines become cost of goods. */
  costBasisDocumentId?: string;
  cogsTotal: number;
  /** Sum of payment-record documents. */
  paidTotal: number;
  currency?: string;
  issues: ReconciliationIssue[];
};

/** Purchase-level findings, kept separate from single-document issues. */
/**
 * A disagreement between the documents attached to ONE purchase. Distinct from
 * ExtractionIssue, which is about whether a single document was read correctly.
 */
export type ReconciliationIssue = {
  code:
    | 'no-cost-basis'
    | 'multiple-cost-basis'
    | 'value-mismatch'
    | 'payment-shortfall'
    | 'currency-mismatch';
  severity: 'blocker' | 'review';
  message: string;
};

/**
 * Work out what a purchase actually cost, given every document attached to it.
 *
 * The rule that matters: cost comes from exactly ONE document. Payment records
 * and customs declarations are reconciled AGAINST it and reported when they
 * disagree — a disagreement is normal (deposits, split payments, declared
 * values) and is information, not an error to hide.
 */
export function reconcilePurchase(
  documents: PurchaseDocument[]
): PurchaseReconciliation {
  const issues: ReconciliationIssue[] = [];

  const invoices = documents.filter(
    (document) => document.role === 'commercial-invoice'
  );
  // Fall back to a proforma only when no real invoice exists — better than
  // nothing, but the caller should know the basis is provisional.
  const basisPool = invoices.length
    ? invoices
    : documents.filter((document) => document.role === 'proforma');

  if (basisPool.length > 1) {
    issues.push({
      code: 'multiple-cost-basis',
      severity: 'blocker',
      message:
        `${basisPool.length} invoices are attached to this purchase. Exactly one ` +
        'can be the cost basis — the others are amendments or duplicates. ' +
        'Costs are NOT summed across them.',
    });
  }
  if (!basisPool.length) {
    issues.push({
      code: 'no-cost-basis',
      severity: 'blocker',
      message:
        'No commercial invoice or proforma attached, so there is nothing ' +
        'authoritative to cost this purchase from. A payment record proves an ' +
        'amount moved, not what was bought.',
    });
  }

  const basis = basisPool[0];
  const cogsTotal = basis?.extracted.total ?? 0;
  const currency = basis?.extracted.currency;

  const payments = documents.filter(
    (document) => document.role === 'payment-record'
  );
  const paidTotal = payments.reduce(
    (total, document) =>
      total + (document.extracted.amountPaid ?? document.extracted.total),
    0
  );

  const currencies = new Set(
    documents.map((document) => document.extracted.currency)
  );
  if (currencies.size > 1) {
    issues.push({
      code: 'currency-mismatch',
      severity: 'review',
      message:
        `Documents are in different currencies (${[...currencies].join(
          ', '
        )}). ` +
        'Costs need an FX rate at the payment date before they can be compared.',
    });
  }

  if (basis && payments.length) {
    const delta = paidTotal - cogsTotal;
    if (Math.abs(delta) > 0.02) {
      issues.push({
        code: delta < 0 ? 'payment-shortfall' : 'value-mismatch',
        severity: 'review',
        message:
          `Payments total ${paidTotal.toFixed(2)} against an invoice of ` +
          `${cogsTotal.toFixed(2)} (${delta > 0 ? '+' : ''}${delta.toFixed(
            2
          )}). ` +
          (delta < 0
            ? 'A balance may still be outstanding, or a deposit is missing.'
            : 'An overpayment, an extra charge, or the payment record covers ' +
              'more than this purchase.') +
          ' Cost of goods uses the INVOICE, not the payment.',
      });
    }
  }

  // A waybill's declared value is a customs figure too, and disagreeing with
  // the invoice has the same consequences.
  const declarations = documents.filter(
    (document) =>
      document.role === 'customs-declaration' ||
      document.role === 'transport-document'
  );
  for (const declaration of declarations) {
    const stated =
      declaration.extracted.declaredValue ?? declaration.extracted.total;
    if (stated > 0 && Math.abs(stated - cogsTotal) > 0.02) {
      issues.push({
        code: 'value-mismatch',
        severity: 'review',
        message:
          `${
            declaration.role === 'transport-document'
              ? 'The waybill declares'
              : 'The customs declaration states'
          } ${stated.toFixed(2)} against an invoice of ${cogsTotal.toFixed(
            2
          )}. Duty is charged on ` +
          'the declared value, and a reimbursement claim valued from it would ' +
          'differ from what you actually paid.',
      });
    }
  }

  // Weight stated twice in different units is a free correctness check: read
  // 18.45 lb as kilos and every weight-based allocation is out by 2.2x.
  for (const document of documents) {
    const kg = document.extracted.actualWeightKg;
    const lb = document.extracted.weightLb;
    if (kg && lb && Math.abs(lb / 2.20462 - kg) > 0.05) {
      issues.push({
        code: 'value-mismatch',
        severity: 'review',
        message:
          `Weights disagree: ${lb} lb is ${(lb / 2.20462).toFixed(
            2
          )} kg but the ` +
          `document also states ${kg} kg. One of them was mis-read.`,
      });
    }
  }

  // A POD is only evidence for THIS purchase if it matches a consignment in it.
  const trackedNumbers = new Set(
    documents
      .filter((document) => document.role === 'transport-document')
      .map((document) => document.extracted.trackingNumber)
      .filter(Boolean)
  );
  for (const pod of documents.filter(
    (document) => document.role === 'proof-of-delivery'
  )) {
    const tracking = pod.extracted.trackingNumber;
    if (trackedNumbers.size && tracking && !trackedNumbers.has(tracking)) {
      issues.push({
        code: 'value-mismatch',
        severity: 'review',
        message:
          `Proof of delivery for ${tracking} does not match any waybill on this ` +
          'purchase — it may belong to a different shipment.',
      });
    }
  }

  return {
    costBasisDocumentId: basis?.documentId,
    cogsTotal,
    paidTotal,
    currency,
    issues,
  };
}

export type FreightBasis = {
  /** One entry per transport document that stated a weight. */
  shipments: Array<{
    documentId: string;
    trackingNumber?: string;
    weightKg: number;
  }>;
  totalWeightKg: number;
  /** True when every waybill carries a weight, so a split is measurable. */
  usable: boolean;
};

/**
 * Weights available for splitting freight across goods.
 *
 * This is what turns the `unallocatable-freight` warning into an answer: two
 * DHL waybills at 10kg and 46kg say which consignment was which, and freight
 * follows weight rather than being smeared evenly over unit counts — a
 * difference that moved landed cost by more than 2x on a real invoice.
 */
export function freightAllocationBasis(
  documents: PurchaseDocument[]
): FreightBasis {
  const transport = documents.filter(
    (document) => document.role === 'transport-document'
  );
  const shipments = transport
    .map((document) => ({
      documentId: document.documentId,
      trackingNumber: document.extracted.trackingNumber,
      weightKg:
        document.extracted.chargeableWeightKg ??
        document.extracted.actualWeightKg ??
        0,
    }))
    .filter((shipment) => shipment.weightKg > 0);

  return {
    shipments,
    totalWeightKg: shipments.reduce(
      (total, shipment) => total + shipment.weightKg,
      0
    ),
    usable: transport.length > 0 && shipments.length === transport.length,
  };
}

/**
 * What freight is divided by. There is no default: smearing freight evenly over
 * unit counts when the goods differ in weight moved landed cost by more than 2x
 * on a real invoice, so the basis is a decision the caller states and the output
 * carries.
 */
export type FreightBasisKind = 'weight' | 'units' | 'value';

export type FreightShare = {
  documentId: string;
  /** Index into that document's `lines`. */
  lineIndex: number;
  description: string;
  supplierRef?: string;
  /** Fraction of the freight this line carries, 0..1. */
  share: number;
  /** Currency amount, rounded so the parts sum to the whole exactly. */
  amount: number;
};

export type FreightRefusal = {
  code:
    | 'no-freight'
    | 'no-cost-basis'
    | 'no-goods'
    | 'missing-weights'
    | 'missing-quantities'
    | 'zero-denominator'
    | 'freight-billed-twice';
  message: string;
};

export type FreightAllocation = {
  /** Always stated, so a reader never has to infer how this was split. */
  basis: FreightBasisKind;
  freightTotal: number;
  currency?: string;
  shares: FreightShare[];
  /** Freight that was NOT put on any unit, with the reason in `refusals`. */
  unallocated: number;
  refusals: FreightRefusal[];
};

/** Distribute to the cent so the shares sum to the total exactly. */
function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((running, weight) => running + weight, 0);
  if (sum <= 0) return weights.map(() => 0);

  const cents = Math.round(total * 100);
  const exact = weights.map((weight) => (weight / sum) * cents);
  const floored = exact.map((value) => Math.floor(value));
  let remainder =
    cents - floored.reduce((running, value) => running + value, 0);

  // Largest fractional part first: the conventional tie-break, and it keeps the
  // rounding error off the smallest line.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...floored];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] += 1;
    remainder -= 1;
  }
  return result.map((value) => value / 100);
}

/**
 * Split a purchase's freight across the goods it carried.
 *
 * Freight comes from the cost-basis document's own freight and fee lines —
 * `PURCHASE_AUTHORITY.cost` names that document, and a carrier's separate
 * invoice for the same shipment is reported rather than added, because the
 * supplier having already charged freight is exactly when it gets billed twice.
 *
 * Partial allocation is refused on purpose. If some product lines state a
 * weight and others do not, splitting by weight quietly loads all the freight
 * onto the lines that happened to carry the field, which reads as a real number
 * and is not one. Refusing leaves `unallocated` equal to the freight and says
 * why.
 */
export function allocateFreight(
  documents: PurchaseDocument[],
  basis: FreightBasisKind
): FreightAllocation {
  const refusals: FreightRefusal[] = [];

  const invoices = documents.filter(
    (document) => document.role === PURCHASE_AUTHORITY.cost
  );
  const basisPool = invoices.length
    ? invoices
    : documents.filter((document) => document.role === 'proforma');
  const costBasis = basisPool[0];

  if (!costBasis) {
    return {
      basis,
      freightTotal: 0,
      shares: [],
      unallocated: 0,
      refusals: [
        {
          code: 'no-cost-basis',
          message:
            'No invoice or proforma on this purchase, so there are no goods ' +
            'lines to carry freight and no authority for what freight was ' +
            'charged.',
        },
      ],
    };
  }

  const currency = costBasis.extracted.currency;
  const lines = costBasis.extracted.lines;

  const freightTotal = lines
    .filter((line) => line.kind === 'freight' || line.kind === 'fee')
    .reduce((total, line) => total + line.amount, 0);

  const carrierInvoices = documents.filter(
    (document) => document.role === 'freight-invoice'
  );
  if (carrierInvoices.length && freightTotal > 0) {
    refusals.push({
      code: 'freight-billed-twice',
      message:
        `The supplier charged ${freightTotal.toFixed(
          2
        )} of freight and fees on ` +
        `the invoice, and ${carrierInvoices.length} separate carrier invoice(s) ` +
        'are also attached. Only the invoice is allocated — adding both would ' +
        'charge the same shipment twice. Reclassify one if they are genuinely ' +
        'different charges.',
    });
  }

  // Only goods carry freight. Overhead is business cost and never per-SKU;
  // discounts, freight and fees are not goods.
  const goods = lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter((entry) => entry.line.kind === 'product');

  if (freightTotal <= 0) {
    refusals.push({
      code: 'no-freight',
      message:
        'No freight or fee lines on the cost basis, so there is nothing to ' +
        'allocate. Freight charged on a carrier document that nobody billed ' +
        'you for is not a cost.',
    });
    return {
      basis,
      freightTotal: 0,
      currency,
      shares: [],
      unallocated: 0,
      refusals,
    };
  }

  if (!goods.length) {
    refusals.push({
      code: 'no-goods',
      message:
        'The cost basis has freight but no product lines, so there are no ' +
        'units to carry it.',
    });
    return {
      basis,
      freightTotal,
      currency,
      shares: [],
      unallocated: freightTotal,
      refusals,
    };
  }

  const weightsFor = (): number[] | undefined => {
    if (basis === 'weight') {
      const missing = goods.filter((entry) => !entry.line.weightKg);
      if (missing.length) {
        refusals.push({
          code: 'missing-weights',
          message:
            `${missing.length} of ${goods.length} product lines state no ` +
            'weight, so a weight split would load all the freight onto the ' +
            'lines that do. State the weights, or allocate by units or value.',
        });
        return undefined;
      }
      return goods.map((entry) => entry.line.weightKg as number);
    }
    if (basis === 'units') {
      const missing = goods.filter(
        (entry) => entry.line.quantity === undefined
      );
      if (missing.length) {
        refusals.push({
          code: 'missing-quantities',
          message:
            `${missing.length} of ${goods.length} product lines state no ` +
            'quantity, so a per-unit split cannot be computed.',
        });
        return undefined;
      }
      return goods.map((entry) => entry.line.quantity as number);
    }
    return goods.map((entry) => entry.line.amount);
  };

  const weights = weightsFor();
  if (!weights) {
    return {
      basis,
      freightTotal,
      currency,
      shares: [],
      unallocated: freightTotal,
      refusals,
    };
  }

  const denominator = weights.reduce((total, weight) => total + weight, 0);
  if (denominator <= 0) {
    refusals.push({
      code: 'zero-denominator',
      message:
        `Every product line reports 0 for the ${basis} basis, so there is ` +
        'nothing to divide by.',
    });
    return {
      basis,
      freightTotal,
      currency,
      shares: [],
      unallocated: freightTotal,
      refusals,
    };
  }

  const amounts = distribute(freightTotal, weights);
  const shares: FreightShare[] = goods.map((entry, index) => ({
    documentId: costBasis.documentId,
    lineIndex: entry.lineIndex,
    description: entry.line.description,
    supplierRef: entry.line.supplierRef,
    share: weights[index] / denominator,
    amount: amounts[index],
  }));

  return {
    basis,
    freightTotal,
    currency,
    shares,
    unallocated: 0,
    refusals,
  };
}
