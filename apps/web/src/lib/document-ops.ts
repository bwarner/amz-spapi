import {
  getStoredDocument,
  listDocuments,
  roleForRecognisedKind,
  setDocumentRole,
  storeExtractedDocument,
  type StoredRecognition,
} from '@amz-spapi/sp-cache';
import type {
  DocumentReading,
  SellerDocumentOps,
} from '@amz-spapi/seller-agent';
import {
  recognizeDocument,
  type DocumentRole,
  type ExtractedDocument,
  type ExtractionIssue,
} from '@farvisionllc/models';
import { extractDocument } from './document-extraction';
import { getAsset, loadAssetBytes } from './media-assets';
import { extractPdfText } from './pdf-text';

/**
 * Host implementation of document reading and filing for the agent (#73).
 *
 * Reading and filing are separate operations because keeping a document is a
 * decision, not a side effect of answering a question about it. A supplier
 * invoice is evidence for reconciliation later; a grocery receipt is not.
 */

/**
 * Readings held between the read and the save that may follow it.
 *
 * Extraction is a paid model call, and #50 exists partly because re-uploading
 * used to pay for a document already read. Filing must therefore not re-extract
 * what the agent just read a moment ago.
 *
 * In-process and short-lived on purpose. It is a latency and cost optimisation
 * for the common case — read, decide, save, all inside one turn — not a store.
 * On a miss (a different serverless instance, or a save minutes later) the save
 * re-extracts rather than failing, so correctness never depends on the cache
 * being warm.
 */
type CachedReading = {
  at: number;
  extracted: ExtractedDocument;
  issues: ExtractionIssue[];
  needsReview: boolean;
  modelId?: string;
  recognition: StoredRecognition;
};

const READING_TTL_MS = 15 * 60 * 1000;
const readings = new Map<string, CachedReading>();

function cacheKey(userId: string, assetId: string): string {
  return `${userId}::${assetId}`;
}

function remember(userId: string, assetId: string, reading: CachedReading) {
  readings.set(cacheKey(userId, assetId), reading);

  // Bounded by eviction on write rather than a timer, so nothing keeps the
  // process alive and a long-lived instance cannot grow without limit.
  for (const [key, value] of readings) {
    if (Date.now() - value.at > READING_TTL_MS) readings.delete(key);
  }
}

function recall(userId: string, assetId: string): CachedReading | undefined {
  const hit = readings.get(cacheKey(userId, assetId));
  if (!hit) return undefined;
  if (Date.now() - hit.at > READING_TTL_MS) {
    readings.delete(cacheKey(userId, assetId));
    return undefined;
  }
  return hit;
}

/** Read the file, classify it, and extract if there is cost in it. */
async function readAndExtract(
  userId: string,
  assetId: string
): Promise<{
  fileName?: string;
  recognition: StoredRecognition;
  extracted?: ExtractedDocument;
  issues: ExtractionIssue[];
  needsReview: boolean;
  modelId?: string;
  note?: string;
}> {
  const loaded = await loadAssetBytes({ userId, assetId });
  if (!loaded) {
    throw new Error(
      `No such document, or it is not yours: ${assetId}. Ask the user to attach it again.`
    );
  }

  // The file name is a recognition signal in its own right — "commercial
  // invoice.pdf" says more than the first page sometimes does.
  const asset = await getAsset(assetId);
  const fileName = asset?.originalFileName;

  const bytes = Buffer.from(loaded.bytes);
  let text = '';
  let noExtractableText = false;
  if (loaded.mimeType === 'application/pdf') {
    const pdf = await extractPdfText(bytes);
    text = pdf.text;
    noExtractableText = pdf.looksScannedOrArtwork;
  } else if (loaded.mimeType.startsWith('text/')) {
    text = bytes.toString('utf8');
  }

  const verdict = recognizeDocument({
    fileName: fileName ?? assetId,
    mimeType: loaded.mimeType,
    text,
    noExtractableText,
  });

  const recognition: StoredRecognition = {
    kind: verdict.kind,
    confidence: verdict.confidence,
    needsUserChoice: verdict.needsUserChoice,
    alternatives: verdict.alternatives.map((entry) => entry.kind),
    signals: verdict.signals.map((signal) => signal.reason),
  };

  // Extraction is metered, so it runs only where there is cost to read. A box
  // label, a design file or a scan with no text must never trigger it.
  const COST_BEARING = new Set(['commercial-invoice', 'receipt']);
  if (!COST_BEARING.has(verdict.kind) || !text.trim() || noExtractableText) {
    return {
      fileName,
      recognition,
      issues: [],
      needsReview: false,
      note: noExtractableText
        ? 'This looks scanned or is artwork — there is no text to read. Say so rather than guessing at figures.'
        : `Recognised as ${verdict.kind}; no cost figures are extracted from that kind.`,
    };
  }

  const extraction = await extractDocument({
    userId,
    text,
    recognisedAs: verdict.kind,
    assetId,
  });

  return {
    fileName,
    recognition,
    extracted: extraction.document,
    issues: extraction.issues,
    needsReview: extraction.needsReview,
    modelId: extraction.modelId,
  };
}

export function createDocumentOps(params: {
  userId: string;
}): SellerDocumentOps {
  const { userId } = params;

  return {
    async readDocument({ assetId }): Promise<DocumentReading> {
      const result = await readAndExtract(userId, assetId);

      if (result.extracted) {
        remember(userId, assetId, {
          at: Date.now(),
          extracted: result.extracted,
          issues: result.issues,
          needsReview: result.needsReview,
          modelId: result.modelId,
          recognition: result.recognition,
        });
      }

      // The evidence recognition cannot supply: have we bought from this vendor
      // before? A grocery receipt and a supplier receipt are the same `kind`.
      let vendorIsKnownSupplier = false;
      if (result.extracted?.vendorName) {
        const seen = await listDocuments({
          userId,
          vendorName: result.extracted.vendorName,
          limit: 1,
        });
        vendorIsKnownSupplier = seen.length > 0;
      }

      const alreadySaved = Boolean(
        await getStoredDocument(userId, `${userId}::${assetId}`)
      );

      return {
        assetId,
        fileName: result.fileName,
        kind: result.recognition.kind,
        confidence: result.recognition.confidence,
        needsUserChoice: result.recognition.needsUserChoice,
        alternatives: result.recognition.alternatives,
        suggestedRole: roleForRecognisedKind(result.recognition.kind),
        vendorIsKnownSupplier,
        alreadySaved,
        note: result.note,
        extraction: result.extracted
          ? {
              vendorName: result.extracted.vendorName,
              documentDate: result.extracted.documentDate,
              currency: result.extracted.currency,
              total: result.extracted.total,
              lines: result.extracted.lines.map((line) => ({
                description: line.description,
                kind: line.kind,
                quantity: line.quantity,
                amount: line.amount,
              })),
              needsReview: result.needsReview,
            }
          : undefined,
      };
    },

    async saveDocument({ assetId, role }) {
      const cached = recall(userId, assetId);
      const reading = cached ?? (await readAndExtract(userId, assetId));

      const extracted =
        'extracted' in reading ? reading.extracted : cached?.extracted;
      if (!extracted) {
        // Nothing to file. Storing a document with no extraction would put a
        // row into reconciliation that carries no figures.
        throw new Error(
          'There are no cost figures in that document, so there is nothing to file.'
        );
      }

      const stored = await storeExtractedDocument({
        userId,
        assetId,
        recognition: reading.recognition,
        extracted,
        issues: reading.issues,
        needsReview: reading.needsReview,
        modelId: reading.modelId,
        role: role as DocumentRole | undefined,
      });

      return { documentId: stored.documentId, role: stored.role };
    },

    async listDocuments(filters) {
      const documents = await listDocuments({ userId, ...filters });
      return documents.map((doc) => ({
        documentId: doc.documentId,
        role: doc.role,
        vendorName: doc.extracted.vendorName,
        documentDate: doc.extracted.documentDate,
        currency: doc.extracted.currency,
        total: doc.extracted.total,
        needsReview: doc.needsReview,
      }));
    },

    async setDocumentRole({ documentId, role }) {
      const updated = await setDocumentRole({
        userId,
        documentId,
        role: role as DocumentRole,
      });
      return { documentId: updated.documentId, role: updated.role };
    },
  };
}
