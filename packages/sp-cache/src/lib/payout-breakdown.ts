/**
 * A settlement as a bookkeeping entry: one dated deposit, split three ways.
 *
 * This exists because the split is a business rule with an exact definition
 * and a non-obvious one, and asking a model to reassemble it from grouped
 * totals every fortnight is how you get a plausible number that does not
 * reconcile. Encoded here it is tested once and cannot drift.
 *
 * The three buckets are Amazon's own, from the Net Proceeds panel in Seller
 * Central — Sales, Refunds, Expenses, summing to the deposit — because that is
 * what a seller is looking at while typing into their accounting software.
 * Reproducing some defensible-but-different cut would force them to reconcile
 * our numbers against Amazon's by hand, which is the work this removes.
 *
 * Verified against a real settlement (25121131751, deposited 2025-12-21):
 * sales 9,065.92, refunds -448.24, expenses -4,261.23, net 4,356.45 — every
 * figure matching what the seller had already keyed in by hand.
 *
 * Two subtleties, both of which produce a wrong answer silently:
 *
 * 1. `FBA Inventory Reimbursement` is not all income. It carries clawbacks —
 *    MISSING_FROM_INBOUND_CLAWBACK and the like — as NEGATIVE rows under the
 *    same amount type. Amazon counts only the positive ones as Sales and puts
 *    the clawbacks in Expenses, so bucketing by amount type alone overstates
 *    sales and understates costs by the clawback, twice over.
 * 2. Sales tax belongs to NEITHER bucket. `ItemPrice/Tax` is cancelled exactly
 *    by `ItemWithheldTax/MarketplaceFacilitatorTax-Principal`: Amazon collects
 *    it and remits it, so it never touches proceeds. Counting the credit as
 *    revenue without its offset overstates sales — by $528.61 on the
 *    settlement above. Both land in Expenses here, where they cancel and the
 *    totals stay right.
 */

import { collectionName } from '@amz-spapi/couchbase-utils';
import { reportStorage } from './report-store.js';

/** What a settlement row contributes to. */
export type PayoutBucket = 'sales' | 'refunds' | 'expenses';

/** The identifying fields of a settlement row, as stored. */
export type SettlementRowKey = {
  transactionType?: string | null;
  amountType?: string | null;
  amountDescription?: string | null;
};

/**
 * The `ItemPrice` descriptions Amazon counts as Sales.
 *
 * An allowlist, not "everything except tax", so a description nobody has seen
 * before lands in Expenses and shows up as a reconciliation failure rather
 * than quietly inflating revenue.
 */
const SALES_ITEM_PRICE = new Set(['Principal', 'Shipping', 'GiftWrap']);

const INVENTORY_REIMBURSEMENT = 'FBA Inventory Reimbursement';

/**
 * Which bucket a row belongs in.
 *
 * `amount` is a parameter because the reimbursement split is sign-sensitive:
 * the same amount type is income when positive and a cost when negative.
 */
export function bucketFor(row: SettlementRowKey, amount: number): PayoutBucket {
  // A refund is a refund whatever it is made of — the principal coming back,
  // and the fee and tax reversals that accompany it. Amazon nets all three.
  if (row.transactionType === 'Refund') return 'refunds';

  if (row.amountType === INVENTORY_REIMBURSEMENT) {
    return amount > 0 ? 'sales' : 'expenses';
  }

  if (
    row.amountType === 'ItemPrice' &&
    SALES_ITEM_PRICE.has(row.amountDescription ?? '')
  ) {
    return 'sales';
  }

  return 'expenses';
}

/** One grouped total from storage, before bucketing. */
export type SettlementGroup = SettlementRowKey & {
  settlementId: string;
  total: number;
};

/** The settlement's own totals row: the deposit Amazon says it made. */
export type SettlementTotals = {
  settlementId: string;
  depositDate?: string | null;
  settlementStartDate?: string | null;
  settlementEndDate?: string | null;
  currency?: string | null;
  /** Amazon's stated net, from the totals row. */
  amountTotal: number;
};

export type Payout = {
  settlementId: string;
  /** The day the money landed. Absent only when the totals row is missing. */
  depositDate?: string;
  periodStart?: string;
  periodEnd?: string;
  currency?: string;
  sales: number;
  refunds: number;
  expenses: number;
  /** Amazon's stated net for the settlement. */
  net: number;
  /**
   * Whether the three buckets add up to Amazon's own net.
   *
   * The point of the whole exercise. A split that does not reconcile is not a
   * rounding quibble — it means a row was categorised into nothing, or the
   * import is partial — and a seller must not key it in. False here is a
   * refusal to vouch for the figures, not a warning to be styled and ignored.
   */
  reconciles: boolean;
  /** Present when it does not: buckets minus net, so the gap is nameable. */
  discrepancy?: number;
};

/** Money compares to the cent; floating point does not compare exactly. */
const CENT = 0.005;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Assemble dated, split payouts from the totals rows and the grouped
 * transaction rows.
 *
 * Pure, so the bucketing rules can be tested against real settlement shapes
 * without a database. Settlements with transactions but no totals row are
 * returned too, flagged as not reconciling — a partial import is a fact the
 * seller needs, and dropping those rows would silently shrink their year.
 */
export function buildPayouts(
  totals: SettlementTotals[],
  groups: SettlementGroup[]
): Payout[] {
  const byId = new Map<string, Payout>();

  for (const total of totals) {
    byId.set(total.settlementId, {
      settlementId: total.settlementId,
      ...(total.depositDate ? { depositDate: total.depositDate } : {}),
      ...(total.settlementStartDate
        ? { periodStart: total.settlementStartDate }
        : {}),
      ...(total.settlementEndDate
        ? { periodEnd: total.settlementEndDate }
        : {}),
      ...(total.currency ? { currency: total.currency } : {}),
      sales: 0,
      refunds: 0,
      expenses: 0,
      net: total.amountTotal,
      reconciles: false,
    });
  }

  for (const group of groups) {
    let payout = byId.get(group.settlementId);
    if (!payout) {
      // Transactions with no totals row: a settlement whose header never
      // imported, or the open period. Kept, and it will fail to reconcile.
      payout = {
        settlementId: group.settlementId,
        sales: 0,
        refunds: 0,
        expenses: 0,
        net: 0,
        reconciles: false,
      };
      byId.set(group.settlementId, payout);
    }
    payout[bucketFor(group, group.total)] += group.total;
  }

  return [...byId.values()]
    .map((payout) => {
      const sales = round(payout.sales);
      const refunds = round(payout.refunds);
      const expenses = round(payout.expenses);
      const summed = round(sales + refunds + expenses);
      const discrepancy = round(summed - payout.net);
      return {
        ...payout,
        sales,
        refunds,
        expenses,
        reconciles: Math.abs(discrepancy) < CENT,
        ...(Math.abs(discrepancy) < CENT ? {} : { discrepancy }),
      };
    })
    .sort((a, b) => (a.depositDate ?? '').localeCompare(b.depositDate ?? ''));
}

const SCOPE = 'reports';
const ROWS = `\`${collectionName(SCOPE, 'rows')}\``;

/** Just the date part of Amazon's "2025-12-21 20:21:38 UTC". */
function isoDay(stamp: string | null | undefined): string | undefined {
  return stamp?.slice(0, 10);
}

/**
 * Dated, split payouts for a seller, ready to key into a register.
 *
 * Two queries rather than one, because the two halves live on different rows.
 * The deposit date and Amazon's stated net are on a single totals row per
 * settlement; the transactions that make it up are the thousands of rows
 * beneath, which carry no date at all. Joining them in the database would mean
 * a self-join over a collection where 1 row in 1,000 is the one you want, so
 * the totals rows are fetched whole — there are tens of them, not thousands —
 * and the window is applied to their deposit dates here.
 *
 * `from`/`to` are ISO days matched against the DEPOSIT date, which is the
 * question a bookkeeper is asking: what landed in my account this quarter.
 * Filtering on the transaction dates instead would pull in a settlement that
 * merely straddles the boundary and pay it out in the wrong period.
 */
export async function getPayoutBreakdown(params: {
  sellerId: string;
  from?: string;
  to?: string;
}): Promise<{ payouts: Payout[]; unreconciled: number }> {
  const { rows: totalsRows } = await reportStorage.executeQuery<
    Record<string, string | number | null>
  >(
    SCOPE,
    `SELECT d.fields.settlementId AS settlementId,
            d.fields.depositDate AS depositDate,
            d.fields.settlementStartDate AS settlementStartDate,
            d.fields.settlementEndDate AS settlementEndDate,
            d.fields.currency AS currency,
            d.numbers.amountTotal AS amountTotal
       FROM ${ROWS} AS d
      WHERE d.sellerId = $sellerId
        AND d.reportKind = 'settlement'
        AND d.numbers.amountTotal IS NOT MISSING`,
    { parameters: { sellerId: params.sellerId }, readonly: true }
  );

  const totals: SettlementTotals[] = totalsRows
    .map((row) => ({
      settlementId: String(row['settlementId'] ?? ''),
      depositDate: (row['depositDate'] as string | null) ?? null,
      settlementStartDate:
        (row['settlementStartDate'] as string | null) ?? null,
      settlementEndDate: (row['settlementEndDate'] as string | null) ?? null,
      currency: (row['currency'] as string | null) ?? null,
      amountTotal: Number(row['amountTotal']) || 0,
    }))
    .filter((total) => {
      if (!total.settlementId) return false;
      const day = isoDay(total.depositDate);
      // A settlement with no deposit date cannot be placed in a window. It is
      // dropped rather than guessed at — it would otherwise appear in every
      // window, or none, depending on how the comparison fell.
      if (!day) return false;
      if (params.from && day < params.from) return false;
      if (params.to && day > params.to) return false;
      return true;
    });

  if (totals.length === 0) return { payouts: [], unreconciled: 0 };

  const ids = totals.map((total) => total.settlementId);
  const { rows: groupRows } = await reportStorage.executeQuery<
    Record<string, string | number | null>
  >(
    SCOPE,
    `SELECT d.fields.settlementId AS settlementId,
            d.fields.transactionType AS transactionType,
            d.fields.amountType AS amountType,
            d.fields.amountDescription AS amountDescription,
            SUM(d.numbers.amount) AS total
       FROM ${ROWS} AS d
      WHERE d.sellerId = $sellerId
        AND d.reportKind = 'settlement'
        AND d.fields.settlementId IN $ids
        AND d.numbers.amount IS NOT MISSING
      GROUP BY d.fields.settlementId, d.fields.transactionType,
               d.fields.amountType, d.fields.amountDescription`,
    { parameters: { sellerId: params.sellerId, ids }, readonly: true }
  );

  const groups: SettlementGroup[] = groupRows.map((row) => ({
    settlementId: String(row['settlementId'] ?? ''),
    transactionType: (row['transactionType'] as string | null) ?? null,
    amountType: (row['amountType'] as string | null) ?? null,
    amountDescription: (row['amountDescription'] as string | null) ?? null,
    total: Number(row['total']) || 0,
  }));

  const payouts = buildPayouts(totals, groups).map((payout) => ({
    ...payout,
    ...(payout.depositDate
      ? { depositDate: isoDay(payout.depositDate) as string }
      : {}),
    ...(payout.periodStart ? { periodStart: isoDay(payout.periodStart) } : {}),
    ...(payout.periodEnd ? { periodEnd: isoDay(payout.periodEnd) } : {}),
  }));

  return {
    payouts,
    unreconciled: payouts.filter((payout) => !payout.reconciles).length,
  };
}
