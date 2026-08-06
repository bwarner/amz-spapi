import { extractText } from 'unpdf';
import { loggerFor } from './logger';
const log = loggerFor('pdf');

/**
 * Extract text from a PDF, page by page.
 *
 * Ported from the approach already proven in awesome-resume: unpdf works in
 * serverless runtimes without a native canvas dependency, which is why it is
 * preferred over pdfjs-dist directly.
 *
 * Pages are kept separate rather than flattened, because a single PDF from a
 * supplier often holds an invoice AND a packing list — recognising and handling
 * them as one document would attribute the wrong figures.
 */
export async function extractPdfText(buffer: Buffer): Promise<{
  pages: string[];
  text: string;
  /**
   * True when the PDF yields almost nothing. Scanned paper and print artwork
   * both look like this, and neither can be recognised from text — the caller
   * should say so rather than guess.
   */
  looksScannedOrArtwork: boolean;
}> {
  try {
    const { text } = await extractText(new Uint8Array(buffer));
    const pages = Array.isArray(text) ? text : [text];
    const joined = pages.join('\n');
    return {
      pages,
      text: joined,
      looksScannedOrArtwork: joined.replace(/\s+/g, '').length < 40,
    };
  } catch (error) {
    // A malformed or encrypted PDF must not fail the upload — the file is
    // already stored; it just cannot be classified from its text.
    log.warn(
      {
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'text extraction failed'
    );
    return { pages: [], text: '', looksScannedOrArtwork: true };
  }
}
