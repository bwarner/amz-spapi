import { describe, expect, it } from 'vitest';
import { inboundCoverFor, netReimbursements } from './reimbursements';
import type { ReimbursementRow } from '@amz-spapi/sp-cache';

/**
 * Netting reversals against payments. Every failure here miscounts money:
 * a reversed payment treated as cover suppresses a claim the seller is owed;
 * a double-cancelled payment invents a clawback that never happened.
 */

function row(overrides: Partial<ReimbursementRow>): ReimbursementRow {
  return { quantity: 0, amount: 0, ...overrides };
}

const PAID_30: ReimbursementRow = row({
  sku: 'FB-COF-HGE-250',
  reason: 'Lost_Inbound',
  date: '2026-06-10',
  quantity: 30,
  amount: 309.3,
  reimbursementId: '22348776371',
  caseId: '20441582891',
});

describe('netReimbursements', () => {
  it('joins a reversal to its payment by originalReimbursementId', () => {
    const { payments, unmatchedReversals } = netReimbursements([
      PAID_30,
      row({
        sku: 'FB-COF-HGE-250',
        reason: 'Reimbursement_Reversal',
        date: '2026-07-05',
        quantity: -30,
        amount: -309.3,
        originalReimbursementId: '22348776371',
      }),
    ]);

    expect(payments).toEqual([
      expect.objectContaining({ reversed: true, reversedOn: '2026-07-05' }),
    ]);
    expect(unmatchedReversals).toEqual([]);
  });

  it('falls back to SKU-and-amount when the join column was not read', () => {
    // The live import stored original-reimbursement-id unmapped, so the
    // fallback is what nets the seller's real data until a re-import.
    const { payments } = netReimbursements([
      PAID_30,
      row({
        sku: 'FB-COF-HGE-250',
        reason: 'Reimbursement_Reversal',
        quantity: -30,
        amount: -309.3,
      }),
    ]);
    expect(payments[0].reversed).toBe(true);
  });

  it('one reversal cancels one payment, not every equal one', () => {
    const twin = { ...PAID_30, reimbursementId: 'other' };
    const { payments } = netReimbursements([
      PAID_30,
      twin,
      row({
        sku: 'FB-COF-HGE-250',
        reason: 'Reimbursement_Reversal',
        quantity: -30,
        amount: -309.3,
      }),
    ]);

    expect(payments.filter((payment) => payment.reversed)).toHaveLength(1);
  });

  it('surfaces a reversal that matches nothing instead of dropping it', () => {
    const { unmatchedReversals } = netReimbursements([
      row({
        sku: 'TPI-FB-600-GLS-FNSKU',
        reason: 'Reimbursement_Reversal',
        quantity: 0,
        amount: -5.36,
      }),
    ]);
    expect(unmatchedReversals).toHaveLength(1);
  });
});

describe('inboundCoverFor', () => {
  const NETTED = netReimbursements([
    PAID_30,
    // Same SKU, but a post-receive loss — pays for different units.
    row({
      sku: 'FB-COF-HGE-250',
      reason: 'Lost_Warehouse',
      date: '2026-06-30',
      quantity: 1,
      amount: 5.16,
    }),
    // A customer-order refund — never offsets an inbound claim.
    row({
      sku: 'FB-COF-HGE-250',
      reason: 'CustomerReturn',
      date: '2026-07-05',
      quantity: 1,
      amount: 34.3,
    }),
  ]);

  it('returns only inbound-loss payments, not warehouse or order refunds', () => {
    const cover = inboundCoverFor({ netted: NETTED, sku: 'FB-COF-HGE-250' });
    expect(cover).toEqual([
      expect.objectContaining({ reason: 'Lost_Inbound', units: 30 }),
    ]);
  });

  it('excludes a payment that was clawed back', () => {
    const netted = netReimbursements([
      PAID_30,
      row({
        sku: 'FB-COF-HGE-250',
        reason: 'Reimbursement_Reversal',
        quantity: -30,
        amount: -309.3,
        originalReimbursementId: '22348776371',
      }),
    ]);
    expect(inboundCoverFor({ netted, sku: 'FB-COF-HGE-250' })).toEqual([]);
  });

  it('ignores payments older than the shipment they would cover', () => {
    const cover = inboundCoverFor({
      netted: NETTED,
      sku: 'FB-COF-HGE-250',
      notBefore: '2026-07-01',
    });
    expect(cover).toEqual([]);
  });
});
