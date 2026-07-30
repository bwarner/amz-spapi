import { generateText, Output } from 'ai';
import { createAIProvider } from '@amz-spapi/ai-provider';
import {
  ExtractedDocumentSchema,
  needsReview,
  validateExtraction,
  type ExtractedDocument,
  type ExtractionIssue,
} from '@farvisionllc/models';
import { withPaidCall } from './cost-ledger';

/**
 * Pull cost data out of an invoice or receipt.
 *
 * This is the one place in the document pipeline where a model is warranted.
 * Recognition is deterministic because it runs on every upload, must be
 * repeatable and costs nothing; reading a supplier's idiosyncratic layout into
 * typed lines is judgement, and no amount of keyword matching does it.
 *
 * The model does NOT get the last word. Its output is parsed by a Zod schema and
 * then checked arithmetically: line maths, lines against subtotal, subtotal
 * against total, paid against total, and ambiguous dates. A model that reads
 * $4,102.04 as $410.204 produces figures that look plausible and are wrong by a
 * factor of ten, and only the arithmetic catches that.
 */

/** Truncate very long documents; a supplier invoice is never 200 pages. */
const MAX_TEXT_CHARS = 40_000;

export type ExtractionResult = {
  document: ExtractedDocument;
  issues: ExtractionIssue[];
  /** True when a human should look before these figures are used as cost. */
  needsReview: boolean;
  /** Which model produced this, so a suspect figure can be attributed. */
  modelId?: string;
};

export class ExtractionFailed extends Error {}

const SYSTEM_PROMPT = [
  'You extract cost data from supplier invoices and receipts.',
  '',
  'Rules:',
  '- Transcribe figures exactly as printed. Never compute a missing total,',
  '  never correct one that looks wrong, and never convert currency.',
  '- Put the date exactly as printed in documentDateRaw. Only set documentDate',
  '  when the format is unambiguous; a date like 06/01/2026 is not.',
  '- Classify every line: product for goods, freight for shipping and',
  '  transport, fee for duties, taxes and handling, discount for credits,',
  '  overhead for services that belong to no product (agency retainers,',
  '  photography, virtual assistants).',
  '- Amounts are positive except discounts and credits, which are negative.',
  '- Copy the supplier’s own part or SKU code into supplierRef when present.',
  '  It is how a line is later matched to a seller SKU.',
  '- Omit a field rather than guessing at it. A missing value is reported; an',
  '  invented one is not.',
].join('\n');

/**
 * Extract, then verify.
 *
 * Metered through the daily cap: this costs money on every call, unlike the
 * deterministic recognition that precedes it.
 */
export async function extractDocument(params: {
  userId: string;
  text: string;
  /** Recognised kind, used only to steer the prompt. */
  recognisedAs?: string;
  fileName?: string;
  assetId?: string;
  chatId?: string;
}): Promise<ExtractionResult> {
  const text = params.text.trim();
  if (!text) {
    throw new ExtractionFailed(
      'No text to extract from. A scanned document needs a visual read rather than this path.'
    );
  }

  const models = {
    ...(process.env['AI_DEFAULT_MODEL']
      ? { default: process.env['AI_DEFAULT_MODEL'] }
      : {}),
  };
  const provider = createAIProvider({ models });
  const model = provider.languageModel('default');

  const result = await withPaidCall(
    {
      userId: params.userId,
      vendor: 'llm',
      operation: 'document-extract',
      feature: 'documents',
      chatId: params.chatId,
    },
    async () =>
      // AI SDK 6: generateObject was removed; structured output is generateText
      // with Output.object, and the result field is `output`, not `object`.
      generateText({
        model,
        output: Output.object({ schema: ExtractedDocumentSchema }),
        system: SYSTEM_PROMPT,
        prompt: [
          params.recognisedAs
            ? `This document was recognised as: ${params.recognisedAs}.`
            : '',
          params.fileName ? `File name: ${params.fileName}` : '',
          '',
          'Document text:',
          text.slice(0, MAX_TEXT_CHARS),
        ]
          .filter(Boolean)
          .join('\n'),
      })
  );

  const document = result.output;
  // The arithmetic is the point. A model cannot be trusted with a total, and
  // these checks are what turn a plausible reading into a usable one.
  const issues = validateExtraction(document);

  return {
    document,
    issues,
    needsReview: needsReview(issues),
    modelId: typeof model === 'string' ? model : model.modelId,
  };
}

/**
 * Cross-check an extracted document against FBA box labels for the same goods.
 *
 * A supplier invoice for a shipment and the box labels for that shipment should
 * agree on quantity per SKU. When they do, the extraction is corroborated by a
 * source the model never saw; when they don't, one of them is wrong and it
 * matters which. This is cheaper and stronger than asking a model to check
 * itself.
 */
export type ShippedCrossCheck = {
  sku: string;
  shipped: number;
  invoiced?: number;
  /**
   * Whether an invoice line could be tied to this SKU at all. Distinct from
   * `agrees`, because "no line matched" is not a disagreement — reporting it as
   * one manufactures a discrepancy out of a naming gap.
   */
  matched: boolean;
  /** Only meaningful when `matched`. Undefined otherwise. */
  agrees?: boolean;
};

export function crossCheckAgainstShipped(
  document: ExtractedDocument,
  shipped: Array<{ sku: string; quantity: number }>
): ShippedCrossCheck[] {
  return shipped.map((line) => {
    // A supplier writes its own part codes and descriptions: a real invoice for
    // FB-COF-GEI-250 reads "Cafe Geisha process washed 250 gr" with ref 0002.
    // Nothing here will match that, and it must not therefore claim the
    // quantities disagree. Learning the mapping is #38.
    const match = document.lines.find(
      (candidate) =>
        candidate.kind === 'product' &&
        (candidate.supplierRef === line.sku ||
          candidate.description.toLowerCase().includes(line.sku.toLowerCase()))
    );
    if (!match) {
      return { sku: line.sku, shipped: line.quantity, matched: false };
    }
    return {
      sku: line.sku,
      shipped: line.quantity,
      invoiced: match.quantity,
      matched: true,
      agrees: match.quantity === line.quantity,
    };
  });
}
