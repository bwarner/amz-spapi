import JSZip from 'jszip';

/**
 * Extract the text of a .docx, so Word documents are readable, not just kept.
 *
 * Suppliers send purchase orders, packing lists and quotes as Word files at
 * least as often as PDFs. Before this, a .docx was stored faithfully and read
 * never: no text meant recognition returned `unknown`, extraction never ran,
 * and the file sat in the library as an opaque blob with a name.
 *
 * A .docx is a zip; the document text lives in `word/document.xml` as runs of
 * `<w:t>` inside paragraphs of `<w:p>`. Recognition and extraction want plain
 * text with real line structure — matchers look for phrases like "purchase
 * order", and the extraction model reads tables as adjacent lines — so
 * paragraphs become newlines and tabs become tabs, and everything else is
 * markup to discard. No layout fidelity is attempted: this is the same
 * contract as `extractPdfText`, text in reading order, not a rendering.
 *
 * Legacy binary `.doc` is NOT handled — it is not a zip and needs a real
 * parser. It stays an opaque stored file, which the import response says.
 */
export async function extractDocxText(bytes: Buffer): Promise<{
  text: string;
  /** True when the container opened but held no document part. */
  notADocx: boolean;
}> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return { text: '', notADocx: true };
  }

  const part = zip.file('word/document.xml');
  if (!part) return { text: '', notADocx: true };

  const xml = await part.async('string');

  const text = xml
    // Explicit breaks first, while the tags still exist to find.
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    // Everything else is markup.
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Collapse the blank lines empty paragraphs leave behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, notADocx: false };
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function isDocx(mimeType: string, extension: string): boolean {
  return mimeType === DOCX_MIME || extension === 'docx';
}
