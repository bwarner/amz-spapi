import * as React from 'react';
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import {
  listBoxLabels,
  listDocuments,
  listPurchaseOrders,
  queryReceiptAggregates,
  queryReimbursements,
  reconcileShipments,
  type ReceiptAggregate,
  type ReimbursementRow,
  type ShipmentReconciliation,
  type StoredBoxLabel,
  type StoredDocument,
  type StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';
import { summariseBoxLabels } from '@farvisionllc/models';
import { inboundCoverFor, netReimbursements } from './reimbursements';
import { extractDocxText } from './docx-text';
import { resolveSellerContext } from './document-center';
import { loadAssetBytes } from './media-assets';
import { loggerFor } from './logger';

const log = loggerFor('shipments');

/**
 * The evidence packet: one PDF that proves a claim about a shipment.
 *
 * A reimbursement reviewer, an accountant, an auditor — none of them want the
 * app. They want documents, in the order a case is read: what was ordered,
 * what was billed, what was sent, what Amazon received. The packet is that
 * stack, with a cover page that states the claim in plain arithmetic and names
 * the page every figure comes from, so any number can be checked against the
 * paper behind it without reading the whole thing.
 *
 * ## Gaps are named, never papered over
 *
 * The cover lists what is MISSING as prominently as what is included. A claim
 * that hides its own hole is rejected slower, and worse, than one that says
 * where it is thin — and a packet that silently omitted the proof of delivery
 * would present a weaker claim as a complete one, which is the exact failure
 * this app keeps refusing to build (fallback search says it is a fallback;
 * floor quantities say they are floors).
 *
 * ## No figure originates here
 *
 * The claim arithmetic is the reconciliation's; unit costs come from the
 * issued order's lines or the invoice's, and the cover SAYS which — a PO
 * price is what was agreed, an invoice price is what was billed, and when
 * neither can be tied to the SKU the claim states units and says why there is
 * no dollar figure. An invented unit cost on a signed claim is not a rounding
 * choice, it is a misstatement.
 */

// ---------------------------------------------------------------------------
// Plan — what goes in, what is missing, what is claimed
// ---------------------------------------------------------------------------

export type PacketItem = {
  key: string;
  /** "Purchase order PO-2026-0003" — the cover's contents line. */
  label: string;
  /** What this item evidences, in the reviewer's terms. */
  role: string;
  /** PDF/image assets to embed, in order. Empty for generated sections. */
  assetIds: string[];
  /** A generated section (the ledger table) rather than stored paper. */
  generated?: 'ledger';
};

export type PacketGap = {
  /** "Proof of delivery" */
  name: string;
  /** Why it is absent, said the way the cover will say it. */
  reason: string;
};

export type ClaimLine = {
  sku: string;
  shipped: number;
  receivedNet: number;
  /** Units Amazon is short. */
  units: number;
  unitCost?: number;
  /** Where the unit cost came from — stated on the cover. */
  unitCostSource?: 'purchase order' | 'invoice';
  amount?: number;
};

export type PacketPlan = {
  shipmentId: string;
  vendorName?: string;
  currency?: string;
  items: PacketItem[];
  gaps: PacketGap[];
  claim: {
    lines: ClaimLine[];
    /** Sum of the lines that HAVE a dollar figure. */
    total?: number;
    /** Lines whose units could not be priced, and why. */
    unpriced?: string;
    /**
     * Whether shipped and received were actually COMPARED. "No shortfall
     * found" and "no comparison was possible" are different sentences, and a
     * cover that says the first when the second is true overclaims — exactly
     * what a packet must never do.
     */
    compared: boolean;
  };
  /** Receipt aggregates for the generated ledger section. */
  receipts: ReceiptAggregate[];
  window?: { from?: string; to?: string };
  /**
   * Standing (unreversed) inbound-loss payments Amazon has made for this
   * shipment's SKUs since first receipt. Listed across ALL the shipment's
   * SKUs, not just the short ones: a payment on the over-received twin of a
   * short SKU is exactly the one that settles a mislabel (seen live). The
   * report carries no shipment reference, so these are "may cover", and the
   * cover says so.
   */
  alreadyReimbursed: Array<{
    sku?: string;
    units: number;
    amount: number;
    date?: string;
    caseId?: string;
    reimbursementId?: string;
  }>;
};

/** Everything the plan is computed from — gathered by the loader. */
export type PacketInput = {
  shipmentId: string;
  documents: StoredDocument[];
  orders: StoredPurchaseOrder[];
  boxLabels: StoredBoxLabel[];
  receipts: ReceiptAggregate[];
  reconciliation?: ShipmentReconciliation;
  /** Every reimbursement row for the seller, reversals included. */
  reimbursements?: ReimbursementRow[];
  /** Seller-scoped stores were unreadable — different claim from "empty". */
  sellerUnavailable?: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  'purchase-order': 'Purchase order',
  'commercial-invoice': 'Commercial invoice',
  'packing-list': 'Packing list',
  'proof-of-delivery': 'Proof of delivery',
  'transport-document': 'Transport document',
  'freight-invoice': 'Freight invoice',
  'customs-declaration': 'Customs declaration',
  'payment-record': 'Payment record',
};

/** The reading order of a claim: ordered → billed → sent → received → proof. */
const READING_ORDER = [
  'purchase-order',
  'commercial-invoice',
  'packing-list',
  'transport-document',
  'freight-invoice',
  'proof-of-delivery',
];

export function planPacket(input: PacketInput): PacketPlan {
  const items: PacketItem[] = [];
  const gaps: PacketGap[] = [];

  // The issued order outranks an uploaded copy, same as the checklist.
  const nativePo = input.orders.find((po) => po.order.status !== 'cancelled');
  const documentsByRole = new Map<string, StoredDocument>();
  for (const document of input.documents) {
    if (!documentsByRole.has(document.role)) {
      documentsByRole.set(document.role, document);
    }
  }

  if (nativePo) {
    const render = nativePo.renders.find((entry) => entry.format === 'pdf');
    if (render) {
      items.push({
        key: 'po',
        label: `Purchase order ${nativePo.order.poNumber}`,
        role: 'what was ordered',
        assetIds: [render.assetId],
      });
    } else {
      gaps.push({
        name: `Purchase order ${nativePo.order.poNumber}`,
        reason:
          'issued in Sellavant but never rendered — open the order and ' +
          'download it once, then rebuild this packet',
      });
    }
  } else if (documentsByRole.has('purchase-order')) {
    const document = documentsByRole.get('purchase-order')!;
    items.push({
      key: 'po',
      label: document.fileName ?? 'Purchase order',
      role: 'what was ordered',
      assetIds: [document.assetId],
    });
  } else {
    gaps.push({ name: 'Purchase order', reason: 'never attached' });
  }

  for (const role of READING_ORDER.slice(1)) {
    const document = documentsByRole.get(role);
    const name = ROLE_LABELS[role];
    if (document) {
      items.push({
        key: role,
        label: document.fileName ?? name,
        role: roleReason(role),
        assetIds: [document.assetId],
      });
    } else if (role === 'commercial-invoice' || role === 'proof-of-delivery') {
      // Only the documents a CLAIM leans on are named as gaps. A shipment
      // without a customs declaration is normal; one without an invoice or a
      // POD is a thinner claim, and the cover has to say so.
      gaps.push({
        name,
        reason: input.sellerUnavailable
          ? 'not attached (and seller data was unreadable while building)'
          : 'never attached',
      });
    }
  }

  // Box labels: what the seller SENT. One item, however many label PDFs.
  const labelAssets = [
    ...new Set(
      input.boxLabels
        .map((label) => label.assetId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const labelSummary = summariseBoxLabels(input.boxLabels)[0];
  if (labelAssets.length) {
    items.push({
      key: 'box-labels',
      label: labelSummary
        ? `FBA box labels — ${labelSummary.boxesSeen} box${
            labelSummary.boxesSeen === 1 ? '' : 'es'
          }, ${labelSummary.totalUnits} units`
        : 'FBA box labels',
      role: 'what was sent',
      assetIds: labelAssets,
    });
  } else {
    gaps.push({
      name: 'Box labels',
      reason: input.sellerUnavailable
        ? 'seller data was unreadable while building'
        : 'never uploaded',
    });
  }

  // Ledger receipts: what Amazon received. Generated, not stored paper.
  if (input.receipts.length) {
    items.push({
      key: 'ledger',
      label: `Ledger receipts — ${input.receipts.length} SKU${
        input.receipts.length === 1 ? '' : 's'
      }`,
      role: 'what Amazon received',
      assetIds: [],
      generated: 'ledger',
    });
  } else {
    gaps.push({
      name: 'Ledger receipts',
      reason: input.sellerUnavailable
        ? 'seller data was unreadable while building'
        : 'no receipt rows for this shipment — import the inventory ledger',
    });
  }

  // Standing inbound-loss payments for ANY of the shipment's SKUs. The short
  // SKU's over-received twin matters most: when Amazon reclassifies mislabelled
  // units between two SKUs, the payment that settles the loss can land on
  // either name.
  const shipmentSkus = [
    ...new Set([
      ...(input.reconciliation?.lines ?? [])
        .map((line) => line.sku)
        .filter((sku): sku is string => Boolean(sku)),
      ...input.boxLabels.map((label) => label.sku),
      ...input.receipts
        .map((receipt) => receipt.sku)
        .filter((sku): sku is string => Boolean(sku)),
    ]),
  ].filter((sku): sku is string => Boolean(sku));
  const netted = netReimbursements(input.reimbursements ?? []);
  const alreadyReimbursed = shipmentSkus.flatMap((sku) =>
    inboundCoverFor({
      netted,
      sku,
      notBefore: input.reconciliation?.firstReceiptDate,
    }).map((payment) => ({
      sku: payment.sku,
      units: payment.units,
      amount: payment.amount,
      date: payment.date,
      caseId: payment.caseId,
      reimbursementId: payment.reimbursementId,
    }))
  );

  return {
    shipmentId: input.shipmentId,
    vendorName:
      input.documents.map((d) => d.extracted.vendorName).find(Boolean) ??
      (nativePo ? titleCase(nativePo.order.vendorId) : undefined),
    currency:
      nativePo?.order.currency ??
      input.documents.map((d) => d.extracted.currency).find(Boolean),
    items,
    gaps,
    claim: buildClaim(input, nativePo, documentsByRole),
    receipts: input.receipts,
    window: input.reconciliation
      ? {
          from: input.reconciliation.firstReceiptDate,
          to: input.reconciliation.lastReceiptDate,
        }
      : undefined,
    alreadyReimbursed,
  };
}

function roleReason(role: string): string {
  const REASONS: Record<string, string> = {
    'commercial-invoice': 'what was billed',
    'packing-list': 'what the supplier packed',
    'transport-document': 'the freight leg',
    'freight-invoice': 'the freight cost',
    'proof-of-delivery': 'proof the goods arrived',
  };
  return REASONS[role] ?? role;
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * The claim: shorts only, priced only where a price can be TIED to the SKU.
 *
 * The issued order's lines carry real SKUs and agreed unit prices — first
 * choice. An invoice line matches only through `supplierRef` or a description
 * that contains the SKU, and when neither holds the line stays unpriced with
 * the reason on the cover. Over-receipts are not claims and are left to the
 * reconciliation screen.
 */
function buildClaim(
  input: PacketInput,
  nativePo: StoredPurchaseOrder | undefined,
  documentsByRole: Map<string, StoredDocument>
): PacketPlan['claim'] {
  const compared = Boolean(
    input.reconciliation?.lines.some(
      (line) => line.shipped !== undefined && line.receivedGross >= 0
    ) &&
      input.boxLabels.length &&
      input.receipts.length
  );
  const shorts =
    input.reconciliation?.lines.filter(
      (line) => line.status === 'short' && line.sku && line.discrepancy
    ) ?? [];
  if (!shorts.length) return { lines: [], compared };

  const invoice = documentsByRole.get('commercial-invoice');
  const lines: ClaimLine[] = shorts.map((line) => {
    const sku = line.sku as string;
    const poLine = nativePo?.order.lines.find((entry) => entry.sku === sku);
    if (poLine) {
      const units = line.discrepancy as number;
      return {
        sku,
        shipped: line.shipped ?? 0,
        receivedNet: line.receivedNet,
        units,
        unitCost: poLine.unitPrice,
        unitCostSource: 'purchase order',
        amount: Math.round(units * poLine.unitPrice * 100) / 100,
      };
    }
    const invoiceLine = invoice?.extracted.lines?.find(
      (entry) =>
        entry.supplierRef === sku || (entry.description ?? '').includes(sku)
    );
    if (
      invoiceLine &&
      typeof invoiceLine.amount === 'number' &&
      typeof invoiceLine.quantity === 'number' &&
      invoiceLine.quantity > 0
    ) {
      const units = line.discrepancy as number;
      const unitCost =
        Math.round((invoiceLine.amount / invoiceLine.quantity) * 100) / 100;
      return {
        sku,
        shipped: line.shipped ?? 0,
        receivedNet: line.receivedNet,
        units,
        unitCost,
        unitCostSource: 'invoice',
        amount: Math.round(units * unitCost * 100) / 100,
      };
    }
    return {
      sku,
      shipped: line.shipped ?? 0,
      receivedNet: line.receivedNet,
      units: line.discrepancy as number,
    };
  });

  const priced = lines.filter((line) => typeof line.amount === 'number');
  const unpricedLines = lines.filter((line) => line.amount === undefined);
  return {
    lines,
    compared,
    total: priced.length
      ? Math.round(
          priced.reduce((sum, line) => sum + (line.amount ?? 0), 0) * 100
        ) / 100
      : undefined,
    unpriced: unpricedLines.length
      ? `${unpricedLines.map((line) => line.sku).join(', ')}: no line on the ` +
        'order or invoice ties a price to this SKU, so these are claimed as ' +
        'units only'
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loadPacketInput(params: {
  userId: string;
  shipmentId: string;
}): Promise<PacketInput & { sellerStatus: string }> {
  const { userId, shipmentId } = params;
  const { sellerId, status } = await resolveSellerContext(userId);

  const [documents, orders, boxLabels, receipts, reimbursements] =
    await Promise.all([
      listDocuments({ userId, limit: 500 }),
      listPurchaseOrders({ userId }),
      sellerId ? listBoxLabels({ sellerId, shipmentId }) : Promise.resolve([]),
      sellerId
        ? queryReceiptAggregates({ sellerId, shipmentId })
        : Promise.resolve([]),
      // All rows, not per-SKU: netting reversals against payments needs the
      // whole ledger, and it is small.
      sellerId ? queryReimbursements({ sellerId }) : Promise.resolve([]),
    ]);

  const linkedDocuments = documents.filter((document) =>
    (document.shipmentIds ?? []).includes(shipmentId)
  );
  const linkedOrders = orders.filter((po) =>
    (po.shipmentIds ?? []).includes(shipmentId)
  );

  const [reconciliation] = reconcileShipments({
    receipts,
    shipped: summariseBoxLabels(boxLabels).flatMap((summary) =>
      summary.units.map((unit) => ({
        shipmentId: summary.shipmentId,
        sku: unit.sku,
        quantity: unit.quantity,
        complete: summary.complete,
        boxesSeen: summary.boxesSeen,
        boxesDeclared: summary.boxesDeclared,
      }))
    ),
  }).filter((entry) => entry.shipmentId === shipmentId);

  return {
    shipmentId,
    documents: linkedDocuments,
    orders: linkedOrders,
    boxLabels,
    receipts,
    reconciliation,
    reimbursements,
    sellerUnavailable: status === 'unavailable',
    sellerStatus: status,
  };
}

// ---------------------------------------------------------------------------
// PDF composition
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'Helvetica', color: '#111' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 10, color: '#555', marginBottom: 16 },
  heading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#555',
    marginTop: 14,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', marginBottom: 2 },
  cellSku: { width: '30%' },
  cellNum: { width: '17.5%', textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  gap: { color: '#8a5a00', marginBottom: 2 },
  small: { fontSize: 8, color: '#555' },
  hr: { borderBottomWidth: 1, borderBottomColor: '#ddd', marginVertical: 8 },
});

function CoverPage({
  plan,
  pageOf,
  preparedOn,
  totalPages,
}: {
  plan: PacketPlan;
  /** First page of each item in the final document, by item key. */
  pageOf: Map<string, number>;
  preparedOn: string;
  totalPages: number;
}) {
  const money = (amount?: number) =>
    typeof amount === 'number'
      ? `${plan.currency ?? 'USD'} ${amount.toFixed(2)}`
      : '—';
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Evidence packet</Text>
        <Text style={styles.subtitle}>
          {plan.shipmentId}
          {plan.vendorName ? ` · ${plan.vendorName}` : ''} · prepared{' '}
          {preparedOn} · {totalPages} pages
        </Text>

        {plan.claim.lines.length ? (
          <>
            <Text style={styles.heading}>The claim</Text>
            <View style={styles.row}>
              <Text style={[styles.cellSku, styles.bold]}>SKU</Text>
              <Text style={[styles.cellNum, styles.bold]}>Shipped</Text>
              <Text style={[styles.cellNum, styles.bold]}>Received</Text>
              <Text style={[styles.cellNum, styles.bold]}>Short</Text>
              <Text style={[styles.cellNum, styles.bold]}>Claim</Text>
            </View>
            {plan.claim.lines.map((line) => (
              <View key={line.sku} style={styles.row}>
                <Text style={styles.cellSku}>{line.sku}</Text>
                <Text style={styles.cellNum}>{line.shipped}</Text>
                <Text style={styles.cellNum}>{line.receivedNet}</Text>
                <Text style={styles.cellNum}>{line.units}</Text>
                <Text style={styles.cellNum}>
                  {money(line.amount)}
                  {line.unitCostSource
                    ? ` (@ ${money(line.unitCost)}, ${line.unitCostSource})`
                    : ''}
                </Text>
              </View>
            ))}
            {typeof plan.claim.total === 'number' ? (
              <View style={styles.row}>
                <Text style={[styles.cellSku, styles.bold]}>Total claimed</Text>
                <Text style={styles.cellNum} />
                <Text style={styles.cellNum} />
                <Text style={styles.cellNum} />
                <Text style={[styles.cellNum, styles.bold]}>
                  {money(plan.claim.total)}
                </Text>
              </View>
            ) : null}
            {plan.claim.unpriced ? (
              <Text style={[styles.small, { marginTop: 4 }]}>
                {plan.claim.unpriced}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.heading}>The claim</Text>
            <Text>
              {plan.claim.compared
                ? 'No shortfall is claimed: shipped and received quantities ' +
                  'reconcile for every SKU.'
                : 'No shortfall is computed: the shipped or received side is ' +
                  'missing (see Not included), so no comparison was possible.'}
            </Text>
          </>
        )}

        {plan.alreadyReimbursed.length ? (
          <>
            <Text style={styles.heading}>Already reimbursed</Text>
            {plan.alreadyReimbursed.map((payment) => (
              <View
                key={
                  payment.reimbursementId ?? `${payment.sku}-${payment.date}`
                }
                style={styles.row}
              >
                <Text style={styles.cellSku}>{payment.sku ?? '—'}</Text>
                <Text style={styles.cellNum}>{payment.units}</Text>
                <Text style={styles.cellNum}>{money(payment.amount)}</Text>
                <Text style={[{ width: '17.5%' }]}>{payment.date ?? ''}</Text>
                <Text style={[{ width: '17.5%' }, styles.small]}>
                  {payment.caseId ? `case ${payment.caseId}` : ''}
                </Text>
              </View>
            ))}
            <Text style={[styles.small, { marginTop: 4 }]}>
              Standing inbound-loss payments Amazon has made for this shipment's
              SKUs since first receipt (reversed payments excluded). The
              reimbursements report carries no shipment reference, so these MAY
              cover the shortfall above — net the claim against them before
              filing; a claim for units Amazon has already paid is denied.
            </Text>
          </>
        ) : null}

        <View style={styles.hr} />

        <Text style={styles.heading}>
          Contents — where each figure comes from
        </Text>
        {plan.items.map((item) => (
          <View key={item.key} style={styles.row}>
            <Text style={{ width: '8%' }}>p.{pageOf.get(item.key) ?? '—'}</Text>
            <Text style={{ width: '62%' }}>{item.label}</Text>
            <Text style={[{ width: '30%' }, styles.small]}>{item.role}</Text>
          </View>
        ))}

        {plan.gaps.length ? (
          <>
            <Text style={styles.heading}>Not included</Text>
            {plan.gaps.map((gap) => (
              <Text key={gap.name} style={styles.gap}>
                {gap.name} — {gap.reason}
              </Text>
            ))}
            <Text style={[styles.small, { marginTop: 4 }]}>
              Named here rather than quietly left out: a claim that states where
              it is thin reads as honest; one with a silent hole reads as hiding
              it.
            </Text>
          </>
        ) : null}

        <Text
          style={[styles.small, { position: 'absolute', bottom: 32, left: 48 }]}
        >
          Assembled by Sellavant from the documents on file. No figure
          originates in this packet; each is stated with its source.
        </Text>
      </Page>
    </Document>
  );
}

function LedgerSection({ plan }: { plan: PacketPlan }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Ledger receipts</Text>
        <Text style={styles.subtitle}>
          {plan.shipmentId} · Amazon inventory ledger, Receipts events
          aggregated by SKU
        </Text>
        <View style={styles.row}>
          <Text style={[styles.cellSku, styles.bold]}>SKU</Text>
          <Text style={[styles.cellNum, styles.bold]}>Received</Text>
          <Text style={[styles.cellNum, styles.bold]}>Reversed</Text>
          <Text style={[{ width: '17.5%' }, styles.bold]}>First</Text>
          <Text style={[{ width: '17.5%' }, styles.bold]}>Last</Text>
        </View>
        {plan.receipts.map((receipt) => (
          <View key={`${receipt.sku}-${receipt.fnsku}`} style={styles.row}>
            <Text style={styles.cellSku}>{receipt.sku ?? receipt.fnsku}</Text>
            <Text style={styles.cellNum}>{receipt.receivedGross}</Text>
            <Text style={styles.cellNum}>{receipt.reversed}</Text>
            <Text style={{ width: '17.5%' }}>{receipt.firstReceipt ?? ''}</Text>
            <Text style={{ width: '17.5%' }}>{receipt.lastReceipt ?? ''}</Text>
          </View>
        ))}
        <Text style={[styles.small, { marginTop: 10 }]}>
          Fulfilment centres:{' '}
          {[
            ...new Set(plan.receipts.flatMap((r) => r.fulfillmentCenters)),
          ].join(', ') || '—'}
        </Text>
      </Page>
    </Document>
  );
}

/**
 * A Word document, rendered as typeset text so the packet can carry it.
 *
 * A PDF cannot embed a .docx, and the platform has no Word renderer — but the
 * text IS the evidence on the documents sellers actually send this way (POs,
 * packing lists, quotes). So the extracted text is typeset onto pages that
 * SAY what they are, in a banner a reviewer cannot miss: a text rendering,
 * not the original, formatting and images not reproduced, original retained.
 * Converted evidence presented as the original would be a misrepresentation;
 * converted evidence labelled as converted is just legible.
 */
function DocxRendering({ fileName, text }: { fileName: string; text: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{fileName}</Text>
        <Text style={[styles.gap, { marginBottom: 12 }]}>
          Text rendering of a Word document — formatting and images are not
          reproduced. The original file is retained in Sellavant.
        </Text>
        {text.split('\n').map((line, index) => (
          <Text key={index} style={{ marginBottom: 2 }}>
            {line || ' '}
          </Text>
        ))}
      </Page>
    </Document>
  );
}

/** Exported for tests: docx text in, labelled PDF bytes out. */
export async function renderDocxAsPdf(
  fileName: string,
  text: string
): Promise<Buffer> {
  return renderToBuffer(<DocxRendering fileName={fileName} text={text} />);
}

/**
 * Compose the packet.
 *
 * Two passes because the cover cites page numbers: every section is loaded and
 * counted first, then the cover is rendered knowing where each lands, then the
 * whole document is stitched in reading order. An asset that cannot be
 * embedded (unreadable, or a format PDF cannot carry) is moved to the gaps —
 * failing the WHOLE packet over one bad file would punish the seller for the
 * exact situation the packet exists to survive.
 */
export async function buildPacketPdf(params: {
  userId: string;
  plan: PacketPlan;
  preparedOn: string;
}): Promise<Uint8Array> {
  const { userId, plan, preparedOn } = params;

  type Loaded = { item: PacketItem; documents: PDFDocument[] };
  const loaded: Loaded[] = [];

  for (const item of plan.items) {
    if (item.generated === 'ledger') {
      const bytes = await renderToBuffer(<LedgerSection plan={plan} />);
      loaded.push({
        item,
        documents: [await PDFDocument.load(bytes)],
      });
      continue;
    }

    const documents: PDFDocument[] = [];
    for (const assetId of item.assetIds) {
      const asset = await loadAssetBytes({ userId, assetId });
      if (!asset) {
        plan.gaps.push({
          name: item.label,
          reason: 'its stored file could not be read while building',
        });
        continue;
      }
      try {
        if (asset.mimeType === 'application/pdf') {
          documents.push(await PDFDocument.load(asset.bytes));
        } else if (
          asset.mimeType === 'image/png' ||
          asset.mimeType === 'image/jpeg'
        ) {
          const wrapper = await PDFDocument.create();
          const image =
            asset.mimeType === 'image/png'
              ? await wrapper.embedPng(asset.bytes)
              : await wrapper.embedJpg(asset.bytes);
          const page = wrapper.addPage([image.width, image.height]);
          page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
          });
          documents.push(wrapper);
        } else if (asset.mimeType.includes('wordprocessingml')) {
          // Convert rather than omit: the extracted text is typeset onto
          // pages that state they are a rendering, not the original.
          const docx = await extractDocxText(Buffer.from(asset.bytes));
          if (docx.text.trim()) {
            const rendered = await renderDocxAsPdf(item.label, docx.text);
            documents.push(await PDFDocument.load(rendered));
            item.label = `${item.label} (text rendering)`;
          } else {
            plan.gaps.push({
              name: item.label,
              reason:
                'a Word document with no extractable text — export it to ' +
                'PDF and attach that version',
            });
          }
        } else {
          plan.gaps.push({
            name: item.label,
            reason:
              `stored as ${asset.mimeType}, which a PDF cannot carry — ` +
              'attach a PDF or image version',
          });
        }
      } catch (error) {
        log.error(
          { assetId, error: error instanceof Error ? error.message : error },
          'packet asset unreadable'
        );
        plan.gaps.push({
          name: item.label,
          reason: 'its stored file could not be read while building',
        });
      }
    }
    if (documents.length) loaded.push({ item, documents });
  }

  // Items that lost every asset stop being contents.
  const included = new Set(loaded.map((entry) => entry.item.key));
  plan.items = plan.items.filter((item) => included.has(item.key));

  const pageOf = new Map<string, number>();
  let cursor = 2; // page 1 is the cover
  for (const entry of loaded) {
    pageOf.set(entry.item.key, cursor);
    cursor += entry.documents.reduce(
      (sum, document) => sum + document.getPageCount(),
      0
    );
  }

  const coverBytes = await renderToBuffer(
    <CoverPage
      plan={plan}
      pageOf={pageOf}
      preparedOn={preparedOn}
      totalPages={cursor - 1}
    />
  );

  const packet = await PDFDocument.create();
  const cover = await PDFDocument.load(coverBytes);
  for (const page of await packet.copyPages(cover, cover.getPageIndices())) {
    packet.addPage(page);
  }
  for (const entry of loaded) {
    for (const document of entry.documents) {
      for (const page of await packet.copyPages(
        document,
        document.getPageIndices()
      )) {
        packet.addPage(page);
      }
    }
  }

  packet.setTitle(`Evidence packet ${plan.shipmentId}`);
  packet.setProducer('Sellavant');
  return packet.save();
}
