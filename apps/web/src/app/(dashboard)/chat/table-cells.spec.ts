/**
 * Cell classification, against values from real assistant answers.
 *
 * #72 set every cell in fixed pitch and forbade it from wrapping, so a SKU read
 * correctly as one token — and so did a product name, which then ran off the
 * side of the page and made a twenty-row listing table unusable. The rule is
 * per cell now, and this is where the line sits.
 */

import { describe, expect, it } from 'vitest';
import { cellClass, cellText, classifyCell } from './table-cells';

describe('classifyCell', () => {
  it('keeps Amazon identifiers in one unbroken token', () => {
    for (const id of [
      'B0FRD9RR2B', // ASIN
      'X004ZMR8LT', // FNSKU
      'FB-LFP-WHT-1600-100', // seller SKU
      'TMB-FB-40OZ-CHAR-001',
      '111-2223334-5556667', // order id
    ]) {
      expect(classifyCell(id)).toBe('identifier');
    }
  });

  it('treats product names as prose, so they wrap', () => {
    // The regression that made this worth fixing.
    expect(
      classifyCell('Gran Del Val Geisha Coffee Whole Beans – Washed, 250g')
    ).toBe('prose');
    expect(
      classifyCell('54oz French Press Coffee Maker, Stainless Steel')
    ).toBe('prose');
  });

  it('right-aligns figures however they are written', () => {
    for (const value of ['22.92', '$27.65', '1,234.56', '-4.50', '13.2%']) {
      expect(classifyCell(value)).toBe('numeric');
    }
  });

  it('does not mistake short words or statuses for identifiers', () => {
    // Upper case and no spaces, but far too short to be an Amazon id.
    for (const value of ['USD', 'US', 'MAIN', 'Active', '✅ Active']) {
      expect(classifyCell(value)).not.toBe('identifier');
    }
  });

  it('does not read a bare symbol as a figure', () => {
    expect(classifyCell('$')).toBe('prose');
    expect(classifyCell('%')).toBe('prose');
    expect(classifyCell('—')).toBe('prose');
  });

  it('classifies an empty cell as prose rather than throwing', () => {
    expect(classifyCell('')).toBe('prose');
    expect(classifyCell('   ')).toBe('prose');
  });
});

describe('cellClass', () => {
  it('reserves width only for text long enough to need it', () => {
    // Found by looking at the state gallery: a fulfilment centre code is five
    // characters, one short of the identifier pattern, and was being given
    // twelve rems — pushing the columns that mattered off the side.
    expect(cellClass('prose', 'XAB40')).toBe('');
    expect(
      cellClass('prose', 'Gran Del Val Geisha Coffee Whole Beans – Washed')
    ).toBe('min-w-[12rem]');
  });

  it('does not reserve width for identifiers or figures', () => {
    expect(cellClass('identifier', 'B0FRD9RR2B')).not.toContain('min-w');
    expect(cellClass('numeric', '$27.65')).toContain('text-right');
  });
});

describe('cellText', () => {
  it('reads a plain string cell', () => {
    expect(cellText('B0FRD9RR2B')).toBe('B0FRD9RR2B');
  });

  it('reads through the wrappers the model puts round values', () => {
    // `| **B0FRD9RR2B** |` arrives as an element, not a string, and a cell that
    // classified as prose because of the emphasis would lose its fixed pitch.
    const strong = {
      type: 'strong',
      props: { children: 'B0FRD9RR2B' },
    } as unknown as Parameters<typeof cellText>[0];
    expect(cellText(strong)).toBe('B0FRD9RR2B');
    expect(classifyCell(cellText(strong))).toBe('identifier');
  });

  it('joins the pieces of a mixed cell', () => {
    expect(cellText(['12', '.', '50'])).toBe('12.50');
  });

  it('ignores nothing-values instead of printing them', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(false)).toBe('');
  });
});
