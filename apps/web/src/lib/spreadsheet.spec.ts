import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  previewAsMarkdown,
  readSpreadsheet,
  SpreadsheetError,
} from './spreadsheet';

/**
 * The parts that would mislead rather than fail: a preview that looks complete
 * when it is truncated, and a row whose cells no longer line up with the header
 * it is read against.
 */

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer
  );
}

const SIMPLE = [
  ['sku', 'units', 'cost'],
  ['WIDGET-1', 100, 12.5],
  ['WIDGET-2', 40, 9],
];

describe('readSpreadsheet', () => {
  it('reads an xlsx into a header and rows', () => {
    const preview = readSpreadsheet(workbook({ Sheet1: SIMPLE }));

    expect(preview.header).toEqual(['sku', 'units', 'cost']);
    expect(preview.rows[0][0]).toBe('WIDGET-1');
    expect(preview.totalRows).toBe(2);
    expect(preview.truncated).toBe(false);
  });

  it('reads a csv the same way, so the container does not change behaviour', () => {
    const csv = Buffer.from('sku,units\nWIDGET-1,100\nWIDGET-2,40\n');

    const preview = readSpreadsheet(csv);

    expect(preview.header).toEqual(['sku', 'units']);
    expect(preview.totalRows).toBe(2);
  });

  it('skips a blank cover sheet rather than reporting the file as empty', () => {
    // A workbook whose first tab is a title page is common; picking [0] blindly
    // makes a perfectly good file look empty.
    const preview = readSpreadsheet(workbook({ Cover: [], Data: SIMPLE }));

    expect(preview.sheetName).toBe('Data');
    expect(preview.header).toEqual(['sku', 'units', 'cost']);
  });

  it('names every sheet, so a multi-tab workbook can say so', () => {
    const preview = readSpreadsheet(workbook({ Data: SIMPLE, Notes: [['x']] }));

    expect(preview.sheetNames).toEqual(['Data', 'Notes']);
  });

  it('marks a large sheet truncated rather than quietly showing part of it', () => {
    const many = [
      ['sku'],
      ...Array.from({ length: 500 }, (_, i) => [`SKU-${i}`]),
    ];

    const preview = readSpreadsheet(workbook({ Big: many }));

    expect(preview.totalRows).toBe(500);
    expect(preview.truncated).toBe(true);
    expect(preview.rows.length).toBeLessThan(500);
  });

  it('keeps short rows aligned with the header', () => {
    // A sparse row must not shift its values left into the wrong columns —
    // that turns a blank cost into a unit count.
    const preview = readSpreadsheet(
      workbook({
        Sheet1: [
          ['sku', 'units', 'cost'],
          ['WIDGET-1', '', 12.5],
        ],
      })
    );

    expect(preview.rows[0]).toEqual(['WIDGET-1', '', '12.5']);
  });

  it('refuses an empty sheet with a message rather than an empty table', () => {
    expect(() => readSpreadsheet(workbook({ Sheet1: [] }))).toThrow(
      SpreadsheetError
    );
  });

  it('refuses bytes that are not a spreadsheet at all', () => {
    expect(() => readSpreadsheet(Buffer.from([0x00, 0x01, 0x02]))).toThrow(
      SpreadsheetError
    );
  });
});

describe('previewAsMarkdown', () => {
  it('renders a table the markdown renderer can display', () => {
    const markdown = previewAsMarkdown(
      readSpreadsheet(workbook({ Sheet1: SIMPLE }))
    );

    expect(markdown).toContain('| sku | units | cost |');
    expect(markdown).toContain('| --- | --- | --- |');
    expect(markdown).toContain('| WIDGET-1 | 100 | 12.5 |');
  });

  it('escapes a pipe so one cell cannot break the table', () => {
    const markdown = previewAsMarkdown(
      readSpreadsheet(workbook({ Sheet1: [['name'], ['a|b']] }))
    );

    expect(markdown).toContain('a\\|b');
  });

  it('tells the agent not to total a truncated preview', () => {
    const many = [
      ['sku'],
      ...Array.from({ length: 500 }, (_, i) => [`SKU-${i}`]),
    ];

    const markdown = previewAsMarkdown(
      readSpreadsheet(workbook({ Big: many }))
    );

    // Summing a preview and presenting it as the total is the worst available
    // failure: confidently wrong, and invisible.
    expect(markdown).toMatch(/truncated/i);
    expect(markdown).toContain('500');
  });

  it('names the sheet it read when a workbook has several', () => {
    const markdown = previewAsMarkdown(
      readSpreadsheet(workbook({ Data: SIMPLE, Notes: [['x']] }))
    );

    expect(markdown).toContain('Data');
    expect(markdown).toContain('Notes');
  });
});
