import type { StoredDocument } from '@amz-spapi/sp-cache';
import { summariseBoxLabels } from '@farvisionllc/models';
import { planPacket, type PacketInput } from './evidence-packet';

/**
 * The reconcile deep view: ordered, invoiced, shipped, received — side by side.
 *
 * The flat reconciliation page compares two sides (shipped vs received)
 * because that is all a ledger can say. A shipment with its documents attached
 * knows two more: what the purchase order agreed and what the invoice billed.
 * This view puts all four in one row per SKU, so the finding column can say
 * WHICH relationship broke — "Short 45" is Amazon's problem, "Invoiced 20
 * over the PO" is the supplier's, and conflating them sends the seller's
 * dispute to the wrong counterparty.
 *
 * ## A column is empty for exactly one reason, and the page says which
 *
 * "—" in a cell means the side exists but has no figure for this SKU; a side
 * that is missing ENTIRELY (no PO attached, no invoice, no box labels) is
 * declared once in `notes` and produces no per-row findings — five rows of
 * "no invoice line matched" when there is no invoice would manufacture five
 * discrepancies out of one missing document.
 *
 * ## No figure originates here
 *
 * Ordered comes from PO lines, invoiced from invoice lines, shipped from box
 * labels, received from ledger receipts. Claim pricing is `planPacket`'s —
 * the same arithmetic the packet's cover signs, joined here by SKU — so the
 * exposure this page shows and the claim the packet states can never drift
 * apart.
 */

export type DeepFindingKind =
  | 'short'
  | 'over-received'
  | 'shipped-vs-order'
  | 'invoice-vs-order'
  | 'no-invoice-line'
  | 'no-order-line';

export type DeepFinding = {
  kind: DeepFindingKind;
  text: string;
  /** Priced exposure — present only on a `short` the claim could price. */
  amount?: number;
};

export type DeepLine = {
  sku: string;
  /** The supplier's own words for the line, from the PO else the invoice. */
  supplierLine?: string;
  ordered?: number;
  invoiced?: number;
  shipped?: number;
  /** Boxes are missing, so shipped is a floor, not a total. */
  shippedIsFloor?: boolean;
  received?: number;
  findings: DeepFinding[];
  /** Both sides of the shipped/received comparison were present. */
  compared: boolean;
};

export type DeepSource = {
  key: 'po' | 'invoice' | 'ledger';
  title: string;
  detail: string;
  /** Absent when there is nothing to open — a native PO has no page yet. */
  href?: string;
};

export type DeepView = {
  shipmentId: string;
  vendorName?: string;
  currency?: string;
  orderedDate?: string;
  window?: { from?: string; to?: string };
  fulfillmentCenters: string[];
  sources: DeepSource[];
  lines: DeepLine[];
  /** Whole-side absences and unmatched lines — said once, not per row. */
  notes: string[];
  /** Rows with at least one finding. */
  discrepancies: number;
  /** Sum of priced claimable shorts — `planPacket`'s claim total. */
  exposure?: number;
  canBuildPacket: boolean;
};

/** The same tie the claim uses: an extracted line matches a SKU only through
 * `supplierRef` or a description that contains it. */
function tieLine(
  lines: StoredDocument['extracted']['lines'] | undefined,
  sku: string
): NonNullable<StoredDocument['extracted']['lines']>[number] | undefined {
  return lines?.find(
    (line) => line.supplierRef === sku || (line.description ?? '').includes(sku)
  );
}

export function buildDeepView(input: PacketInput): DeepView {
  const plan = planPacket(input);
  const claimBySku = new Map(plan.claim.lines.map((line) => [line.sku, line]));

  const nativePo = input.orders.find((po) => po.order.status !== 'cancelled');
  const poDocument = input.documents.find(
    (document) => document.role === 'purchase-order'
  );
  const invoice = input.documents.find(
    (document) => document.role === 'commercial-invoice'
  );
  const orderedSide = Boolean(nativePo || poDocument);

  // The SKU universe: every SKU the ledger or labels saw, plus every SKU the
  // issued order names. Uploaded documents cannot ADD SKUs — their lines have
  // no SKU field and only tie to SKUs that exist on another side.
  const skus: string[] = [];
  const seen = new Set<string>();
  const add = (sku: string | undefined) => {
    if (sku && !seen.has(sku)) {
      seen.add(sku);
      skus.push(sku);
    }
  };
  for (const line of input.reconciliation?.lines ?? []) add(line.sku);
  for (const line of nativePo?.order.lines ?? []) add(line.sku);

  const reconBySku = new Map(
    (input.reconciliation?.lines ?? [])
      .filter((line) => line.sku)
      .map((line) => [line.sku as string, line])
  );

  const lines: DeepLine[] = skus.map((sku) => {
    const recon = reconBySku.get(sku);
    const nativeLine = nativePo?.order.lines.find((entry) => entry.sku === sku);
    const poDocLine = nativePo
      ? undefined
      : tieLine(poDocument?.extracted.lines, sku);
    const invoiceLine = tieLine(invoice?.extracted.lines, sku);

    const ordered = nativeLine?.quantity ?? poDocLine?.quantity;
    const invoiced = invoiceLine?.quantity;
    const shipped = recon?.shipped;
    const received = recon ? recon.receivedNet : undefined;
    const compared = shipped !== undefined && received !== undefined;

    const findings: DeepFinding[] = [];

    // Amazon's side first — it is the claimable one.
    if (compared && recon) {
      if (recon.status === 'short' && recon.discrepancy) {
        const claim = claimBySku.get(sku);
        findings.push({
          kind: 'short',
          text: `Short ${recon.discrepancy} — claimable`,
          amount: claim?.amount,
        });
      } else if (recon.status === 'over-received' && recon.discrepancy) {
        findings.push({
          kind: 'over-received',
          text: `Over-received ${Math.abs(recon.discrepancy)}`,
        });
      }
    }

    // The supplier's side: what was sent or billed against what was agreed.
    // Only when the floor is exact — a floor below the order proves nothing.
    if (
      ordered !== undefined &&
      shipped !== undefined &&
      !recon?.shippedIsFloor &&
      shipped !== ordered
    ) {
      const delta = Math.abs(shipped - ordered);
      findings.push({
        kind: 'shipped-vs-order',
        text: `Shipped ${delta} ${
          shipped > ordered ? 'over' : 'under'
        } the order`,
      });
    }
    if (
      ordered !== undefined &&
      invoiced !== undefined &&
      invoiced !== ordered
    ) {
      const delta = Math.abs(invoiced - ordered);
      findings.push({
        kind: 'invoice-vs-order',
        text: `Invoiced ${delta} ${
          invoiced > ordered ? 'over' : 'under'
        } the PO`,
      });
    }

    // Missing-line findings need the side to EXIST — its total absence is a
    // note, not a per-row discrepancy.
    if (invoice && !invoiceLine) {
      findings.push({
        kind: 'no-invoice-line',
        text: 'No invoice line matched this SKU',
      });
    }
    if (orderedSide && ordered === undefined && !nativeLine && !poDocLine) {
      findings.push({
        kind: 'no-order-line',
        text: 'Not on the purchase order',
      });
    }

    return {
      sku,
      supplierLine:
        nativeLine?.description ??
        poDocLine?.description ??
        invoiceLine?.description,
      ordered,
      invoiced,
      shipped,
      shippedIsFloor: recon?.shippedIsFloor || undefined,
      received,
      findings,
      compared,
    };
  });

  const notes: string[] = [];
  if (input.sellerUnavailable) {
    notes.push(
      'Seller data was unreadable while building this view — empty shipped ' +
        'and received columns reflect that, not zero.'
    );
  }
  if (!orderedSide) {
    notes.push('No purchase order is attached — the ordered column is empty.');
  }
  if (!invoice) {
    notes.push('No invoice is attached — the invoiced column is empty.');
  }
  if (!input.boxLabels.length && !input.sellerUnavailable) {
    notes.push(
      'No box labels are held for this shipment, so nothing states what was ' +
        'sent — received quantities stand alone, uncompared.'
    );
  }
  if (!input.receipts.length && !input.sellerUnavailable) {
    notes.push(
      'No ledger receipts reference this shipment — import the Inventory ' +
        'Ledger detail export to see what Amazon received.'
    );
  }

  // Invoice lines that tie to NO SKU. Freight lines are billed against the
  // shipment, not a SKU, and are not expected to tie.
  const unmatched = (invoice?.extracted.lines ?? []).filter(
    (line) =>
      line.kind !== 'freight' &&
      !skus.some(
        (sku) =>
          line.supplierRef === sku || (line.description ?? '').includes(sku)
      )
  );
  if (unmatched.length) {
    notes.push(
      `${unmatched.length} invoice line${unmatched.length === 1 ? '' : 's'} ` +
        'could not be tied to any SKU: ' +
        unmatched.map((line) => `"${line.description}"`).join(', ')
    );
  }

  const labelSummary = summariseBoxLabels(input.boxLabels)[0];
  const fulfillmentCenters = [
    ...new Set(
      (input.reconciliation?.lines ?? []).flatMap(
        (line) => line.fulfillmentCenters
      )
    ),
  ];

  const sources: DeepSource[] = [];
  if (nativePo) {
    const units = nativePo.order.lines.reduce(
      (sum, line) => sum + line.quantity,
      0
    );
    sources.push({
      key: 'po',
      title: nativePo.order.poNumber,
      detail: `issued ${nativePo.order.issueDate} · ${units} units`,
    });
  } else if (poDocument) {
    sources.push({
      key: 'po',
      title: poDocument.fileName ?? 'Purchase order',
      detail: poDocument.extracted.documentDate
        ? `dated ${poDocument.extracted.documentDate}`
        : 'uploaded copy',
      href: `/documents/${poDocument.assetId}`,
    });
  }
  if (invoice) {
    const parts = [
      invoice.extracted.documentDate
        ? `dated ${invoice.extracted.documentDate}`
        : undefined,
      typeof invoice.extracted.total === 'number'
        ? `total ${invoice.extracted.total.toFixed(2)}`
        : undefined,
    ].filter(Boolean);
    sources.push({
      key: 'invoice',
      title: invoice.extracted.invoiceNumber ?? invoice.fileName ?? 'Invoice',
      detail: parts.join(' · ') || 'uploaded copy',
      href: `/documents/${invoice.assetId}`,
    });
  }
  if (labelSummary || input.receipts.length) {
    const parts = [
      labelSummary
        ? `${labelSummary.boxesSeen} box${
            labelSummary.boxesSeen === 1 ? '' : 'es'
          }`
        : undefined,
      fulfillmentCenters.length ? fulfillmentCenters.join(', ') : undefined,
      plan.window?.from && plan.window?.to
        ? `${plan.window.from} → ${plan.window.to}`
        : undefined,
    ].filter(Boolean);
    sources.push({
      key: 'ledger',
      title: 'Ledger + box labels',
      detail: parts.join(' · ') || 'held',
    });
  }

  return {
    shipmentId: input.shipmentId,
    vendorName: plan.vendorName,
    currency: plan.currency,
    orderedDate:
      nativePo?.order.issueDate ?? poDocument?.extracted.documentDate,
    window: plan.window,
    fulfillmentCenters,
    sources,
    lines,
    notes,
    discrepancies: lines.filter((line) => line.findings.length > 0).length,
    exposure: plan.claim.total,
    canBuildPacket: plan.items.length > 0,
  };
}
