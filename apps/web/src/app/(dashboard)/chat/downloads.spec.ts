/**
 * Pulling produced files out of tool results.
 *
 * These shapes come from `SellerProcurementOps` and the photo export tool. The
 * files used to reach the reader only when the model remembered to write a
 * markdown link, so the thing worth testing is that a real result always yields
 * one and a failed result never does.
 */

import { describe, expect, it } from 'vitest';
import { extractDownloads, formatBytes } from './downloads';

describe('extractDownloads', () => {
  it('finds a rendered purchase order', () => {
    // renderPurchaseOrder(): { downloadUrl, fileName, sizeBytes }
    const files = extractDownloads('render-purchase-order', {
      success: true,
      downloadUrl: '/api/po/PO-1042.pdf',
      fileName: 'PO-1042.pdf',
      sizeBytes: 148_221,
    });
    expect(files).toEqual([
      { url: '/api/po/PO-1042.pdf', name: 'PO-1042.pdf', detail: '145 KB' },
    ]);
  });

  it('finds an exported photo set and says how many files it holds', () => {
    // exportPhotoSet(): { downloadUrl, fileCount, sizeBytes }
    const [file] = extractDownloads('export-photo-set', {
      success: true,
      downloadUrl: '/api/assets/set.zip',
      fileCount: 7,
      sizeBytes: 5_242_880,
    });
    expect(file.url).toBe('/api/assets/set.zip');
    expect(file.detail).toBe('7 files · 5.0 MB');
  });

  it('lists every format a purchase order has been rendered in', () => {
    const files = extractDownloads('get-purchase-order', {
      success: true,
      poNumber: 'PO-1042',
      downloads: [
        { format: 'pdf', downloadUrl: '/api/po/PO-1042.pdf' },
        { format: 'xlsx', downloadUrl: '/api/po/PO-1042.xlsx' },
      ],
    });
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.detail)).toEqual(['PDF', 'XLSX']);
    // No fileName in this shape, so it is named from the order it belongs to.
    expect(files[0].name).toBe('Purchase order PO-1042');
  });

  it('offers nothing for a failed call', () => {
    // A refusal carries no file; a download button on one would be a lie.
    expect(
      extractDownloads('render-purchase-order', {
        success: false,
        error: 'No such purchase order.',
      })
    ).toEqual([]);
  });

  it('ignores results that produced no file', () => {
    expect(extractDownloads('get-orders', { orders: [] })).toEqual([]);
    expect(extractDownloads('get-orders', null)).toEqual([]);
    expect(extractDownloads('get-orders', 'text')).toEqual([]);
  });

  it('works off the shape, so a new tool needs no registration', () => {
    // The failure being designed out is "nobody wired it up".
    const [file] = extractDownloads('some-future-tool', {
      downloadUrl: '/api/x.zip',
    });
    expect(file.url).toBe('/api/x.zip');
    expect(file.name).toBe('Download');
  });
});

describe('formatBytes', () => {
  it('keeps a decimal below ten and drops it above', () => {
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
    expect(formatBytes(52_428_800)).toBe('50 MB');
  });

  it('says nothing rather than "0 B" when the size is unknown', () => {
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});
