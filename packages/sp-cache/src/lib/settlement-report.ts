import type { ReportRow } from './report-ingest.js';

/**
 * Three things a settlement report means that its rows do not say on their own.
 *
 * Pure functions over already-parsed rows, deliberately outside `parseReport`:
 * that path is generic across every FBA report and must stay that way. These
 * are the settlement-specific readings a consumer has to apply, and each one
 * exists because the naive reading is wrong in a way that silently produces a
 * plausible number.
 */

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type SettlementReconciliation = {
  settlementId: string;
  /** Amazon's own total for the period, from the header row. */
  declared: number | null;
  /** What the transaction rows actually add up to. */
  sum: number;
  /** `sum - declared`, or null when the file declared no total. */
  difference: number | null;
  /**
   * True when the rows add up to the declared deposit, false when they do not,
   * and **null when the file never declared one**.
   *
   * Three states rather than two on purpose: a missing header row means we do
   * not know, and reporting that as "does not balance" would send someone
   * hunting a discrepancy that no evidence supports.
   */
  balanced: boolean | null;
  rowCount: number;
};

/**
 * Amounts are written to the cent, so anything under half a cent per row is
 * float noise rather than a real discrepancy. Scaled by row count because the
 * error accumulates with the number of additions.
 */
function tolerance(rowCount: number): number {
  return Math.max(0.005, rowCount * 0.000001);
}

/**
 * Check each settlement's transaction rows against the total Amazon declared.
 *
 * This is the one integrity check the settlement report gives away free, and
 * the reason to prefer it over the transaction report: every figure derived
 * downstream ties back to money that actually reached the bank. A file that
 * does not balance has been truncated, filtered, or edited, and no analysis of
 * it is worth running.
 *
 * The declared total sits on a header row that blanks every other column, so it
 * contributes nothing to the sum and needs no exclusion.
 */
export function reconcileSettlements(
  rows: ReportRow[]
): SettlementReconciliation[] {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    if (row.reportKind !== 'settlement') continue;
    const id = row.fields.settlementId ?? '';
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }

  return [...groups.entries()].map(([settlementId, group]) => {
    let declared: number | null = null;
    let sum = 0;
    let rowCount = 0;
    for (const row of group) {
      const total = row.numbers?.amountTotal;
      if (total !== undefined && declared === null) declared = total;
      const amount = row.numbers?.amount;
      if (amount === undefined) continue;
      sum += amount;
      rowCount++;
    }
    sum = Math.round(sum * 100) / 100;
    const difference =
      declared === null ? null : Math.round((sum - declared) * 100) / 100;
    return {
      settlementId,
      declared,
      sum,
      difference,
      balanced:
        difference === null
          ? null
          : Math.abs(difference) <= tolerance(rowCount),
      rowCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Pass-through tax
// ---------------------------------------------------------------------------

/**
 * Amounts that move through the account without ever being the seller's money.
 *
 * Under marketplace facilitator rules Amazon collects sales tax from the buyer
 * and remits it itself, so the report carries both legs: the collected side as
 * `ItemPrice/<something>Tax`, the withheld side as
 * `ItemWithheldTax/MarketplaceFacilitatorTax-*`. They cancel to the cent, so
 * the deposit is unaffected.
 *
 * They must still be summed for reconciliation, because they are genuinely in
 * the file. They must never be summed for revenue: counting the collected leg
 * as income overstates revenue by precisely the withheld amount, and the
 * resulting figure looks entirely reasonable, which is what makes it dangerous.
 *
 * The collected side is matched on the `Tax` SUFFIX rather than an allowlist.
 * A list of the descriptions seen so far is the version of this that breaks
 * silently: written against one settlement it read `Tax` and `GiftWrapTax`,
 * then a year of real files turned up `ShippingTax` — pairing with
 * `MarketplaceFacilitatorTax-Shipping` — and $12.73 of tax was counted as
 * revenue with nothing to indicate it. `passThroughTaxResidual` exists so the
 * next variant surfaces instead.
 */
export function isPassThroughTax(row: ReportRow): boolean {
  const type = row.fields.amountType;
  const description = row.fields.amountDescription ?? '';
  if (type === 'ItemWithheldTax') return true;
  return type === 'ItemPrice' && /Tax$/.test(description);
}

/**
 * What the two tax legs fail to cancel by. Should be zero.
 *
 * Every dollar Amazon withholds it first collected, so summing the rows
 * `isPassThroughTax` matches gives zero across any complete set — verified at
 * exactly $0.00 over sixteen settlements. A non-zero result does not mean the
 * money is wrong; it means this module has stopped recognising one side of a
 * pair, and some revenue figure is now inflated by that amount.
 *
 * Cheap enough to assert on import, which is the only way a mismatch gets
 * noticed before it reaches a dashboard.
 */
export function passThroughTaxResidual(rows: ReportRow[]): number {
  const total = rows
    .filter(isPassThroughTax)
    .reduce((sum, row) => sum + (row.numbers?.amount ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * The rows that belong in a revenue, fee or margin figure.
 *
 * Use this rather than filtering by hand at each call site: every place that
 * forgets is a number that is wrong in the same direction.
 */
export function economicRows(rows: ReportRow[]): ReportRow[] {
  return rows.filter((row) => !isPassThroughTax(row));
}

// ---------------------------------------------------------------------------
// Grade and Resell
// ---------------------------------------------------------------------------

/**
 * Condition grades Amazon assigns to a Grade and Resell unit.
 *
 * Observed across sixteen settlements: LN, VG, GD, PO. AC is included because
 * Amazon documents it and its absence here is a fact about this seller's
 * inventory, not about the format.
 */
export const GRADE_CONDITIONS = new Set(['LN', 'VG', 'GD', 'AC', 'PO']);

const GRADED_PREFIX = 'amzn.gr.';

export type SkuIdentity = {
  /** The SKU exactly as the report wrote it. Stays the identity of the listing. */
  sku: string;
  /**
   * The new-condition SKU this unit came from, when it could be resolved.
   * Null for an unresolvable graded SKU — never a guess.
   */
  parentSku: string | null;
  /** 'new' for an ordinary SKU, a grade code for a graded one, 'unknown' if unreadable. */
  condition: string;
  graded: boolean;
};

/**
 * Split a Grade and Resell SKU into the parent it came from and its condition.
 *
 * Graded units are relisted returns, and Amazon mints a SKU per batch shaped
 * `amzn.gr.<parent>-<token>-<CONDITION>`. They are NOT duplicates to be merged
 * away: a Very Good unit is a different listing at a different price — measured
 * 5–23% below new across this seller's catalogue — so folding them into the
 * parent would quietly drag new-unit margin down and hide that the graded
 * channel exists at all. Equally they cannot be left wholly separate: Amazon
 * mints a fresh SKU per batch, thirty-three of them for twelve parents here, so
 * without the parent link every graded line is a bucket of one or two units.
 *
 * Hence: keep the SKU, add the parent and the grade beside it.
 *
 * **The parent is resolved against known SKUs, not by pattern.** The token
 * between parent and grade is opaque and may itself contain hyphens
 * (`...-DW-AIuLag-pWeg3K10-LN`) or end in one (`...-XhNNbefI--LN`), so nothing
 * in the string marks where the parent stops. A regex splitting on the last
 * hyphens looks right and mis-parses six of this seller's thirty-three graded
 * SKUs, inventing parents like `NMS-FB-350-DW-AIuLag`. Longest-prefix matching
 * against SKUs actually seen resolves all thirty-three.
 *
 * @param knownSkus New-condition SKUs to match against — the wider the
 *   catalogue, the more resolvable. Pass what the store knows; `collectKnownSkus`
 *   over the same file is the fallback when nothing else is available.
 */
export function resolveSku(
  sku: string,
  knownSkus: Iterable<string> = []
): SkuIdentity {
  if (!sku.startsWith(GRADED_PREFIX)) {
    return { sku, parentSku: sku, condition: 'new', graded: false };
  }

  let rest = sku.slice(GRADED_PREFIX.length);
  let condition = 'unknown';
  const tail = rest.slice(-2);
  if (rest.slice(-3, -2) === '-' && GRADE_CONDITIONS.has(tail)) {
    condition = tail;
    rest = rest.slice(0, -3);
  }

  // Longest first, so `FB-LFP-WHT-1600-100` wins over a shorter SKU that also
  // prefixes it. Requiring the separator stops `NMS-FB-350-BE` matching a
  // `NMS-FB-350-BEI` unit.
  const candidates = [...knownSkus]
    .filter((candidate) => !candidate.startsWith(GRADED_PREFIX))
    .sort((a, b) => b.length - a.length);
  const parentSku =
    candidates.find(
      (candidate) => rest === candidate || rest.startsWith(`${candidate}-`)
    ) ?? null;

  return { sku, parentSku, condition, graded: true };
}

/** Every new-condition SKU appearing in these rows, for use as the match set. */
export function collectKnownSkus(rows: ReportRow[]): Set<string> {
  const skus = new Set<string>();
  for (const row of rows) {
    const sku = row.fields.msku;
    if (sku && !sku.startsWith(GRADED_PREFIX)) skus.add(sku);
  }
  return skus;
}
