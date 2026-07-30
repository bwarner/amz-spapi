import { describe, expect, it } from 'vitest';
import type { ExtractedDocument } from '@farvisionllc/models';
import { crossCheckAgainstShipped } from './document-extraction';

/** Shaped like the real Panama Select invoice for shipment FBA19CBC1Q88. */
const invoice: ExtractedDocument = {
  documentType: 'invoice',
  vendorName: 'PANAMA SELECT COFFEE S.A.',
  currency: 'USD',
  documentDateRaw: '09/06/2026 09:14:10',
  total: 1.6,
  subtotal: 1.6,
  lines: [
    {
      description: 'Cafe Geisha process washed 250 gr roasted whole bean',
      kind: 'product',
      quantity: 80,
      unitPrice: 0.01,
      amount: 0.8,
      supplierRef: '0002',
    },
    {
      description: 'Cafe Geisha honey process 250 gr roasted whole bean',
      kind: 'product',
      quantity: 80,
      unitPrice: 0.01,
      amount: 0.8,
      supplierRef: '0008',
    },
  ],
};

const shipped = [
  { sku: 'FB-COF-GEI-250', quantity: 80 },
  { sku: 'FB-COF-HGE-250', quantity: 80 },
];

describe('crossCheckAgainstShipped', () => {
  it('does not claim a disagreement when no invoice line matched', () => {
    // The real failure: a supplier writes "Cafe Geisha process washed 250 gr"
    // with ref 0002, which matches no seller SKU. Reporting that as
    // "quantities differ" invents a discrepancy out of a naming gap.
    const results = crossCheckAgainstShipped(invoice, shipped);
    expect(results.every((r) => r.matched === false)).toBe(true);
    expect(results.every((r) => r.agrees === undefined)).toBe(true);
    expect(results.every((r) => r.invoiced === undefined)).toBe(true);
  });

  it('agrees when the supplier ref is the seller SKU', () => {
    const withRefs: ExtractedDocument = {
      ...invoice,
      lines: invoice.lines.map((line, index) => ({
        ...line,
        supplierRef: shipped[index].sku,
      })),
    };
    const results = crossCheckAgainstShipped(withRefs, shipped);
    expect(results.map((r) => r.matched)).toEqual([true, true]);
    expect(results.map((r) => r.agrees)).toEqual([true, true]);
    expect(results.map((r) => r.invoiced)).toEqual([80, 80]);
  });

  it('reports a genuine quantity disagreement as one', () => {
    const short: ExtractedDocument = {
      ...invoice,
      lines: [
        { ...invoice.lines[0], supplierRef: 'FB-COF-GEI-250', quantity: 60 },
      ],
    };
    const [result] = crossCheckAgainstShipped(short, [shipped[0]]);
    expect(result.matched).toBe(true);
    expect(result.agrees).toBe(false);
    expect(result.invoiced).toBe(60);
  });

  it('ignores freight and overhead lines when matching goods', () => {
    const withFreight: ExtractedDocument = {
      ...invoice,
      lines: [
        {
          description: 'FB-COF-GEI-250 air freight',
          kind: 'freight',
          amount: 120,
        },
        { ...invoice.lines[0], supplierRef: 'FB-COF-GEI-250' },
      ],
    };
    const [result] = crossCheckAgainstShipped(withFreight, [shipped[0]]);
    expect(result.invoiced).toBe(80);
  });
});
