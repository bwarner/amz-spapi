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

export type PurchaseReconciliation = {
  /** Document whose lines become cost of goods. */
  costBasisDocumentId?: string;
  cogsTotal: number;
  /** Sum of payment-record documents. */
  paidTotal: number;
  currency?: string;
  issues: ExtractionIssue2[];
};

/** Purchase-level findings, kept separate from single-document issues. */
export type ExtractionIssue2 = {
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
  const issues: ExtractionIssue2[] = [];

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
