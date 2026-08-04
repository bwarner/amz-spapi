import { describe, expect, it } from 'vitest';
import { breakable } from './purchase-order-pdf.js';

/**
 * SKU wrapping in the printed purchase order.
 *
 * The bug: `FB-COF-HGE-250` printed straight over the description with no gap
 * between them, because react-pdf treats a word as one unbreakable atom and
 * does not clip what overflows its column.
 *
 * The constraint that makes this non-trivial: a purchase order is sent to a
 * vendor, so the SKU printed has to be the SKU stored — exactly. Two fixes
 * that wrapped correctly were rejected for violating that, and the first
 * assertion below is the one that caught them.
 */

const SKU = 'FB-COF-HGE-250';
const LONG = 'FB-COF-WASHED-GEISHA-1000-XL';

/** What the vendor reads, once the wrap is undone. */
const printed = (text: string) => breakable(text).split('\n').join('');

describe('the SKU is never altered', () => {
  it('adds no character to a long SKU, only line breaks', () => {
    // Hyphenating at the SKU's own hyphens passed a visual check and failed
    // this: react-pdf appends a `-` at each break, so the page said
    // `FB-COF-WASHED--GEISHA-1000-XL` — one hyphen more than the real SKU.
    expect(printed(LONG)).toBe(LONG);
  });

  it('adds nothing to a short SKU either', () => {
    expect(printed(SKU)).toBe(SKU);
  });

  it('inserts no invisible characters', () => {
    // Zero-width spaces were the other rejected fix. They also render with
    // real width in react-pdf, but the reason to assert here is that they
    // travel into anything copied out of the PDF.
    expect(breakable(LONG)).not.toMatch(/[\u200B-\u200D\uFEFF]/);
  });
});

describe('wrapping', () => {
  it('leaves a SKU that fits on one line', () => {
    // The reported SKU. Wrapping it would be a regression in the other
    // direction — a two-line cell where one line was correct.
    expect(breakable(SKU)).not.toContain('\n');
  });

  it('wraps one that does not fit', () => {
    expect(breakable(LONG)).toContain('\n');
  });

  it('breaks after a hyphen, not mid-token', () => {
    // Where a reader expects the break. `FB-COF-WASHED-` / `GEISHA-1000-XL`
    // reads as a continuation; `FB-COF-WASH` / `ED-GEISHA...` reads as two
    // different SKUs.
    for (const line of breakable(LONG).split('\n').slice(0, -1)) {
      expect(line.endsWith('-')).toBe(true);
    }
  });

  it('keeps every line inside the column', () => {
    for (const line of breakable(LONG).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(18);
    }
  });

  it('splits a long run that has no hyphen to break at', () => {
    // A SKU with no separators still cannot be allowed to overflow — better an
    // awkward break than text printed over the next column.
    const solid = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    const lines = breakable(solid).split('\n');

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(solid);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(18);
  });
});

describe('edge cases', () => {
  it('handles an empty SKU', () => {
    // Lines carry an optional SKU, and the cell renders '' when absent.
    expect(breakable('')).toBe('');
  });

  it('handles a SKU that is only hyphens', () => {
    expect(printed('---')).toBe('---');
  });
});
