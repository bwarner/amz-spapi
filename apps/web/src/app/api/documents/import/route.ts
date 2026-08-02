import {
  parseFbaBoxLabels,
  recognizeDocument,
  summariseBoxLabels,
} from '@farvisionllc/models';
import { storeBoxLabel, storeExtractedDocument } from '@amz-spapi/sp-cache';
import { resolveAmazonConnection } from '../../../../lib/amazon-connections';
import { auth0 } from '../../../../lib/auth0';
import {
  extensionForMime,
  persistGeneratedFileAsset,
} from '../../../../lib/media-assets';
import { extractPdfText } from '../../../../lib/pdf-text';
import {
  previewAsMarkdown,
  readSpreadsheet,
  SpreadsheetError,
} from '../../../../lib/spreadsheet';
import {
  extractDocument,
  type ExtractionResult,
} from '../../../../lib/document-extraction';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Artwork can be large; invoices never are. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Containers that hold a table, whatever the browser calls their mime type. */
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xlsx', 'xls', 'xlsm']);

function isSpreadsheetMime(mimeType: string): boolean {
  return (
    mimeType === 'text/csv' ||
    mimeType === 'text/tab-separated-values' ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('ms-excel')
  );
}

/**
 * Store a business document or design file.
 *
 * Distinct from the report importer: these are not parsed into rows. An invoice
 * becomes cost evidence and a box design becomes a versioned asset, and both
 * paths start by simply keeping the file with its identity attached. Extraction
 * is a later, separate step — storing must never depend on it succeeding.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      {
        error: 'Send the document as multipart/form-data with a "file" field.',
      },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: `File is ${(file.size / 1024 / 1024).toFixed(
          0
        )}MB; the limit is ${MAX_BYTES / 1024 / 1024}MB.`,
      },
      { status: 413 }
    );
  }

  // Browsers label .ai files inconsistently (postscript, pdf, octet-stream, or
  // nothing), so trust the extension when the mime type is uninformative.
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType =
    file.type && file.type !== 'application/octet-stream'
      ? file.type
      : extension === 'pdf'
      ? 'application/pdf'
      : extension === 'ai'
      ? 'application/illustrator'
      : 'application/octet-stream';

  const bytes = Buffer.from(await file.arrayBuffer());

  // Recognition runs BEFORE storage only in the sense that it must never block
  // it: a file we cannot classify is still a file the seller needs kept.
  let text = '';
  let pages: string[] = [];
  let noExtractableText = false;
  if (mimeType === 'application/pdf') {
    const extracted = await extractPdfText(bytes);
    text = extracted.text;
    pages = extracted.pages;
    noExtractableText = extracted.looksScannedOrArtwork;
  } else if (
    mimeType.startsWith('text/') ||
    SPREADSHEET_EXTENSIONS.has(extension)
  ) {
    // CSV and TSV are text as far as recognition is concerned — an Amazon
    // report is identified by its header row.
    text = bytes.toString('utf8');
  }

  // Spreadsheets are previewed rather than extracted. `.xlsx` is a zip and has
  // no text at all, so without this a workbook would upload and be
  // unreadable — the same silence #72 is about, in a different container.
  let spreadsheet:
    | {
        sheetName: string;
        totalRows: number;
        truncated: boolean;
        markdown: string;
      }
    | undefined;
  let spreadsheetError: string | undefined;
  if (SPREADSHEET_EXTENSIONS.has(extension) || isSpreadsheetMime(mimeType)) {
    try {
      const preview = readSpreadsheet(bytes);
      spreadsheet = {
        sheetName: preview.sheetName,
        totalRows: preview.totalRows,
        truncated: preview.truncated,
        markdown: previewAsMarkdown(preview),
      };
    } catch (error) {
      spreadsheetError =
        error instanceof SpreadsheetError
          ? error.message
          : 'Could not read the spreadsheet.';
    }
  }

  const recognition = recognizeDocument({
    fileName: file.name,
    mimeType,
    text,
    noExtractableText,
  });

  // An FBA box label is the only document that carries what the SELLER shipped,
  // so read it now rather than leaving it as an undifferentiated file.
  //
  // Per PAGE, not per file: Amazon prints every box of a shipment into one PDF,
  // and reading the joined text finds only the first label — a four-box sheet
  // came back as one box of 40 and silently halved the shipped quantity.
  const boxLabels =
    recognition.kind === 'fba-box-label'
      ? parseFbaBoxLabels(pages.length ? pages : [text])
      : [];

  try {
    const asset = await persistGeneratedFileAsset({
      userId: session.user.sub,
      bytes,
      mimeType,
      // Keep the uploaded extension rather than deriving one: a printer asking
      // for the .ai should get a .ai back.
      extension: extension || extensionForMime(mimeType),
      feature: 'documents',
    });

    // A box label is only useful once it is a record that reconciliation can
    // read. Failing to store it must not fail the upload — the file is kept
    // either way, and the seller is told which happened.
    let shipmentLabelStored: string | undefined;
    let boxLabelsStored = 0;
    if (boxLabels.length) {
      try {
        const resolved = await resolveAmazonConnection({
          apiType: 'SP_API',
          userId: session.user.sub,
        });
        const sellerId = resolved.connected
          ? resolved.connection.profile.seller_id
          : undefined;
        if (sellerId) {
          for (const [index, label] of boxLabels.entries()) {
            const stored = await storeBoxLabel({
              sellerId,
              label,
              assetId: asset.assetId,
              fileName: file.name,
              text: pages[index] ?? text,
            });
            shipmentLabelStored = stored.shipmentId;
            boxLabelsStored += 1;
          }
        }
      } catch (error) {
        console.error(
          '[documents] box label not stored',
          file.name,
          error instanceof Error ? `${error.name}: ${error.message}` : error
        );
      }
    }

    // Cost extraction runs only for documents that carry cost, and only when
    // there is text to read. It is a paid model call, so it must never fire on
    // a box label, a design file or a scan with nothing in it.
    const COST_BEARING = new Set(['commercial-invoice', 'receipt']);
    let extraction: ExtractionResult | undefined;
    let extractionError: string | undefined;
    if (
      COST_BEARING.has(recognition.kind) &&
      text.trim() &&
      !noExtractableText
    ) {
      try {
        extraction = await extractDocument({
          userId: session.user.sub,
          text,
          recognisedAs: recognition.kind,
          fileName: file.name,
          assetId: asset.assetId,
        });
      } catch (error) {
        // The file is stored and classified either way. A failed or refused
        // extraction — including a budget refusal — must not lose the upload.
        extractionError =
          error instanceof Error ? error.message : 'Extraction failed.';
        console.error(
          '[documents] extraction failed',
          file.name,
          extractionError
        );
      }
    }

    // Keep the extraction, so reconciliation can read it weeks later when the
    // waybill for this invoice finally arrives (#50). Without this the figures
    // lived only in the response below, and the next upload paid the model
    // again for a document already read.
    //
    // Failing to store must not fail the upload, for the same reason the box
    // label path does not: the file is kept and classified either way, and the
    // seller is told which happened.
    let documentId: string | undefined;
    let documentStoreError: string | undefined;
    if (extraction) {
      try {
        const record = await storeExtractedDocument({
          userId: session.user.sub,
          assetId: asset.assetId,
          fileName: file.name,
          recognition: {
            kind: recognition.kind,
            confidence: recognition.confidence,
            needsUserChoice: recognition.needsUserChoice,
            alternatives: recognition.alternatives.map((entry) => entry.kind),
            signals: recognition.signals.map((signal) => signal.reason),
          },
          extracted: extraction.document,
          issues: extraction.issues,
          needsReview: extraction.needsReview,
          modelId: extraction.modelId,
        });
        documentId = record.documentId;
      } catch (error) {
        documentStoreError =
          error instanceof Error ? error.message : 'Could not store document.';
        console.error(
          '[documents] extraction not stored',
          file.name,
          documentStoreError
        );
      }
    }

    return Response.json({
      assetId: asset.assetId,
      url: `/api/a-plus/assets/${asset.assetId}`,
      fileName: file.name,
      mimeType,
      sizeBytes: asset.sizeBytes,
      // persistGeneratedFileAsset dedupes on sha256, so re-uploading the same
      // file returns the original rather than storing it twice.
      duplicate: asset.status === 'duplicate' || asset.sizeBytes !== file.size,
      shipmentLabelStored,
      boxLabelsStored,
      // What this sheet says was shipped, deduplicated and with completeness
      // stated — the same rollup reconciliation reads.
      boxLabelSummary: summariseBoxLabels(boxLabels),
      extraction: extraction
        ? {
            vendorName: extraction.document.vendorName,
            documentDate: extraction.document.documentDate,
            documentDateRaw: extraction.document.documentDateRaw,
            currency: extraction.document.currency,
            total: extraction.document.total,
            lines: extraction.document.lines.map((line) => ({
              description: line.description,
              kind: line.kind,
              quantity: line.quantity,
              amount: line.amount,
              supplierRef: line.supplierRef,
            })),
            issues: extraction.issues,
            needsReview: extraction.needsReview,
            modelId: extraction.modelId,
          }
        : undefined,
      extractionError,
      spreadsheet,
      spreadsheetError,
      // Present once the extraction is kept, so a caller can refile the role or
      // group it into a purchase without re-uploading.
      documentId,
      documentStoreError,
      recognition: {
        kind: recognition.kind,
        confidence: recognition.confidence,
        needsUserChoice: recognition.needsUserChoice,
        // Reasons travel with the verdict so a wrong guess can be argued with
        // rather than merely overridden.
        signals: recognition.signals.map((signal) => signal.reason),
        alternatives: recognition.alternatives.map((entry) => entry.kind),
      },
    });
  } catch (error) {
    console.error(
      '[documents] import failed',
      file.name,
      error instanceof Error ? `${error.name}: ${error.message}` : error
    );
    return Response.json(
      { error: 'Could not store the document.' },
      { status: 500 }
    );
  }
}
