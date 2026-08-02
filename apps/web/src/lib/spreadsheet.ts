import * as XLSX from 'xlsx';

/**
 * Read a spreadsheet into rows, whatever container it arrived in.
 *
 * `.xlsx`, `.xls` and `.csv` all end up here so that everything downstream sees
 * one shape. A seller who exports from Seller Central gets a TSV, from Excel
 * gets an xlsx, and from Google Sheets gets a csv — the difference is an
 * accident of where they clicked, and should not change what the app can do.
 *
 * SheetJS is installed from the vendor's own CDN rather than npm: the npm
 * registry copy is pinned at 0.18.5 from 2022 and carries published advisories
 * (prototype pollution, ReDoS) that are fixed in later releases the vendor only
 * publishes themselves.
 */

/** What a spreadsheet turned out to contain. */
export type SpreadsheetPreview = {
  /** Sheet names, so a workbook with several tabs can say so. */
  sheetNames: string[];
  /** The sheet that was read — the first one with any content. */
  sheetName: string;
  header: string[];
  rows: string[][];
  /** Rows in the sheet, which may exceed the number previewed. */
  totalRows: number;
  truncated: boolean;
};

/**
 * How much of a sheet is worth putting in front of the model.
 *
 * A preview, not the file. A year of ledger detail is hundreds of thousands of
 * rows; pasting it into a prompt would be slow, expensive and useless. Enough
 * rows to see the shape and answer a question about a small sheet, and for
 * anything larger the answer is to ingest it as a report instead.
 */
const PREVIEW_ROWS = 50;
const MAX_COLUMNS = 40;
/** A cell long enough to be a pasted document rather than a value. */
const MAX_CELL_CHARS = 200;

export class SpreadsheetError extends Error {}

function clip(value: unknown): string {
  const text = value == null ? '' : String(value);
  return text.length > MAX_CELL_CHARS
    ? `${text.slice(0, MAX_CELL_CHARS)}…`
    : text;
}

/**
 * Whether these bytes could be a spreadsheet at all.
 *
 * SheetJS is deliberately lenient: given arbitrary bytes it will happily return
 * a one-cell CSV rather than fail. That turns a mis-named binary into a
 * plausible-looking table of nonsense, which is worse than an error — the
 * reader has no way to tell it apart from real data.
 *
 * A real workbook is a zip (`PK`) or the older OLE compound file; anything else
 * has to be text, and text does not contain NUL.
 */
function looksLikeSpreadsheet(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;

  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // xlsx, xlsm
  const isOle =
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0; // xls
  if (isZip || isOle) return true;

  return !bytes.subarray(0, 4096).includes(0x00);
}

export function readSpreadsheet(bytes: Buffer): SpreadsheetPreview {
  if (!looksLikeSpreadsheet(bytes)) {
    throw new SpreadsheetError(
      'That file is not a spreadsheet — it is neither a workbook nor text.'
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'buffer',
      // Dates as text: a serial number in a preview is unreadable, and the
      // model would have to be told Excel's epoch to interpret one.
      cellDates: true,
      // Formula results, not formulas. What the seller sees is the value.
      cellFormula: false,
      // Styling is irrelevant here and is the bulk of a large workbook's parse
      // cost.
      cellStyles: false,
    });
  } catch (error) {
    throw new SpreadsheetError(
      error instanceof Error
        ? `Could not read the spreadsheet: ${error.message}`
        : 'Could not read the spreadsheet.'
    );
  }

  if (!workbook.SheetNames.length) {
    throw new SpreadsheetError('That workbook has no sheets in it.');
  }

  // The first sheet with anything in it. A workbook whose first tab is a blank
  // cover sheet is common enough that picking [0] blindly reads as "empty file".
  const sheetName =
    workbook.SheetNames.find((name) => {
      const sheet = workbook.Sheets[name];
      return sheet && Object.keys(sheet).some((key) => !key.startsWith('!'));
    }) ?? workbook.SheetNames[0];

  const table = XLSX.utils.sheet_to_json<unknown[]>(
    workbook.Sheets[sheetName],
    {
      header: 1,
      blankrows: false,
      // Empty cells as '' rather than holes, so a row's columns stay aligned with
      // the header — a sparse row would otherwise shift every value left.
      defval: '',
      raw: false,
    }
  );

  if (!table.length) {
    throw new SpreadsheetError(`Sheet "${sheetName}" is empty.`);
  }

  const [headerRow, ...bodyRows] = table;
  const header = (headerRow ?? []).slice(0, MAX_COLUMNS).map(clip);
  const rows = bodyRows
    .slice(0, PREVIEW_ROWS)
    .map((row) => (row ?? []).slice(0, MAX_COLUMNS).map(clip));

  return {
    sheetNames: workbook.SheetNames,
    sheetName,
    header,
    rows,
    totalRows: bodyRows.length,
    truncated: bodyRows.length > PREVIEW_ROWS,
  };
}

/**
 * The preview as markdown, for the message the agent reads.
 *
 * A table rather than JSON: it is what the markdown renderer already displays
 * well, and the model reads a header row as column meaning without being told.
 */
export function previewAsMarkdown(preview: SpreadsheetPreview): string {
  const escape = (cell: string) => cell.replace(/\|/g, '\\|');
  const lines = [
    `| ${preview.header.map(escape).join(' | ')} |`,
    `| ${preview.header.map(() => '---').join(' | ')} |`,
    ...preview.rows.map((row) => {
      // Pad short rows so the table stays rectangular; markdown renderers drop
      // a row whose cell count disagrees with the header.
      const padded = [...row];
      while (padded.length < preview.header.length) padded.push('');
      return `| ${padded.map(escape).join(' | ')} |`;
    }),
  ];

  const notes: string[] = [];
  if (preview.sheetNames.length > 1) {
    notes.push(
      `Sheet "${preview.sheetName}" of ${
        preview.sheetNames.length
      }: ${preview.sheetNames.join(', ')}.`
    );
  }
  if (preview.truncated) {
    notes.push(
      `Showing the first ${preview.rows.length} of ${preview.totalRows} rows — ` +
        'do not total a truncated preview; say it is truncated and offer to ' +
        'import the file as a report instead.'
    );
  }

  return [lines.join('\n'), ...notes].join('\n\n');
}
