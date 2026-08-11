import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { recognizeDocument } from '@farvisionllc/models';
import { extractDocxText } from './docx-text';

/**
 * Word documents must READ the same as their PDF twins. The fixture is built
 * with the same library the extractor opens it with, so the test exercises a
 * genuine .docx container rather than a string that resembles one.
 */

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function docxOf(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map(paragraph).join('') +
      '</w:body></w:document>'
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractDocxText', () => {
  it('reads paragraphs as lines, with entities decoded', async () => {
    const bytes = await docxOf([
      'PURCHASE ORDER PO-2026-0009',
      'Vendor: Smith &amp; Sons',
      'Payment terms: Net 60',
    ]);

    const { text, notADocx } = await extractDocxText(bytes);
    expect(notADocx).toBe(false);
    expect(text.split('\n')).toEqual([
      'PURCHASE ORDER PO-2026-0009',
      'Vendor: Smith & Sons',
      'Payment terms: Net 60',
    ]);
  });

  it('feeds recognition the same words a PDF would', async () => {
    // The point of the feature: a supplier's Word PO must classify like its
    // PDF twin, through the same matchers, with no docx special-casing there.
    const bytes = await docxOf([
      'PURCHASE ORDER PO-2026-0009',
      'Issue date: 2026-08-11 Currency: USD',
      'FROM (BUYER) Farvision LLC TO (VENDOR) Smith and Sons',
      'SKU Description Quantity Unit price Amount',
      'FB-COF-HGE-250 Honey Geisha 80 bags USD 20.00 USD 1,600.00',
      'Goods subtotal USD 1,600.00 TOTAL USD 1,600.00',
      'PAYMENT TERMS Net 60',
    ]);
    const { text } = await extractDocxText(bytes);

    const verdict = recognizeDocument({
      fileName: 'supplier-po.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text,
    });
    expect(verdict.kind).toBe('purchase-order');
  });

  it('reports a zip with no document part rather than returning empty silently', async () => {
    const zip = new JSZip();
    zip.file('not-a-docx.txt', 'hello');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await extractDocxText(bytes);
    // notADocx feeds `noExtractableText`, which is what tells the seller
    // "there was nothing to read" instead of "we read it and could not tell" —
    // the two need different remedies.
    expect(result.notADocx).toBe(true);
  });

  it('treats a non-zip as not a docx', async () => {
    const result = await extractDocxText(Buffer.from('%PDF-1.4 not a zip'));
    expect(result.notADocx).toBe(true);
    expect(result.text).toBe('');
  });
});
