import {
  PurchaseOrderSchema,
  formatPoNumber,
  purchaseOrderTotals,
  vendorIdForName,
} from './purchase-order.js';

describe('vendorIdForName', () => {
  it('slugs to one id regardless of punctuation and case', () => {
    expect(vendorIdForName('Shenzhen  Ku-Xiu Tech.')).toBe(
      'shenzhen-ku-xiu-tech'
    );
    expect(vendorIdForName('shenzhen ku xiu tech')).toBe(
      'shenzhen-ku-xiu-tech'
    );
  });

  it('trims leading and trailing separators', () => {
    expect(vendorIdForName('  (Best) Vendor! ')).toBe('best-vendor');
  });
});

describe('purchaseOrderTotals', () => {
  it('sums lines, freight and fees in cents', () => {
    const totals = purchaseOrderTotals({
      lines: [
        { description: 'Widget', quantity: 500, unitPrice: 1.13 },
        { description: 'Gift box', quantity: 500, unitPrice: 0.27 },
      ],
      freightAmount: 250,
      otherFees: [{ description: 'Mold fee', amount: 120.5 }],
    });
    expect(totals.goodsSubtotal).toBe(700);
    expect(totals.freight).toBe(250);
    expect(totals.fees).toBe(120.5);
    expect(totals.total).toBe(1070.5);
    expect(totals.totalUnits).toBe(1000);
  });

  it('avoids float drift by rounding each figure to cents once', () => {
    // 3 × 0.1 = 0.30000000000000004 in raw floats.
    const totals = purchaseOrderTotals({
      lines: [{ description: 'Sticker', quantity: 3, unitPrice: 0.1 }],
    });
    expect(totals.goodsSubtotal).toBe(0.3);
    expect(totals.total).toBe(0.3);
  });
});

describe('formatPoNumber', () => {
  it('zero-pads so lexical order is chronological', () => {
    expect(formatPoNumber(2026, 7)).toBe('PO-2026-0007');
    expect(formatPoNumber(2026, 12345)).toBe('PO-2026-12345');
  });
});

describe('PurchaseOrderSchema', () => {
  const valid = {
    poNumber: 'PO-2026-0001',
    issueDate: '2026-08-03',
    vendorId: 'shenzhen-ku-xiu-tech',
    currency: 'USD',
    lines: [{ description: 'Widget', quantity: 100, unitPrice: 2.5 }],
  };

  it('accepts a minimal order', () => {
    expect(PurchaseOrderSchema.parse(valid).currency).toBe('USD');
  });

  it('defaults to revision 1, open', () => {
    const parsed = PurchaseOrderSchema.parse(valid);
    expect(parsed.revision).toBe(1);
    expect(parsed.status).toBe('open');
  });

  it('rejects an empty line list — a PO must order something', () => {
    expect(() => PurchaseOrderSchema.parse({ ...valid, lines: [] })).toThrow();
  });

  it('rejects a lowercase currency code', () => {
    expect(() =>
      PurchaseOrderSchema.parse({ ...valid, currency: 'usd' })
    ).toThrow();
  });

  it('rejects fractional quantities', () => {
    expect(() =>
      PurchaseOrderSchema.parse({
        ...valid,
        lines: [{ description: 'Widget', quantity: 1.5, unitPrice: 2 }],
      })
    ).toThrow();
  });
});
