import {
  validateExtraction,
  allocateFreight,
  freightAllocationBasis,
  groupPurchaseDocuments,
  PURCHASE_AUTHORITY,
  reconcilePurchase,
  type DocumentRole,
  type ExtractedDocument,
  type ExtractedLine,
  type PurchaseDocument,
} from './document-extract.js';

/**
 * The documents these tests describe are the real shape of an Alibaba purchase:
 * an order receipt with one set of figures, a commercial invoice with another,
 * a waybill that bills nothing, and a proof of delivery that restates the same
 * consignment. Every assertion here is about refusing to add two documents that
 * describe the same goods.
 */

function line(overrides: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    description: 'Kraft cup 12oz',
    kind: 'product',
    quantity: 1000,
    unitPrice: 0.1,
    amount: 100,
    ...overrides,
  };
}

function extracted(
  overrides: Partial<ExtractedDocument> = {}
): ExtractedDocument {
  return {
    documentType: 'invoice',
    vendorName: 'Shenzhen Cup Co',
    currency: 'USD',
    lines: [line()],
    total: 100,
    ...overrides,
  };
}

function doc(
  documentId: string,
  role: DocumentRole,
  overrides: Partial<ExtractedDocument> = {}
): PurchaseDocument {
  return { documentId, role, extracted: extracted(overrides) };
}

describe('PURCHASE_AUTHORITY', () => {
  it('names one role per question, so no question has two answers', () => {
    const roles = Object.values(PURCHASE_AUTHORITY);
    expect(new Set(roles).size).toBe(roles.length);
    // Cost never comes from a payment: an amount moving is not what was bought.
    expect(PURCHASE_AUTHORITY.cost).toBe('commercial-invoice');
    expect(PURCHASE_AUTHORITY.payment).toBe('payment-record');
    expect(PURCHASE_AUTHORITY.weight).toBe('transport-document');
  });
});

describe('groupPurchaseDocuments', () => {
  it('joins a proof of delivery to its waybill on the tracking number', () => {
    const waybill = doc('d2', 'transport-document', {
      trackingNumber: '1234567890',
      actualWeightKg: 46,
    });
    const pod = doc('d3', 'proof-of-delivery', {
      trackingNumber: '1234567890',
      weightLb: 101.4,
      piecesDelivered: 4,
    });

    const { purchases } = groupPurchaseDocuments([waybill, pod]);

    expect(purchases).toHaveLength(1);
    expect(purchases[0].documentIds).toEqual(['d2', 'd3']);
    expect(purchases[0].joins).toEqual([
      { on: 'tracking-number', value: '1234567890', documentIds: ['d2', 'd3'] },
    ]);
  });

  it('joins the order receipt and the invoice that restates it', () => {
    const receipt = doc('d1', 'payment-record', {
      receiptNumber: 'AL-88231',
      total: 1.6,
    });
    const invoice = doc('d2', 'commercial-invoice', {
      receiptNumber: 'al-88231',
      invoiceNumber: 'INV-7',
      total: 1840,
    });

    const { purchases } = groupPurchaseDocuments([receipt, invoice]);

    expect(purchases).toHaveLength(1);
    // Case and surrounding space must not split a purchase in two.
    expect(purchases[0].documentIds).toEqual(['d1', 'd2']);
  });

  it('does NOT merge on same supplier and a nearby date — it suggests', () => {
    const first = doc('d1', 'commercial-invoice', {
      invoiceNumber: 'INV-1',
      documentDate: '2026-03-01',
    });
    const second = doc('d2', 'commercial-invoice', {
      invoiceNumber: 'INV-2',
      documentDate: '2026-03-05',
    });

    const { purchases, suggestions } = groupPurchaseDocuments([first, second]);

    // Two purchases, because merging them would make one invoice the cost
    // basis for goods the other one covered.
    expect(purchases).toHaveLength(2);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      documentIds: ['d1', 'd2'],
      daysApart: 4,
    });
  });

  it('does not suggest across suppliers, or across a wide date gap', () => {
    const mine = doc('d1', 'commercial-invoice', {
      invoiceNumber: 'INV-1',
      documentDate: '2026-03-01',
    });
    const other = doc('d2', 'commercial-invoice', {
      vendorName: 'Guangzhou Lids Ltd',
      invoiceNumber: 'INV-2',
      documentDate: '2026-03-02',
    });
    const distant = doc('d3', 'commercial-invoice', {
      invoiceNumber: 'INV-3',
      documentDate: '2026-06-01',
    });

    const { suggestions } = groupPurchaseDocuments([mine, other, distant]);

    expect(suggestions).toEqual([]);
  });

  it('is transitive: two waybills sharing an invoice number make one purchase', () => {
    const invoice = doc('d1', 'commercial-invoice', { invoiceNumber: 'INV-9' });
    const legA = doc('d2', 'transport-document', {
      invoiceNumber: 'INV-9',
      trackingNumber: 'AAA',
      chargeableWeightKg: 10,
    });
    const legB = doc('d3', 'transport-document', {
      invoiceNumber: 'INV-9',
      trackingNumber: 'BBB',
      chargeableWeightKg: 46,
    });

    const { purchases } = groupPurchaseDocuments([invoice, legA, legB]);

    expect(purchases).toHaveLength(1);
    expect(purchases[0].documentIds).toEqual(['d1', 'd2', 'd3']);
  });

  it('gives a document with no identifiers its own purchase', () => {
    const { purchases, suggestions } = groupPurchaseDocuments([
      doc('d1', 'other'),
    ]);
    expect(purchases).toEqual([
      { purchaseId: 'd1', documentIds: ['d1'], joins: [] },
    ]);
    expect(suggestions).toEqual([]);
  });
});

describe('reconcilePurchase', () => {
  it('costs from the invoice and reports the payment gap rather than summing', () => {
    const invoice = doc('d1', 'commercial-invoice', { total: 1840 });
    const receipt = doc('d2', 'payment-record', {
      total: 1.6,
      amountPaid: 1.6,
    });

    const result = reconcilePurchase([invoice, receipt]);

    expect(result.costBasisDocumentId).toBe('d1');
    expect(result.cogsTotal).toBe(1840);
    expect(result.paidTotal).toBe(1.6);
    // The two never add up to 1841.60 anywhere.
    expect(result.issues.map((issue) => issue.code)).toContain(
      'payment-shortfall'
    );
  });

  it('refuses to pick a basis when two invoices are attached', () => {
    const result = reconcilePurchase([
      doc('d1', 'commercial-invoice', { total: 1840 }),
      doc('d2', 'commercial-invoice', { total: 1900 }),
    ]);

    const blocker = result.issues.find(
      (issue) => issue.code === 'multiple-cost-basis'
    );
    expect(blocker?.severity).toBe('blocker');
    // 3740 must never appear: the totals are alternatives, not addends.
    expect(result.cogsTotal).toBe(1840);
  });

  it('blocks when only a payment record exists', () => {
    const result = reconcilePurchase([
      doc('d1', 'payment-record', { total: 1.6 }),
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain('no-cost-basis');
    expect(result.cogsTotal).toBe(0);
  });

  it('falls back to a proforma only when no invoice exists', () => {
    const result = reconcilePurchase([doc('d1', 'proforma', { total: 500 })]);
    expect(result.costBasisDocumentId).toBe('d1');
    expect(result.cogsTotal).toBe(500);
  });

  it('flags a waybill declared value that disagrees with the invoice', () => {
    const result = reconcilePurchase([
      doc('d1', 'commercial-invoice', { total: 1840 }),
      doc('d2', 'transport-document', {
        trackingNumber: 'AAA',
        declaredValue: 200,
      }),
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain(
      'value-mismatch'
    );
  });

  it('catches a weight read in the wrong unit', () => {
    const result = reconcilePurchase([
      doc('d1', 'commercial-invoice', { total: 100 }),
      doc('d2', 'proof-of-delivery', {
        trackingNumber: 'AAA',
        actualWeightKg: 18.45,
        weightLb: 18.45,
      }),
    ]);
    expect(
      result.issues.some((issue) => issue.message.includes('mis-read'))
    ).toBe(true);
  });

  it('flags a proof of delivery for a shipment not on this purchase', () => {
    const result = reconcilePurchase([
      doc('d1', 'commercial-invoice', { total: 100 }),
      doc('d2', 'transport-document', { trackingNumber: 'AAA' }),
      doc('d3', 'proof-of-delivery', { trackingNumber: 'ZZZ' }),
    ]);
    expect(
      result.issues.some((issue) =>
        issue.message.includes('does not match any waybill')
      )
    ).toBe(true);
  });
});

describe('freightAllocationBasis', () => {
  it('takes weights from waybills only, never from the POD restating them', () => {
    const basis = freightAllocationBasis([
      doc('d1', 'transport-document', {
        trackingNumber: 'AAA',
        chargeableWeightKg: 10,
      }),
      doc('d2', 'transport-document', {
        trackingNumber: 'BBB',
        chargeableWeightKg: 46,
      }),
      // Same consignment as BBB. Counting it would make the total 102kg.
      doc('d3', 'proof-of-delivery', {
        trackingNumber: 'BBB',
        actualWeightKg: 46,
      }),
    ]);

    expect(basis.totalWeightKg).toBe(56);
    expect(basis.shipments).toHaveLength(2);
    expect(basis.usable).toBe(true);
  });

  it('is unusable when a waybill states no weight', () => {
    const basis = freightAllocationBasis([
      doc('d1', 'transport-document', {
        trackingNumber: 'AAA',
        chargeableWeightKg: 10,
      }),
      doc('d2', 'transport-document', { trackingNumber: 'BBB' }),
    ]);
    expect(basis.usable).toBe(false);
  });

  it('prefers chargeable weight, which is what the carrier billed', () => {
    const basis = freightAllocationBasis([
      doc('d1', 'transport-document', {
        trackingNumber: 'AAA',
        chargeableWeightKg: 12,
        actualWeightKg: 9,
      }),
    ]);
    expect(basis.totalWeightKg).toBe(12);
  });
});

describe('allocateFreight', () => {
  const withFreight = (lines: ExtractedLine[], freight: number) =>
    doc('inv', 'commercial-invoice', {
      lines: [
        ...lines,
        line({
          description: 'Ocean freight',
          kind: 'freight',
          amount: freight,
          quantity: undefined,
          unitPrice: undefined,
        }),
      ],
      total: lines.reduce((sum, item) => sum + item.amount, 0) + freight,
    });

  it('splits by weight, and the parts sum to the freight exactly', () => {
    const result = allocateFreight(
      [
        withFreight(
          [
            line({ description: 'Cups', amount: 800, weightKg: 46 }),
            line({ description: 'Lids', amount: 200, weightKg: 10 }),
          ],
          100
        ),
      ],
      'weight'
    );

    expect(result.basis).toBe('weight');
    expect(result.refusals).toEqual([]);
    expect(result.shares.map((share) => share.amount)).toEqual([82.14, 17.86]);
    expect(
      result.shares.reduce((sum, share) => sum + share.amount, 0)
    ).toBeCloseTo(100, 10);
    expect(result.unallocated).toBe(0);
  });

  it('by units and by value give different answers, which is the point', () => {
    const lines = [
      line({ description: 'Cups', amount: 800, quantity: 1000, weightKg: 46 }),
      line({ description: 'Lids', amount: 200, quantity: 1000, weightKg: 10 }),
    ];

    const byUnits = allocateFreight([withFreight(lines, 100)], 'units');
    const byValue = allocateFreight([withFreight(lines, 100)], 'value');

    expect(byUnits.shares.map((share) => share.amount)).toEqual([50, 50]);
    expect(byValue.shares.map((share) => share.amount)).toEqual([80, 20]);
    // A 2x+ swing in landed cost depending on the basis, which is why the
    // basis is stated in the output rather than assumed.
    expect(byUnits.basis).toBe('units');
    expect(byValue.basis).toBe('value');
  });

  it('refuses a weight split when any product line has no weight', () => {
    const result = allocateFreight(
      [
        withFreight(
          [
            line({ description: 'Cups', amount: 800, weightKg: 46 }),
            line({ description: 'Lids', amount: 200 }),
          ],
          100
        ),
      ],
      'weight'
    );

    expect(result.shares).toEqual([]);
    expect(result.unallocated).toBe(100);
    expect(result.refusals.map((refusal) => refusal.code)).toEqual([
      'missing-weights',
    ]);
  });

  it('never puts freight on overhead, discount, fee or freight lines', () => {
    const invoice = doc('inv', 'commercial-invoice', {
      lines: [
        line({ description: 'Cups', amount: 800, quantity: 1000 }),
        line({ description: 'Design retainer', kind: 'overhead', amount: 500 }),
        line({ description: 'Volume discount', kind: 'discount', amount: -50 }),
        line({ description: 'Customs fee', kind: 'fee', amount: 40 }),
        line({ description: 'Freight', kind: 'freight', amount: 60 }),
      ],
      total: 1350,
    });

    const result = allocateFreight([invoice], 'units');

    // Freight and the customs fee are both what gets allocated: 60 + 40.
    expect(result.freightTotal).toBe(100);
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].description).toBe('Cups');
    expect(result.shares[0].amount).toBe(100);
  });

  it('reports a carrier invoice instead of adding it to the supplier freight', () => {
    const result = allocateFreight(
      [
        withFreight(
          [line({ description: 'Cups', amount: 800, quantity: 10 })],
          100
        ),
        doc('carrier', 'freight-invoice', { vendorName: 'DHL', total: 95 }),
      ],
      'units'
    );

    // 195 must never appear.
    expect(result.freightTotal).toBe(100);
    expect(result.refusals.map((refusal) => refusal.code)).toContain(
      'freight-billed-twice'
    );
  });

  it('refuses with no cost basis, because a waybill bills nothing', () => {
    const result = allocateFreight(
      [
        doc('d1', 'transport-document', {
          trackingNumber: 'AAA',
          chargeableWeightKg: 46,
        }),
      ],
      'weight'
    );

    expect(result.freightTotal).toBe(0);
    expect(result.refusals.map((refusal) => refusal.code)).toEqual([
      'no-cost-basis',
    ]);
  });

  it('says so when the invoice charged no freight', () => {
    const result = allocateFreight(
      [doc('inv', 'commercial-invoice', { total: 100 })],
      'units'
    );
    expect(result.refusals.map((refusal) => refusal.code)).toEqual([
      'no-freight',
    ]);
    expect(result.shares).toEqual([]);
  });

  it('refuses when every line reports zero for the chosen basis', () => {
    const result = allocateFreight(
      [
        withFreight(
          [line({ description: 'Sample', amount: 0, quantity: 0 })],
          25
        ),
      ],
      'units'
    );

    expect(result.refusals.map((refusal) => refusal.code)).toEqual([
      'zero-denominator',
    ]);
    expect(result.unallocated).toBe(25);
  });

  it('handles a freight total that cannot divide evenly', () => {
    const result = allocateFreight(
      [
        withFreight(
          [
            line({ description: 'A', amount: 1, quantity: 1 }),
            line({ description: 'B', amount: 1, quantity: 1 }),
            line({ description: 'C', amount: 1, quantity: 1 }),
          ],
          10
        ),
      ],
      'units'
    );

    expect(result.shares.map((share) => share.amount)).toEqual([
      3.34, 3.33, 3.33,
    ]);
    expect(
      result.shares.reduce((sum, share) => sum + share.amount, 0)
    ).toBeCloseTo(10, 10);
  });
});

describe('validateExtraction', () => {
  it('flags a document whose every amount is zero', () => {
    // Zero everywhere is arithmetically CONSISTENT — 0 × anything = 0, and
    // the lines sum to a 0 total — so no other check fires. Seen live on a
    // PO template whose price cells were left empty: total $0, no flag.
    // Free goods are not the likely explanation; missing prices are.
    const issues = validateExtraction({
      documentType: 'other',
      vendorName: 'Fernandez Plantation',
      currency: 'USD',
      total: 0,
      lines: [
        {
          description: 'Honey Geisha 250g',
          kind: 'product',
          quantity: 40,
          amount: 0,
        },
        {
          description: 'Washed Geisha 250g',
          kind: 'product',
          quantity: 40,
          amount: 0,
        },
      ],
    } as never);
    // The bare fixture also lacks a date and a document number, so other
    // review issues fire alongside — assert the one under test, not the list.
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'all-amounts-zero', severity: 'review' })
    );
  });

  it('does not flag a genuine zero-amount line among priced ones', () => {
    // A free sample line inside a real invoice is normal; the flag is for
    // documents where NOTHING carries a price.
    const issues = validateExtraction({
      documentType: 'invoice',
      vendorName: 'Vendor',
      currency: 'USD',
      total: 100,
      lines: [
        { description: 'Goods', kind: 'product', quantity: 10, amount: 100 },
        { description: 'Sample', kind: 'product', quantity: 1, amount: 0 },
      ],
    } as never);
    expect(
      issues.find((issue) => issue.code === 'all-amounts-zero')
    ).toBeUndefined();
  });
});
