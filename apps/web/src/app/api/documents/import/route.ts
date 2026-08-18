import {
  parseFbaBoxLabels,
  recognizeDocument,
  summariseBoxLabels,
} from '@farvisionllc/models';
import {
  decodeReportBuffer,
  detectReportKind,
  ingestReportBuffer,
  isIngestError,
  REPORTS,
  roleForRecognisedKind,
  storeBoxLabel,
  storeExtractedDocument,
} from '@amz-spapi/sp-cache';
import { resolveAmazonConnection } from '../../../../lib/amazon-connections';
import { auth0 } from '../../../../lib/auth0';
import {
  extensionForMime,
  persistGeneratedFileAsset,
} from '../../../../lib/media-assets';
import { extractDocxText, isDocx, DOCX_MIME } from '../../../../lib/docx-text';
import { extractPdfText } from '../../../../lib/pdf-text';
import {
  isBinaryWorkbook,
  previewAsMarkdown,
  readSpreadsheet,
  SpreadsheetError,
  workbookAsCsv,
} from '../../../../lib/spreadsheet';
import {
  extractDocument,
  type ExtractionResult,
} from '../../../../lib/document-extraction';
import { embedDocument } from '../../../../lib/document-embedding';
import { loggerFor } from '../../../../lib/logger';
const log = loggerFor('documents');

export const runtime = 'nodejs';
// A recognised report is parsed into rows here as well as previewed, and a
// year of ledger detail is a large file to parse — the same allowance the
// reports importer makes.
export const maxDuration = 120;

/** Artwork can be large; invoices never are. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Containers that hold a table, whatever the browser calls their mime type. */
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xlsx', 'xls', 'xlsm']);

/**
 * Column share that stands in for a human saying which report this is.
 *
 * Higher than the explicit upload route's 0.5: there, someone chose "import a
 * report", and here a file was merely attached to a sentence.
 */
const AUTO_IMPORT_CONFIDENCE = 0.6;

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
      : extension === 'docx'
      ? DOCX_MIME
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
  } else if (isDocx(mimeType, extension)) {
    // Word documents are how suppliers actually send POs and packing lists.
    // Extract the text so recognition and extraction see the same words a
    // PDF of the same document would give them.
    const docx = await extractDocxText(bytes);
    text = docx.text;
    noExtractableText = docx.notADocx;
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
  const isSpreadsheet =
    SPREADSHEET_EXTENSIONS.has(extension) || isSpreadsheetMime(mimeType);

  /**
   * An attached spreadsheet that IS an Amazon report goes into the report
   * importer, whole.
   *
   * This is the seam the preview has always pointed at and nothing crossed. A
   * seller who cannot pull a report over SP-API — because the app lacks the
   * role, which is the ordinary case for Finance — downloads it from Seller
   * Central and attaches it, and until now that file arrived as 50 rows and an
   * apology. Ingested, every row is stored and `total-report-rows` can answer
   * exactly. The preview still travels alongside: it shows the shape, and it
   * now says the whole file is available rather than offering an import that
   * has already happened.
   *
   * Identification is by header row, never by filename, and it is held to a
   * HIGHER bar than the explicit upload route: that one imports on the best
   * guess because a human said "this is a report", while nobody said anything
   * here — a file was simply attached to a sentence. So it takes a header no
   * other report has, or a decisive share of the columns. An ordinary
   * spreadsheet (a COGS list, a supplier quote) is previewed exactly as before,
   * and a half-recognised one is not filed under a kind it may not be, where it
   * would show up later as coverage nothing actually covers.
   */
  let report:
    | {
        kind: string;
        label: string;
        rowsParsed: number;
        rowsNew: number;
        rowsDuplicate: number;
        rowsRefreshed: number;
        observedFrom?: string;
        observedTo?: string;
        unmappedHeaders?: string[];
        warnings?: string[];
      }
    | undefined;
  let reportError: string | undefined;
  if (isSpreadsheet) {
    try {
      // Rows belong to a seller account, not to the user who uploaded them.
      const resolved = await resolveAmazonConnection({
        apiType: 'SP_API',
        userId: session.user.sub,
      });
      const sellerId = resolved.connected
        ? resolved.connection.profile.seller_id
        : undefined;
      if (sellerId) {
        // A .csv/.tsv goes in as the bytes the seller downloaded — the importer
        // decodes them itself, including the UTF-16 Seller Central often emits.
        // Only a binary workbook needs converting, and converting one that did
        // not need it would change every row's identity hash.
        const buffer = isBinaryWorkbook(bytes)
          ? Buffer.from(workbookAsCsv(bytes), 'utf8')
          : bytes;
        // Identification reads the header row, so it only needs the start of
        // the file. Decoding all of a 64MB export just to look at line one
        // would hold a second copy of it in memory for nothing.
        const detection = detectReportKind(
          decodeReportBuffer(buffer.subarray(0, 64 * 1024))
        );
        // Nothing identified is the NORMAL outcome for an arbitrary
        // spreadsheet: it is previewed, and no claim is made about it.
        const identified =
          detection.kind &&
          (detection.decisive === detection.kind ||
            detection.confidence >= AUTO_IMPORT_CONFIDENCE)
            ? detection.kind
            : undefined;
        const outcome = identified
          ? await ingestReportBuffer({
              sellerId,
              buffer,
              source: 'upload',
              kind: identified,
              fileName: file.name,
              // This path AUTO-imports on a decisive detection, so the ads
              // overlap guard matters here more than on the explicit upload:
              // nobody chose to load this file, and a doubled July would
              // arrive from dropping a folder on the page.
              userId: session.user.sub,
            })
          : undefined;
        if (outcome && isIngestError(outcome)) {
          // Detection already succeeded and the kind was passed in, so what is
          // left is a real failure and is worth saying out loud.
          reportError = outcome.error;
        } else if (outcome) {
          report = {
            kind: outcome.kind,
            label: REPORTS[outcome.kind].label,
            rowsParsed: outcome.rowsParsed,
            rowsNew: outcome.rowsNew,
            rowsDuplicate: outcome.rowsDuplicate,
            rowsRefreshed: outcome.rowsRefreshed,
            observedFrom: outcome.observedFrom,
            observedTo: outcome.observedTo,
            unmappedHeaders: outcome.unmappedHeaders.length
              ? outcome.unmappedHeaders
              : undefined,
            warnings: outcome.warnings,
          };
          log.info(
            `imported ${outcome.kind} from attachment for ${sellerId}: ` +
              `${outcome.rowsNew} new, ${outcome.rowsDuplicate} duplicate ` +
              `(${outcome.rowsRefreshed} re-read under the current mapping)`
          );
        }
      }
    } catch (error) {
      // Never fail the upload over this. The file is stored and previewed
      // either way, and the response says the import did not happen.
      reportError =
        error instanceof Error ? error.message : 'Report import failed.';
      log.error({ name: file.name, reportError }, 'report import failed');
    }

    try {
      const preview = readSpreadsheet(bytes);
      spreadsheet = {
        sheetName: preview.sheetName,
        totalRows: preview.totalRows,
        truncated: preview.truncated,
        markdown: previewAsMarkdown(
          preview,
          report ? { label: report.label, kind: report.kind } : undefined
        ),
      };
    } catch (error) {
      spreadsheetError =
        error instanceof SpreadsheetError
          ? error.message
          : 'Could not read the spreadsheet.';
    }
  }

  // A spreadsheet is never shown to the paper-document matchers: they read
  // invoice vocabulary, and run over CSV text they once scored a campaign
  // export 0.13 "unknown — needs confirmation" because it contained the word
  // "total". The same file attached in chat got the spreadsheet treatment
  // (preview + query-spreadsheet) — the two routes must agree on what a
  // tabular file IS.
  const recognition = isSpreadsheet
    ? {
        kind: 'spreadsheet' as const,
        confidence: 1,
        needsUserChoice: false,
        alternatives: [],
        signals: [
          {
            reason: report
              ? `Recognised and ingested as ${report.label}`
              : spreadsheet
              ? `Tabular file, ${spreadsheet.totalRows} rows — not a ` +
                'recognised Amazon report kind; stored whole and queryable ' +
                'in chat'
              : 'Tabular file',
            weight: 1,
          },
        ],
      }
    : recognizeDocument({
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
      // A seller looks for "the Ruiyi invoice", not for asset_9f3c…. Keeping the
      // name is also what keeps this file out of asset GC's reach.
      originalFileName: file.name,
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
        log.error(
          {
            name: file.name,
            error:
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : error,
          },
          'box label not stored'
        );
      }
    }

    // Cost extraction runs only for documents that carry cost, and only when
    // there is text to read. It is a paid model call, so it must never fire on
    // a box label, a design file or a scan with nothing in it.
    const COST_BEARING = new Set([
      'commercial-invoice',
      'receipt',
      // A PO carries the ORDERED side of every later comparison — quantities
      // the invoice is checked against, the total the shipments view falls
      // back to. Unextracted it is a file; extracted it is a baseline.
      'purchase-order',
    ]);
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
        log.error({ name: file.name, extractionError }, 'extraction failed');
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
        // Embedded BEFORE the write, so a document is never briefly stored
        // without the vector that makes it findable. Returns undefined when the
        // gateway is unreachable — the document is still stored and listed, it
        // is simply absent from semantic search until re-embedded.
        const storedRole = roleForRecognisedKind(recognition.kind) ?? 'other';
        const embedded = await embedDocument({
          role: storedRole,
          fileName: file.name,
          recognition: {
            kind: recognition.kind,
            confidence: recognition.confidence,
            needsUserChoice: recognition.needsUserChoice,
            alternatives: recognition.alternatives.map((entry) => entry.kind),
            signals: recognition.signals.map((signal) => signal.reason),
          },
          extracted: extraction.document,
        });

        const record = await storeExtractedDocument({
          userId: session.user.sub,
          assetId: asset.assetId,
          fileName: file.name,
          searchText: embedded?.searchText,
          embedding: embedded?.embedding,
          embeddingModelId: embedded?.embeddingModelId,
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
        log.error(
          { name: file.name, documentStoreError },
          'extraction not stored'
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
      // Present when the file was recognised as an Amazon report and its rows
      // were stored — the whole file is now queryable, preview or no preview.
      report,
      reportError,
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
    log.error(
      {
        name: file.name,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'import failed'
    );
    return Response.json(
      { error: 'Could not store the document.' },
      { status: 500 }
    );
  }
}
