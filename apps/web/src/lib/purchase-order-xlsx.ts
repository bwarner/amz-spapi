import ExcelJS from 'exceljs';
import {
  purchaseOrderTotals,
  type PurchaseOrder,
  type Vendor,
} from '@farvisionllc/models';

/**
 * Render a purchase order to a styled XLSX.
 *
 * The spreadsheet exists because that is how Alibaba/1688 vendors actually
 * work an order — quantities get pasted into their own systems, a price gets
 * countered in place. Same rule as the PDF: this is a projection of the stored
 * order, no figure may originate here, and the amount cells carry FORMULAS
 * (qty × unit price, SUM for the total) so a vendor who edits a quantity
 * sees the totals move rather than a stale constant.
 *
 * Written with exceljs rather than SheetJS because styling (fonts, fills,
 * borders) is a SheetJS *Pro* feature — the community build we read
 * spreadsheets with silently drops it. Reading stays on SheetJS.
 */

const INK = 'FF1A1A1A';
const LABEL = 'FF666666';
const HEADER_FILL = 'FF2B2B2B';
const ZEBRA_FILL = 'FFF7F7F7';
const RULE = 'FF999999';
const HAIRLINE = 'FFDDDDDD';

const thin = (argb: string): Partial<ExcelJS.Border> => ({
  style: 'thin',
  color: { argb },
});

export async function renderPurchaseOrderXlsx(params: {
  order: PurchaseOrder;
  vendor: Vendor;
}): Promise<Buffer> {
  const { order, vendor } = params;
  const totals = purchaseOrderTotals(order);
  const moneyFmt = `"${order.currency}" #,##0.00`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = order.buyer?.name ?? 'Sellavant';
  const sheet = workbook.addWorksheet(order.poNumber, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true },
  });
  sheet.columns = [
    { width: 18 },
    { width: 46 },
    { width: 12 },
    { width: 8 },
    { width: 14 },
    { width: 16 },
  ] as ExcelJS.Column[];

  let rowIndex = 0;
  const nextRow = () => sheet.getRow(++rowIndex);

  const sectionLabel = (cell: ExcelJS.Cell, text: string) => {
    cell.value = text.toUpperCase();
    cell.font = { size: 8, bold: true, color: { argb: LABEL } };
    cell.border = { bottom: thin(HAIRLINE) };
  };

  // ── Title row: document name left, PO number right ────────────────────────
  {
    const row = nextRow();
    sheet.mergeCells(rowIndex, 1, rowIndex, 4);
    row.getCell(1).value = 'PURCHASE ORDER';
    row.getCell(1).font = { size: 18, bold: true, color: { argb: INK } };
    sheet.mergeCells(rowIndex, 5, rowIndex, 6);
    row.getCell(5).value = order.poNumber;
    row.getCell(5).font = { size: 14, bold: true, color: { argb: INK } };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.height = 26;
  }

  // ── Meta: label/value pairs on the right edge ─────────────────────────────
  const meta: Array<[string, string]> = [
    ['Issue date', order.issueDate],
    ...(order.revision > 1
      ? ([
          ['Revision', `Rev ${order.revision}`],
          ...(order.revisedDate ? [['Revised', order.revisedDate]] : []),
        ] as Array<[string, string]>)
      : []),
    ...(order.expectedShipDate
      ? ([['Expected ship date', order.expectedShipDate]] as Array<
          [string, string]
        >)
      : []),
    ['Currency', order.currency],
  ];
  for (const [label, value] of meta) {
    const row = nextRow();
    row.getCell(5).value = label;
    row.getCell(5).font = { size: 9, color: { argb: LABEL } };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(6).value = value;
    row.getCell(6).font = { size: 9, color: { argb: INK } };
    row.getCell(6).alignment = { horizontal: 'right' };
  }
  nextRow();

  // ── Parties: three columns, lines overflow into the empty column beside ──
  const buyerLines = order.buyer
    ? [
        order.buyer.name,
        ...(order.buyer.addressLines ?? []),
        order.buyer.email,
        order.buyer.phone,
        order.buyer.duns ? `DUNS: ${order.buyer.duns}` : undefined,
      ].filter((line): line is string => Boolean(line))
    : [];
  const vendorLines = [
    vendor.name,
    vendor.contactName,
    ...(vendor.addressLines ?? []),
    vendor.country,
    vendor.email,
    vendor.phone,
    vendor.wechat ? `WeChat: ${vendor.wechat}` : undefined,
    vendor.whatsapp ? `WhatsApp: ${vendor.whatsapp}` : undefined,
  ].filter((line): line is string => Boolean(line));
  const shipToLines = order.shipTo
    ? [order.shipTo.name, ...order.shipTo.addressLines]
    : [];

  {
    const row = nextRow();
    if (buyerLines.length) sectionLabel(row.getCell(1), 'From (Buyer)');
    sectionLabel(row.getCell(3), 'To (Vendor)');
    if (shipToLines.length) sectionLabel(row.getCell(5), 'Ship to');
  }
  const partyRows = Math.max(
    buyerLines.length,
    vendorLines.length,
    shipToLines.length
  );
  for (let i = 0; i < partyRows; i++) {
    const row = nextRow();
    const fill = (col: number, lines: string[]) => {
      if (i >= lines.length) return;
      const cell = row.getCell(col);
      cell.value = lines[i];
      cell.font = { size: 9, bold: i === 0, color: { argb: INK } };
    };
    fill(1, buyerLines);
    fill(3, vendorLines);
    fill(5, shipToLines);
  }
  nextRow();

  // ── Line table ────────────────────────────────────────────────────────────
  {
    const row = nextRow();
    const headers = [
      'SKU',
      'Description',
      'Quantity',
      'Unit',
      'Unit price',
      'Amount',
    ];
    headers.forEach((text, i) => {
      const cell = row.getCell(i + 1);
      cell.value = text;
      cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: HEADER_FILL },
      };
      cell.alignment = {
        horizontal: i >= 2 ? 'right' : 'left',
        vertical: 'middle',
      };
    });
    row.height = 18;
  }

  const firstLineRow = rowIndex + 1;
  for (const [i, line] of order.lines.entries()) {
    const row = nextRow();
    row.getCell(1).value = line.sku ?? '';
    row.getCell(2).value = line.description;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(3).value = line.quantity;
    row.getCell(3).numFmt = '#,##0';
    row.getCell(4).value = line.unit ?? '';
    row.getCell(5).value = line.unitPrice;
    row.getCell(5).numFmt = moneyFmt;
    // The cached `result` is what lazy viewers (file previews, Google Drive)
    // show without recalculating — a formula cell without one reads as empty.
    row.getCell(6).value = {
      formula: `ROUND(C${rowIndex}*E${rowIndex},2)`,
      result: Math.round(line.quantity * line.unitPrice * 100) / 100,
    };
    row.getCell(6).numFmt = moneyFmt;
    for (let col = 1; col <= 6; col++) {
      const cell = row.getCell(col);
      cell.font = { size: 9, color: { argb: INK } };
      cell.border = { bottom: thin(HAIRLINE) };
      if (col >= 3) cell.alignment = { ...cell.alignment, horizontal: 'right' };
      if (i % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: ZEBRA_FILL },
        };
      }
    }
  }
  const lastLineRow = rowIndex;
  nextRow();

  // ── Totals block, right-aligned like the PDF ──────────────────────────────
  const amountRef = (r: number) => `F${r}`;
  const totalRefs: string[] = [];
  const totalsRow = (
    label: string,
    value: number | { formula: string; result: number },
    opts?: { grand?: boolean }
  ) => {
    const row = nextRow();
    const labelCell = row.getCell(5);
    labelCell.value = label;
    const valueCell = row.getCell(6);
    valueCell.value = value;
    valueCell.numFmt = moneyFmt;
    valueCell.alignment = { horizontal: 'right' };
    const font = {
      size: opts?.grand ? 11 : 9,
      bold: Boolean(opts?.grand),
      color: { argb: INK },
    };
    labelCell.font = font;
    valueCell.font = font;
    if (opts?.grand) {
      labelCell.border = { top: thin(RULE) };
      valueCell.border = { top: thin(RULE) };
    }
    return rowIndex;
  };

  const subtotalRow = totalsRow('Goods subtotal', {
    formula: `SUM(F${firstLineRow}:F${lastLineRow})`,
    result: totals.goodsSubtotal,
  });
  totalRefs.push(amountRef(subtotalRow));
  if (order.freightAmount !== undefined) {
    totalRefs.push(amountRef(totalsRow('Freight', order.freightAmount)));
  }
  for (const fee of order.otherFees ?? []) {
    totalRefs.push(amountRef(totalsRow(fee.description, fee.amount)));
  }
  totalsRow(
    'TOTAL',
    { formula: totalRefs.join('+'), result: totals.total },
    { grand: true }
  );
  nextRow();

  // ── Terms and notes ───────────────────────────────────────────────────────
  const terms: Array<[string, string]> = [];
  if (order.incoterms) terms.push(['Incoterms', order.incoterms]);
  if (order.paymentTerms) terms.push(['Payment terms', order.paymentTerms]);
  if (vendor.leadTimeDays) {
    terms.push(['Agreed lead time', `${vendor.leadTimeDays} days`]);
  }
  if (terms.length) {
    const labels = nextRow();
    const values = nextRow();
    terms.forEach(([label, value], i) => {
      const col = 1 + i * 2;
      sectionLabel(labels.getCell(col), label);
      values.getCell(col).value = value;
      values.getCell(col).font = { size: 9, color: { argb: INK } };
    });
    nextRow();
  }
  if (order.revisionNote) {
    sectionLabel(nextRow().getCell(1), `Revision ${order.revision} — reason`);
    const row = nextRow();
    sheet.mergeCells(rowIndex, 1, rowIndex, 6);
    row.getCell(1).value = order.revisionNote;
    row.getCell(1).font = { size: 9, color: { argb: INK } };
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    nextRow();
  }
  if (order.notes) {
    sectionLabel(nextRow().getCell(1), 'Notes');
    const row = nextRow();
    sheet.mergeCells(rowIndex, 1, rowIndex, 6);
    row.getCell(1).value = order.notes;
    row.getCell(1).font = { size: 9, color: { argb: INK } };
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    row.height = Math.max(15, Math.ceil(order.notes.length / 110) * 13);
    nextRow();
  }

  // ── Footer strip ──────────────────────────────────────────────────────────
  {
    const row = nextRow();
    sheet.mergeCells(rowIndex, 1, rowIndex, 6);
    row.getCell(1).value =
      `${order.poNumber} · ${totals.totalUnits.toLocaleString(
        'en-US'
      )} units · ` + `${order.currency} ${totals.total.toFixed(2)}`;
    row.getCell(1).font = { size: 8, color: { argb: LABEL } };
    row.getCell(1).alignment = { horizontal: 'center' };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
