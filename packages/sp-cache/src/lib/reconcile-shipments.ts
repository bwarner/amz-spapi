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

export function reconcileShipments(params: {
  /** Ledger rows. Only detail-view Receipts rows carry a reference id. */
  rows: ReportRow[];
  /** Shipped quantities from box labels, when held. */
  shipped?: ShippedLine[];
}): ShipmentReconciliation[] {
  const receipts = params.rows.filter(
    (row) => row.fields.eventType === 'Receipts' && row.fields.referenceId
  );

  const byShipment = new Map<string, ReportRow[]>();
  for (const row of receipts) {
    const id = row.fields.referenceId as string;
    byShipment.set(id, [...(byShipment.get(id) ?? []), row]);
  }

  // Shipments named only by a box label still deserve a row: "you shipped this
  // and Amazon has recorded nothing" is the most urgent state of all.
  for (const line of params.shipped ?? []) {
    if (!byShipment.has(line.shipmentId)) byShipment.set(line.shipmentId, []);
  }

  const result: ShipmentReconciliation[] = [];
  for (const [shipmentId, rows] of byShipment) {
    const skus = new Set<string>([
      ...rows.map((r) => r.fields.msku ?? r.fields.fnsku ?? ''),
      ...(params.shipped ?? [])
        .filter((s) => s.shipmentId === shipmentId)
        .map((s) => s.sku),
    ]);

    const lines: ReconciledLine[] = [];
    for (const sku of [...skus].filter(Boolean)) {
      const skuRows = rows.filter(
        (r) => (r.fields.msku ?? r.fields.fnsku) === sku
      );
      const quantities = skuRows.map((r) => Number(r.fields.quantity ?? 0));
      const receivedGross = quantities
        .filter((q) => q > 0)
        .reduce((t, q) => t + q, 0);
      const reversed = Math.abs(
        quantities.filter((q) => q < 0).reduce((t, q) => t + q, 0)
      );
      const receivedNet = receivedGross - reversed;

      const shippedLine = (params.shipped ?? []).find(
        (s) => s.shipmentId === shipmentId && s.sku === sku
      );
      const discrepancy = shippedLine
        ? shippedLine.quantity - receivedNet
        : undefined;

      let status: ReconciledLine['status'] = 'shipped-unknown';
      if (discrepancy != null) {
        status =
          Math.abs(discrepancy) < MATERIAL_UNITS
            ? 'balanced'
            : discrepancy < 0
            ? 'over-received'
            : 'short';
      }

      const days = skuRows.map(day).filter(Boolean).sort();
      const reversalDays = skuRows
        .filter((r) => Number(r.fields.quantity ?? 0) < 0)
        .map(day)
        .filter(Boolean)
        .sort();

      lines.push({
        sku,
        fnsku: skuRows[0]?.fields.fnsku,
        shipped: shippedLine?.quantity,
        shippedIsFloor: shippedLine ? !shippedLine.complete : false,
        receivedGross,
        reversed,
        receivedNet,
        discrepancy,
        status,
        fulfillmentCenters: [
          ...new Set(skuRows.map((r) => r.fields.fulfillmentCenter ?? '')),
        ].filter(Boolean),
        reversalWindowDays:
          days.length && reversalDays.length
            ? daysBetween(days[0], reversalDays[reversalDays.length - 1])
            : undefined,
        reversalEvents: reversalDays.length,
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
            `held, so any shortage shown may be understated.`
        );
      }
      if (line.status === 'shipped-unknown' && line.receivedNet !== 0) {
        warnings.push(
          `${line.sku}: no box label held, so what Amazon received cannot be ` +
            `checked against what was sent.`
        );
      }
    }

    const allDays = rows.map(day).filter(Boolean).sort();
    result.push({
      shipmentId,
      firstReceiptDate: allDays[0],
      lastReceiptDate: allDays[allDays.length - 1],
      lines: lines.sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? '')),
      warnings,
    });
  }

  return result.sort((a, b) =>
    (b.firstReceiptDate ?? '').localeCompare(a.firstReceiptDate ?? '')
  );
}
