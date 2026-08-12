import type { StoredDocument } from '@amz-spapi/sp-cache';
import { summariseBoxLabels } from '@farvisionllc/models';
import { planPacket, type PacketInput } from './evidence-packet';
import { inboundCoverFor, netReimbursements } from './reimbursements';

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
  | 'no-order-line'
  /** Amazon has a standing inbound-loss payment on this SKU — the claim may
      already be (partly) settled. Advisory, never counted as a discrepancy
      on its own. */
  | 'reimbursed';

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
  const netted = netReimbursements(input.reimbursements ?? []);
  const coverFor = (sku: string) =>
    inboundCoverFor({
      netted,
      sku,
      notBefore: input.reconciliation?.firstReceiptDate,
    });

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
        // A standing payment on the same SKU: the claim may already be
        // (partly) settled. "May", because the report names no shipment.
        for (const payment of coverFor(sku)) {
          const remaining = Math.max(recon.discrepancy - payment.units, 0);
          findings.push({
            kind: 'reimbursed',
            text:
              `A reimbursement on ${payment.date ?? 'an unknown date'}` +
              `${payment.caseId ? ` (case ${payment.caseId})` : ''} may ` +
              `already cover ${payment.units} of these — at most ` +
              `${remaining} remain claimable`,
            amount: payment.amount,
          });
        }
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

  // A short on one SKU beside an over-receipt on another is usually not two
  // problems: Amazon's receipt corrections move units between SKUs when they
  // decide labels were wrong, and the two rows are the same units under
  // different names. Claiming the gross short while holding the over-receipt
  // is the version of this claim that gets denied.
  const shortLines = lines.filter((line) =>
    line.findings.some((finding) => finding.kind === 'short')
  );
  const overLines = lines.filter((line) =>
    line.findings.some((finding) => finding.kind === 'over-received')
  );
  if (shortLines.length && overLines.length) {
    const totalShort = shortLines.reduce(
      (sum, line) => sum + ((line.shipped ?? 0) - (line.received ?? 0)),
      0
    );
    const totalOver = overLines.reduce(
      (sum, line) => sum + ((line.received ?? 0) - (line.shipped ?? 0)),
      0
    );
    notes.push(
      `Short ${totalShort} on ${shortLines
        .map((line) => line.sku)
        .join(', ')} sits beside over-receipt ${totalOver} on ${overLines
        .map((line) => line.sku)
        .join(', ')} — likely the same units mislabelled and reclassified by ` +
        `Amazon. The net shortfall across them is ${Math.max(
          totalShort - totalOver,
          0
        )}; a claim for the gross ${totalShort} will be denied against the ` +
        'over-receipt.'
    );
  }

  // Standing inbound-loss payments on SKUs that are NOT short here — most
  // often the over-received twin of a short SKU. Money already paid for what
  // this shipment lost can arrive under either name.
  const shortSkus = new Set(shortLines.map((line) => line.sku));
  for (const sku of skus) {
    if (shortSkus.has(sku)) continue;
    for (const payment of coverFor(sku)) {
      notes.push(
        `Amazon paid ${payment.amount.toFixed(2)} for ${payment.units} lost ` +
          `inbound unit${payment.units === 1 ? '' : 's'} of ${sku} on ` +
          `${payment.date ?? 'an unknown date'}` +
          `${payment.caseId ? ` (case ${payment.caseId})` : ''} — if the ` +
          'mislabel reading applies, that payment may already settle the net ' +
          'shortfall.'
      );
    }
  }

  const strayReversals = netted.unmatchedReversals.filter(
    (reversal) => reversal.sku && seen.has(reversal.sku)
  );
  if (strayReversals.length) {
    const clawedBack = strayReversals.reduce(
      (sum, reversal) => sum + reversal.amount,
      0
    );
    notes.push(
      `${strayReversals.length} reimbursement reversal` +
        `${strayReversals.length === 1 ? '' : 's'} on this shipment's SKUs ` +
        `(${clawedBack.toFixed(2)}) could not be matched to a payment in the ` +
        'imported window — money was clawed back for reimbursements this ' +
        'report does not show. Import a wider reimbursements window to see ' +
        'the full picture.'
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
