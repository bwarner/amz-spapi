import type { ReimbursementRow } from '@amz-spapi/sp-cache';

/**
 * Net Amazon's reimbursements against their reversals, accountably.
 *
 * The reimbursements report is a ledger, not a status: a payment row does not
 * say whether it stuck. Amazon routinely pays for "lost" inbound units and
 * claws the payment back weeks later when the units surface (seen live:
 * $309.30 for 30 units paid 10 Jun, reversed 5 Jul — the units had been
 * received under the other SKU's label all along). Treating the payment row
 * alone as "already reimbursed" is wrong in both directions: it suppresses a
 * claim the seller is still owed, or it nets a claim against money Amazon took
 * back.
 *
 * Reversals join to their payment by `originalReimbursementId` when the
 * import has read that column; the fallback is same SKU and exactly opposite
 * amount. A reversal that matches nothing is surfaced, not dropped — it is
 * money leaving the account for a payment we cannot see, which the seller
 * should know about.
 */

export type NetReimbursement = {
  sku?: string;
  reason?: string;
  date?: string;
  units: number;
  amount: number;
  currency?: string;
  reimbursementId?: string;
  caseId?: string;
  /** The payment was clawed back — it covers nothing. */
  reversed: boolean;
  reversedOn?: string;
};

export type NettedReimbursements = {
  payments: NetReimbursement[];
  /** Reversals whose payment is not in the report window. */
  unmatchedReversals: ReimbursementRow[];
};

function isReversal(row: ReimbursementRow): boolean {
  return row.reason === 'Reimbursement_Reversal' || row.amount < 0;
}

export function netReimbursements(
  rows: ReimbursementRow[]
): NettedReimbursements {
  const payments: NetReimbursement[] = rows
    .filter((row) => !isReversal(row))
    .map((row) => ({
      sku: row.sku,
      reason: row.reason,
      date: row.date,
      units: row.quantity,
      amount: row.amount,
      currency: row.currency,
      reimbursementId: row.reimbursementId,
      caseId: row.caseId,
      reversed: false,
    }));

  const unmatchedReversals: ReimbursementRow[] = [];
  for (const reversal of rows.filter(isReversal)) {
    // Exact join first; the amount-and-SKU fallback only against payments not
    // already cancelled, oldest first, so two equal payments with one reversal
    // do not both die.
    const target =
      payments.find(
        (payment) =>
          !payment.reversed &&
          payment.reimbursementId !== undefined &&
          payment.reimbursementId === reversal.originalReimbursementId
      ) ??
      payments.find(
        (payment) =>
          !payment.reversed &&
          payment.sku === reversal.sku &&
          Math.abs(payment.amount + reversal.amount) < 0.005
      );
    if (target) {
      target.reversed = true;
      target.reversedOn = reversal.date;
    } else {
      unmatchedReversals.push(reversal);
    }
  }

  return { payments, unmatchedReversals };
}

/** Reimbursement reasons that pay for INBOUND losses — the same units an
 * inbound short-receipt claim would ask for. Post-receive reasons
 * (Lost_Warehouse, CustomerReturn, …) pay for different units and never
 * offset a shipment claim. */
const INBOUND_REASONS = new Set(['Lost_Inbound', 'Damaged_Inbound']);

/**
 * Standing payments that may already cover an inbound short on this SKU.
 *
 * "May": the report carries no shipment reference, so the tie is SKU plus an
 * optional not-before date (the shipment's first receipt). Callers must say
 * "may already cover", never "covers".
 */
export function inboundCoverFor(params: {
  netted: NettedReimbursements;
  sku: string;
  notBefore?: string;
}): NetReimbursement[] {
  return params.netted.payments.filter(
    (payment) =>
      !payment.reversed &&
      payment.sku === params.sku &&
      INBOUND_REASONS.has(payment.reason ?? '') &&
      (!params.notBefore || !payment.date || payment.date >= params.notBefore)
  );
}
