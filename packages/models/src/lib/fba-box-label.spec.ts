/**
 * FBA box label parsing.
 *
 * The fixture is a real label with the shipper's name, address and phone
 * removed. Everything load-bearing — the box id format, the SKU and quantity
 * wording, the destination code — is verbatim.
 */

import { describe, expect, it } from 'vitest';
import { parseFbaBoxLabel, summariseBoxLabels } from './fba-box-label.js';

const label = (
  overrides: { box?: string; seq?: string; sku?: string; qty?: string } = {}
) =>
  `FBA Box ${overrides.box ?? '1 of 1'} - 20lb ` +
  'SHIP FROM: Sender Name Street Address City Country ' +
  'SHIP TO: FBA: Example LLC LBE1 100 EXAMPLE RD SOMETOWN, PA 15672-9703 ' +
  `United States Jun 12 Created: 2026/06/12 14:11 EDT (-04)` +
  `FBA19G33WPZ3U${overrides.seq ?? '000001'} ` +
  `Single SKU ${overrides.sku ?? 'FB-COF-GEI-75'} Qty ${
    overrides.qty ?? '100'
  } ` +
  'Exp Nov 30, 2026 PLEASE LEAVE THIS LABEL UNCOVERED';

describe('parseFbaBoxLabel', () => {
  it('splits the box id into shipment id and box sequence', () => {
    // FBA19G33WPZ3 + U + 000001. Shipment ids are FBA plus nine characters,
    // which held across every id in real ledger exports.
    const parsed = parseFbaBoxLabel(label({ seq: '000003' }));
    expect(parsed.shipmentId).toBe('FBA19G33WPZ3');
    expect(parsed.boxNumber).toBe(1); // "Box 1 of 1" outranks the sequence
  });

  it('reads the shipped quantity, SKU and destination', () => {
    const parsed = parseFbaBoxLabel(label());
    expect(parsed.sku).toBe('FB-COF-GEI-75');
    expect(parsed.quantity).toBe(100);
    expect(parsed.destinationFc).toBe('LBE1');
    expect(parsed.expiresOn).toBe('2026-11-30');
    expect(parsed.weightLb).toBe(20);
    expect(parsed.warnings).toEqual([]);
  });

  it('does not take a postcode or street number for a fulfillment centre', () => {
    // FC codes are three letters and a digit; the ship-to block is full of
    // numbers that must not win.
    expect(parseFbaBoxLabel(label()).destinationFc).toBe('LBE1');
  });

  it('refuses to guess a quantity for a mixed-SKU box', () => {
    const mixed = label().replace(
      'Single SKU FB-COF-GEI-75 Qty 100',
      'Multiple SKUs'
    );
    const parsed = parseFbaBoxLabel(mixed);
    expect(parsed.singleSku).toBe(false);
    expect(parsed.quantity).toBeUndefined();
    expect(parsed.warnings.join(' ')).toContain('mixed-SKU');
  });
});

describe('summariseBoxLabels', () => {
  it('counts a reprinted label once', () => {
    // Identity is (shipment, box). Printing two copies of box 2 and scanning
    // both must not inflate what was shipped.
    const labels = [
      parseFbaBoxLabel(label({ box: '1 of 2', seq: '000001', qty: '40' })),
      parseFbaBoxLabel(label({ box: '2 of 2', seq: '000002', qty: '40' })),
      parseFbaBoxLabel(label({ box: '2 of 2', seq: '000002', qty: '40' })),
    ];
    const [summary] = summariseBoxLabels(labels);
    expect(summary.boxesSeen).toBe(2);
    expect(summary.totalUnits).toBe(80);
    expect(summary.complete).toBe(true);
  });

  it('marks an incomplete set as a floor', () => {
    // 40 units from 1 of 3 boxes is a floor. Treated as a total it invents a
    // shortage that is not there.
    const [summary] = summariseBoxLabels([
      parseFbaBoxLabel(label({ box: '1 of 3', qty: '40' })),
    ]);
    expect(summary.complete).toBe(false);
    expect(summary.boxesDeclared).toBe(3);
    expect(summary.warnings.join(' ')).toContain('floor');
  });

  it('sums per SKU across boxes', () => {
    const [summary] = summariseBoxLabels([
      parseFbaBoxLabel(
        label({ box: '1 of 2', seq: '000001', sku: 'SKU-A', qty: '40' })
      ),
      parseFbaBoxLabel(
        label({ box: '2 of 2', seq: '000002', sku: 'SKU-B', qty: '25' })
      ),
    ]);
    expect(summary.units).toEqual(
      expect.arrayContaining([
        { sku: 'SKU-A', quantity: 40, boxes: 1 },
        { sku: 'SKU-B', quantity: 25, boxes: 1 },
      ])
    );
    expect(summary.totalUnits).toBe(65);
  });

  it('drops a label with no shipment id rather than counting it', () => {
    const parsed = parseFbaBoxLabel('Qty 40 Single SKU SKU-A');
    expect(parsed.shipmentId).toBeUndefined();
    expect(summariseBoxLabels([parsed])).toEqual([]);
  });
});
