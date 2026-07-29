/**
 * Reconcile an inbound shipment: what the seller shipped against what Amazon
 * recorded receiving, keyed on shipment id.
 *
 * The join is the ledger's `referenceId`, which Amazon populates on Receipts
 * events and nothing else. That is the whole reason this view is limited to
 * receipts: of 141 Shipments rows in a real export, ZERO carried a reference
 * id, so a customer sale cannot be attributed to the shipment that supplied it.
 * Anything claiming to trace a shipment through to sale would be inventing the
 * link.
 *
 * The shipped side comes from FBA box labels, which the seller holds without
 * any API role. It is optional: without it this still reports what Amazon
 * received and how it churned, which is worth having on its own.
 */

import type { ReportRow } from './report-ingest.js';
import type { ReceiptAggregate } from './report-store.js';

/** One SKU's shipped quantity, as read from box labels. */
export type ShippedLine = {
  shipmentId: string;
  /** Seller SKU (MSKU). Listing identity is the seller SKU, not the ASIN. */
  sku: string;
  quantity: number;
  /**
   * False when not every declared box label was seen, which makes `quantity` a
   * floor. A floor treated as a total invents shortages that are not there.
   */
  complete: boolean;
  boxesSeen?: number;
  boxesDeclared?: number;
};

export type ReconciledLine = {
  sku?: string;
  fnsku?: string;
  /** Undefined when no box label was held for this SKU. */
  shipped?: number;
  /** True when `shipped` came from an incomplete set of box labels. */
  shippedIsFloor: boolean;
  /** Sum of positive receipt events. */
  receivedGross: number;
  /** Magnitude of negative receipt events — Amazon un-receiving units. */
  reversed: number;
  receivedNet: number;
  /** shipped − receivedNet. Positive means Amazon is short. */
  discrepancy?: number;
  status: 'balanced' | 'over-received' | 'short' | 'shipped-unknown';
  fulfillmentCenters: string[];
  /**
   * Days between the first receipt and the LAST reversal. A reversal weeks
   * after receipt is not a receiving correction; it is units being found to be
   * the wrong product at pick, one at a time.
   */
  reversalWindowDays?: number;
  reversalEvents: number;
};

export type ShipmentReconciliation = {
  shipmentId: string;
  firstReceiptDate?: string;
  lastReceiptDate?: string;
  lines: ReconciledLine[];
  /** Findings that only make sense across the shipment's SKUs. */
  warnings: string[];
};

/** A discrepancy smaller than this is not worth raising. One unit is. */
const MATERIAL_UNITS = 1;
/** A reversal this long after receipt is a pick-time discovery, not receiving. */
const LATE_REVERSAL_DAYS = 7;

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  );
}

function day(row: ReportRow): string {
  return (row.fields.eventTimestamp ?? '').slice(0, 10);
}

/**
 * Reduce raw ledger rows to the same shape the query service returns.
 *
 * Exists so reconciliation can be exercised against a downloaded export with no
 * database, and so the N1QL aggregate has a reference implementation to be
 * checked against. Production reads go through queryReceiptAggregates, which
 * does this work in the index rather than transferring every event.
 */
export function aggregateReceipts(rows: ReportRow[]): ReceiptAggregate[] {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    if (row.fields.eventType !== 'Receipts' || !row.fields.referenceId)
      continue;
    const key = `${row.fields.referenceId}\u0000${row.fields.msku ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].map((group) => {
    const quantities = group.map((r) => Number(r.fields.quantity ?? 0));
    const days = group.map(day).filter(Boolean).sort();
    const reversalDays = group
      .filter((r) => Number(r.fields.quantity ?? 0) < 0)
      .map(day)
      .filter(Boolean)
      .sort();
    return {
      shipmentId: group[0].fields.referenceId as string,
      sku: group[0].fields.msku,
      fnsku: group[0].fields.fnsku,
      receivedGross: quantities.filter((q) => q > 0).reduce((t, q) => t + q, 0),
      reversed: Math.abs(
        quantities.filter((q) => q < 0).reduce((t, q) => t + q, 0)
      ),
      firstReceipt: days[0],
      lastReceipt: days[days.length - 1],
      lastReversal: reversalDays[reversalDays.length - 1],
      reversalEvents: reversalDays.length,
      fulfillmentCenters: [
        ...new Set(group.map((r) => r.fields.fulfillmentCenter ?? '')),
      ].filter(Boolean),
    };
  });
}

export function reconcileShipments(params: {
  /** Pre-aggregated receipts, from N1QL or from aggregateReceipts. */
  receipts: ReceiptAggregate[];
  /** Shipped quantities from box labels, when held. */
  shipped?: ShippedLine[];
}): ShipmentReconciliation[] {
  const byShipment = new Map<string, ReceiptAggregate[]>();
  for (const entry of params.receipts) {
    byShipment.set(entry.shipmentId, [
      ...(byShipment.get(entry.shipmentId) ?? []),
      entry,
    ]);
  }

  // Shipments named only by a box label still deserve a row: "you shipped this
  // and Amazon has recorded nothing" is the most urgent state of all.
  for (const line of params.shipped ?? []) {
    if (!byShipment.has(line.shipmentId)) byShipment.set(line.shipmentId, []);
  }

  const result: ShipmentReconciliation[] = [];
  for (const [shipmentId, entries] of byShipment) {
    const skus = new Set<string>([
      ...entries.map((e) => e.sku ?? e.fnsku ?? ''),
      ...(params.shipped ?? [])
        .filter((s) => s.shipmentId === shipmentId)
        .map((s) => s.sku),
    ]);

    const lines: ReconciledLine[] = [];
    for (const sku of [...skus].filter(Boolean)) {
      const entry = entries.find((e) => (e.sku ?? e.fnsku) === sku);
      const receivedGross = entry?.receivedGross ?? 0;
      const reversed = entry?.reversed ?? 0;
      const receivedNet = receivedGross - reversed;

      const shippedLine = (params.shipped ?? []).find(
        (s) => s.shipmentId === shipmentId && s.sku === sku
      );
      const discrepancy = shippedLine
        ? shippedLine.quantity - receivedNet
        : undefined;

      // A floor can only ever prove a SHORTAGE. If the labels held cover 1 of 4
      // boxes, 40 units is a lower bound: receiving 62 against it says nothing,
      // because the true figure is probably 160. Declaring that over-received
      // would invent a discrepancy out of missing paperwork.
      const shippedIsFloor = shippedLine ? !shippedLine.complete : false;
      let status: ReconciledLine['status'] = 'shipped-unknown';
      if (discrepancy != null) {
        if (Math.abs(discrepancy) < MATERIAL_UNITS) {
          status = shippedIsFloor ? 'shipped-unknown' : 'balanced';
        } else if (discrepancy > 0) {
          // Even the lower bound exceeds what arrived, so short is safe.
          status = 'short';
        } else {
          status = shippedIsFloor ? 'shipped-unknown' : 'over-received';
        }
      }

      lines.push({
        sku,
        fnsku: entry?.fnsku,
        shipped: shippedLine?.quantity,
        shippedIsFloor,
        receivedGross,
        reversed,
        receivedNet,
        discrepancy,
        status,
        fulfillmentCenters: entry?.fulfillmentCenters ?? [],
        reversalWindowDays:
          entry?.firstReceipt && entry?.lastReversal
            ? daysBetween(
                entry.firstReceipt.slice(0, 10),
                entry.lastReversal.slice(0, 10)
              )
            : undefined,
        reversalEvents: entry?.reversalEvents ?? 0,
      });
    }
    const warnings: string[] = [];

    // The finding that matters most, and the one a human will not spot: one SKU
    // over-received while another on the same shipment is short is the
    // signature of units received under the wrong FNSKU.
    const over = lines.filter((l) => l.status === 'over-received');
    const short = lines.filter((l) => l.status === 'short');
    for (const o of over) {
      for (const s of short) {
        warnings.push(
          `${o.sku} over-received by ${Math.abs(o.discrepancy ?? 0)} while ` +
            `${s.sku} is short by ${s.discrepancy} — units may have been ` +
            `received under the wrong SKU. Compare the two ledgers at ` +
            `${[
              ...new Set([...o.fulfillmentCenters, ...s.fulfillmentCenters]),
            ].join(', ')}.`
        );
      }
    }

    for (const line of lines) {
      if (
        line.reversalWindowDays != null &&
        line.reversalWindowDays > LATE_REVERSAL_DAYS
      ) {
        warnings.push(
          `${line.sku}: ${line.reversed} units reversed across ` +
            `${line.reversalEvents} events over ${line.reversalWindowDays} days ` +
            `after first receipt — consistent with the wrong product being ` +
            `identified at pick rather than a receiving correction.`
        );
      }
      if (line.shippedIsFloor) {
        warnings.push(
          `${line.sku}: shipped quantity is a floor — not every box label was ` +
            `held. A shortage would still be real, but no excess can be ` +
            `concluded, so this line is left unchecked. Import the remaining ` +
            `box labels to close it.`
        );
      }
      if (line.status === 'shipped-unknown' && line.receivedNet !== 0) {
        warnings.push(
          `${line.sku}: no box label held, so what Amazon received cannot be ` +
            `checked against what was sent.`
        );
      }
    }

    const firsts = entries
      .map((e) => e.firstReceipt ?? '')
      .filter(Boolean)
      .sort();
    const lasts = entries
      .map((e) => e.lastReceipt ?? '')
      .filter(Boolean)
      .sort();
    result.push({
      shipmentId,
      firstReceiptDate: firsts[0]?.slice(0, 10),
      lastReceiptDate: lasts[lasts.length - 1]?.slice(0, 10),
      lines: lines.sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? '')),
      warnings,
    });
  }

  return result.sort((a, b) =>
    (b.firstReceiptDate ?? '').localeCompare(a.firstReceiptDate ?? '')
  );
}
