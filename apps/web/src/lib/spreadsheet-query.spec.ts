import { describe, expect, it } from 'vitest';
import { cellNumber, querySheet } from './spreadsheet-query';

/**
 * The query engine the agent trusts instead of totalling previews. Every
 * failure here becomes a wrong figure stated confidently in chat — the sums
 * are the product; the honesty is in matchedRows/truncated saying exactly
 * what was and was not counted.
 */

// The live file's shape: Amazon's Sponsored Products search-term export.
const HEADERS = [
  'Campaign Name',
  'Customer Search Term',
  'Impressions',
  'Clicks',
  'Spend',
  '7 Day Total Sales',
  '7 Day Total Orders (#)',
];

const ROWS = [
  [
    'SP - Broad - Gran Del Val',
    'panama geisha coffee',
    '1200',
    '12',
    '$6.60',
    '$55.00',
    '1',
  ],
  [
    'SP - Broad - Gran Del Val',
    'geisha beans',
    '400',
    '2',
    '$1.10',
    '$0.00',
    '0',
  ],
  [
    'SP - Phrase - Gran Del Val',
    '1lb 100% panama geisha coffee',
    '90',
    '1',
    '$0.89',
    '$55.00',
    '1',
  ],
  [
    'Auto - close match - French Press',
    '24 oz french press',
    '800',
    '5',
    '$2.68',
    '$0.00',
    '0',
  ],
  [
    'Auto - close match - French Press',
    '32 ounce french press',
    '600',
    '4',
    '$2.68',
    '$34.95',
    '1',
  ],
];

const TABLE = { headers: HEADERS, rows: ROWS };

describe('cellNumber', () => {
  it('reads money, thousands and percent formatting as numbers', () => {
    expect(cellNumber('$6.60')).toBe(6.6);
    expect(cellNumber('1,600')).toBe(1600);
    expect(cellNumber('12.00%')).toBe(12);
    expect(cellNumber('panama')).toBeNaN();
    expect(cellNumber('')).toBeNaN();
  });
});

describe('querySheet', () => {
  it('groups and totals over every row, biggest first', () => {
    const result = querySheet(TABLE, {
      groupBy: ['Campaign Name'],
      aggregate: [
        { column: 'Spend', fn: 'sum' },
        { column: '7 Day Total Sales', fn: 'sum' },
      ],
    });

    expect(result.columns).toEqual([
      'Campaign Name',
      'sum(Spend)',
      'sum(7 Day Total Sales)',
    ]);
    expect(result.rows).toEqual([
      ['SP - Broad - Gran Del Val', 7.7, 55],
      ['Auto - close match - French Press', 5.36, 34.95],
      ['SP - Phrase - Gran Del Val', 0.89, 55],
    ]);
    expect(result.matchedRows).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it('filters with AND clauses, numerically where the op needs it', () => {
    // "Converting terms in the French Press campaign" — the live question.
    const result = querySheet(TABLE, {
      where: [
        { column: 'Campaign Name', op: 'contains', value: 'french press' },
        { column: '7 Day Total Orders (#)', op: 'gt', value: '0' },
      ],
      columns: ['Customer Search Term', 'Spend', '7 Day Total Sales'],
    });

    expect(result.rows).toEqual([['32 ounce french press', '$2.68', '$34.95']]);
    expect(result.matchedRows).toBe(1);
  });

  it('names the real columns when asked for one that does not exist', () => {
    expect(() =>
      querySheet(TABLE, {
        groupBy: ['campaign'],
        aggregate: [{ column: 'Spend', fn: 'sum' }],
      })
    ).toThrow(/No column "campaign".*"Campaign Name"/s);
  });

  it('matches column names case-insensitively', () => {
    const result = querySheet(TABLE, {
      groupBy: ['campaign name'],
      aggregate: [{ fn: 'count' }],
    });
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toEqual(['Campaign Name', 'count(*)']);
  });

  it('says when a limit cut the answer short', () => {
    const result = querySheet(TABLE, { limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.matchedRows).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('reports an unreadable aggregate as empty, never as zero', () => {
    const result = querySheet(TABLE, {
      groupBy: ['Campaign Name'],
      aggregate: [{ column: 'Customer Search Term', fn: 'sum' }],
    });
    // Summing a text column yields no number for any group — '' in every
    // aggregate cell, not 0, because "nothing to add" is not "adds to zero".
    for (const row of result.rows) expect(row[1]).toBe('');
  });
});
