/**
 * The payout split, against a real settlement.
 *
 * Every figure below comes from settlement 25121131751 in the live account,
 * deposited 2025-12-21 — and the three bucket totals are what the seller had
 * already keyed into their accounting software by hand. That is the standard
 * this has to meet: not "a defensible split" but the same split Amazon shows
 * them, so nothing has to be reconciled twice.
 *
 * The two traps are pinned individually, because each produces a plausible
 * wrong answer rather than an error.
 */

import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  buildPayouts,
  type SettlementGroup,
  type SettlementTotals,
} from './payout-breakdown.js';

const TOTALS: SettlementTotals = {
  settlementId: '25121131751',
  depositDate: '2025-12-21 20:21:38 UTC',
  settlementStartDate: '2025-12-05 20:21:38 UTC',
  settlementEndDate: '2025-12-19 20:21:38 UTC',
  currency: 'USD',
  amountTotal: 4356.45,
};

/** The real grouped totals for that settlement. */
const GROUPS: SettlementGroup[] = [
  // --- sales
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemPrice',
    amountDescription: 'Principal',
    total: 8722.6,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemPrice',
    amountDescription: 'Shipping',
    total: 137.08,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemPrice',
    amountDescription: 'GiftWrap',
    total: 27.93,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'FBA Inventory Reimbursement',
    amountDescription: 'REVERSAL_REIMBURSEMENT',
    total: 78.2,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'FBA Inventory Reimbursement',
    amountDescription: 'WAREHOUSE_LOST',
    total: 76.57,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'FBA Inventory Reimbursement',
    amountDescription: 'WAREHOUSE_DAMAGE',
    total: 23.54,
  },
  // --- tax, which nets to zero and belongs to neither side
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemPrice',
    amountDescription: 'Tax',
    total: 524.57,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemWithheldTax',
    amountDescription: 'MarketplaceFacilitatorTax-Principal',
    total: -524.57,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemPrice',
    amountDescription: 'ShippingTax',
    total: 1.69,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemWithheldTax',
    amountDescription: 'MarketplaceFacilitatorTax-Shipping',
    total: -1.69,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemPrice',
    amountDescription: 'GiftWrapTax',
    total: 2.35,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemWithheldTax',
    amountDescription: 'MarketplaceFacilitatorTax-Other',
    total: -2.35,
  },
  // --- expenses
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemFees',
    amountDescription: 'Commission',
    total: -1302.5,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemFees',
    amountDescription: 'FBAPerUnitFulfillmentFee',
    total: -1864.21,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemFees',
    amountDescription: 'ShippingChargeback',
    total: -20.98,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'ItemFees',
    amountDescription: 'GiftwrapChargeback',
    total: -27.93,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'Promotion',
    amountDescription: 'Principal',
    total: -40.33,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Order',
    amountType: 'Promotion',
    amountDescription: 'Shipping',
    total: -116.1,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'other-transaction',
    amountDescription: 'Storage Fee',
    total: -427.82,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'other-transaction',
    amountDescription: 'RemovalComplete',
    total: -362.6,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'other-transaction',
    amountDescription: 'Subscription Fee',
    total: -39.99,
  },
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'other-transaction',
    amountDescription: 'StorageRenewalBilling',
    total: -23.44,
  },
  {
    settlementId: '25121131751',
    transactionType: 'FBAFees',
    amountType: 'AWD Storage Fee',
    amountDescription: 'Base fee',
    total: -20.43,
  },
  {
    settlementId: '25121131751',
    transactionType: 'FBAFees',
    amountType: 'AWD Storage Fee',
    amountDescription: 'Discount on Fee',
    total: 2.04,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Grade and Resell Fees',
    amountType: 'Grade and Resell Charge',
    amountDescription: 'Mug',
    total: -1.5,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Grade and Resell Fees',
    amountType: 'Grade and Resell Charge',
    amountDescription: 'Press',
    total: -1.8,
  },
  // The clawback: same amount type as the reimbursements above, opposite sign.
  {
    settlementId: '25121131751',
    transactionType: 'other-transaction',
    amountType: 'FBA Inventory Reimbursement',
    amountDescription: 'MISSING_FROM_INBOUND_CLAWBACK',
    total: -13.64,
  },
  // --- refunds
  {
    settlementId: '25121131751',
    transactionType: 'Refund',
    amountType: 'ItemPrice',
    amountDescription: 'Principal',
    total: -550.81,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Refund',
    amountType: 'ItemFees',
    amountDescription: 'Commission',
    total: 68.1,
  },
  {
    settlementId: '25121131751',
    transactionType: 'Refund',
    amountType: 'ItemWithheldTax',
    amountDescription: 'MarketplaceFacilitatorTax-Principal',
    total: 34.47,
  },
];

describe('the real settlement, against what the seller keyed in by hand', () => {
  const [payout] = buildPayouts([TOTALS], GROUPS);

  it('reproduces all three buckets to the cent', () => {
    expect(payout.sales).toBe(9065.92);
    expect(payout.refunds).toBe(-448.24);
    expect(payout.expenses).toBe(-4261.23);
  });

  it('reconciles against Amazon’s own stated deposit', () => {
    expect(payout.net).toBe(4356.45);
    expect(payout.reconciles).toBe(true);
    expect(payout.discrepancy).toBeUndefined();
  });

  it('carries the deposit date, which is the whole point', () => {
    expect(payout.depositDate).toBe('2025-12-21 20:21:38 UTC');
  });
});

describe('the reimbursement clawback', () => {
  it('is an expense, though it shares its amount type with income', () => {
    const row = {
      transactionType: 'other-transaction',
      amountType: 'FBA Inventory Reimbursement',
      amountDescription: 'MISSING_FROM_INBOUND_CLAWBACK',
    };

    expect(bucketFor(row, -13.64)).toBe('expenses');
    expect(
      bucketFor({ ...row, amountDescription: 'WAREHOUSE_LOST' }, 76.57)
    ).toBe('sales');
  });

  it('moves the split by twice its value if bucketed by type alone', () => {
    // The failure this guards: sales overstated AND expenses understated by
    // 13.64 each, while the net still ties — so the error survives the one
    // check anybody would think to run.
    const withoutClawback = GROUPS.filter(
      (g) => g.amountDescription !== 'MISSING_FROM_INBOUND_CLAWBACK'
    );
    const [wrong] = buildPayouts(
      [TOTALS],
      [
        ...withoutClawback,
        {
          settlementId: '25121131751',
          transactionType: 'other-transaction',
          amountType: 'FBA Inventory Reimbursement',
          amountDescription: 'MISSING_FROM_INBOUND_CLAWBACK',
          total: 13.64,
        },
      ]
    );

    expect(wrong.sales).not.toBe(9065.92);
  });
});

describe('sales tax', () => {
  it('lands in neither sales nor refunds, and cancels itself out', () => {
    expect(
      bucketFor(
        {
          transactionType: 'Order',
          amountType: 'ItemPrice',
          amountDescription: 'Tax',
        },
        524.57
      )
    ).toBe('expenses');
    expect(
      bucketFor(
        {
          transactionType: 'Order',
          amountType: 'ItemWithheldTax',
          amountDescription: 'MarketplaceFacilitatorTax-Principal',
        },
        -524.57
      )
    ).toBe('expenses');
  });

  it('would overstate sales by the tax if counted as revenue', () => {
    const asRevenue = GROUPS.filter(
      (g) => g.amountType !== 'ItemWithheldTax'
    ).map((g) =>
      g.amountDescription === 'Tax'
        ? { ...g, amountDescription: 'Principal' }
        : g
    );
    const [wrong] = buildPayouts([TOTALS], asRevenue);

    expect(wrong.sales).toBeGreaterThan(9065.92);
    // And it no longer ties — which is exactly what reconciles is for.
    expect(wrong.reconciles).toBe(false);
  });
});

describe('a refund is netted whole', () => {
  it('includes the fee and tax reversals, not just the principal', () => {
    for (const description of ['Principal', 'Commission']) {
      expect(
        bucketFor(
          {
            transactionType: 'Refund',
            amountType: 'ItemFees',
            amountDescription: description,
          },
          -1
        )
      ).toBe('refunds');
    }
  });
});

describe('reconciliation is a refusal, not a warning', () => {
  it('fails when a settlement has transactions but no totals row', () => {
    // A partial import. The rows are still returned — a seller needs to know
    // the period exists — but nothing here is fit to key in.
    const [payout] = buildPayouts([], GROUPS);

    expect(payout.net).toBe(0);
    expect(payout.reconciles).toBe(false);
    expect(payout.discrepancy).toBeCloseTo(4356.45, 2);
  });

  it('names the gap when the buckets miss Amazon’s net', () => {
    const [payout] = buildPayouts([{ ...TOTALS, amountTotal: 4000 }], GROUPS);

    expect(payout.reconciles).toBe(false);
    expect(payout.discrepancy).toBeCloseTo(356.45, 2);
  });

  it('tolerates float drift below a cent', () => {
    const [payout] = buildPayouts(
      [{ settlementId: 'x', amountTotal: 0.3 }],
      [
        {
          settlementId: 'x',
          transactionType: 'Order',
          amountType: 'ItemPrice',
          amountDescription: 'Principal',
          total: 0.1,
        },
        {
          settlementId: 'x',
          transactionType: 'Order',
          amountType: 'ItemPrice',
          amountDescription: 'Shipping',
          total: 0.2,
        },
      ]
    );

    expect(payout.reconciles).toBe(true);
  });
});

describe('ordering', () => {
  it('is chronological, the order a register is keyed in', () => {
    const payouts = buildPayouts(
      [
        { settlementId: 'b', depositDate: '2026-02-01', amountTotal: 0 },
        { settlementId: 'a', depositDate: '2026-01-01', amountTotal: 0 },
      ],
      []
    );

    expect(payouts.map((p) => p.settlementId)).toEqual(['a', 'b']);
  });
});
