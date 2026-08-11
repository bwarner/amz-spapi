import { createAIProvider } from '@amz-spapi/ai-provider';
import { embed, embedMany } from 'ai';
import {
  documentSearchText,
  EMBEDDING_DIMENSIONS,
  type StoredDocument,
} from '@amz-spapi/sp-cache';
import { loggerFor } from './logger';

const log = loggerFor('documents');

/**
 * Turning a document into something searchable by meaning.
 *
 * The vector lives on the document rather than in a second store, so there is
 * one record to write, one to delete, and no way for the two to disagree about
 * which documents exist. `document-search` owns what text stands for a document;
 * this owns turning that text into a vector and is the only place in the web app
 * that talks to an embedding model.
 *
 * ## Failing is allowed; failing silently is not
 *
 * Embedding is a paid network call and it sits inside the upload path. If the
 * gateway is down, the seller's invoice must still be stored, extracted and
 * listed — it is simply absent from semantic search until re-embedded. So every
 * function here returns `undefined` rather than throwing, and says so in the
 * log. What must NOT happen is an import that reports success while quietly
 * dropping the document out of search with nothing recorded anywhere; that is
 * why the failure is logged with the document's identity rather than swallowed.
 */

/** Everything needed to describe a document, before it has been stored. */
export type EmbeddableDocument = Pick<
  StoredDocument,
  'role' | 'recognition' | 'extracted' | 'fileName'
>;

export type DocumentEmbedding = {
  searchText: string;
  embedding: number[];
  embeddingModelId: string;
};

/**
 * The widest text worth embedding.
 *
 * `documentSearchText` is already a summary — counterparty, references, line
 * descriptions — so this bound is a backstop against a pathological document
 * with a thousand line items, not a routine truncation. Embedding models charge
 * by token and silently truncate past their own limit, so an unbounded string
 * would cost more and quietly lose its tail.
 */
const MAX_EMBED_CHARS = 8_000;

function prepare(document: EmbeddableDocument): string | undefined {
  const text = documentSearchText(document).trim();
  if (!text) return undefined;
  return text.slice(0, MAX_EMBED_CHARS);
}

/**
 * Assert the model returned vectors of the width the index was built for.
 *
 * A mismatch means the embedding model changed under a Search index that was
 * built for the old width. Storing them anyway would fill the collection with
 * vectors the index rejects at query time, and the error would surface far from
 * its cause — so it is caught here, where the model that produced it is known.
 */
function checkWidth(vector: number[], modelId: string): boolean {
  if (vector.length === EMBEDDING_DIMENSIONS) return true;
  log.error(
    { modelId, width: vector.length, expected: EMBEDDING_DIMENSIONS },
    'embedding width does not match the search index; not storing the vector'
  );
  return false;
}

/** Embed one document. `undefined` when there is nothing to embed, or it failed. */
export async function embedDocument(
  document: EmbeddableDocument
): Promise<DocumentEmbedding | undefined> {
  const searchText = prepare(document);
  if (!searchText) return undefined;

  const provider = createAIProvider();
  const model = provider.embeddingModel?.();
  const embeddingModelId = provider.embeddingModelId?.();
  if (!model || !embeddingModelId) return undefined;

  try {
    const { embedding } = await embed({ model, value: searchText });
    if (!checkWidth(embedding, embeddingModelId)) return undefined;
    return { searchText, embedding, embeddingModelId };
  } catch (error) {
    log.error(
      {
        vendor: document.extracted?.vendorName,
        fileName: document.fileName,
        error: error instanceof Error ? error.message : error,
      },
      'could not embed document; it will be absent from semantic search'
    );
    return undefined;
  }
}

/**
 * Embed what the seller typed, for the semantic half of a search.
 *
 * The query goes through the same model as the documents, which is not a
 * detail: vectors from two different models occupy unrelated spaces, and
 * comparing across them returns confident nonsense rather than an error.
 *
 * `undefined` on failure, so a search still runs as keyword-only rather than
 * failing outright — a seller looking for an invoice number does not need the
 * vector half at all.
 */
export async function embedQuery(
  text: string
): Promise<{ vector: number[]; modelId: string } | undefined> {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const provider = createAIProvider();
  const model = provider.embeddingModel?.();
  const modelId = provider.embeddingModelId?.();
  if (!model || !modelId) return undefined;

  try {
    const { embedding } = await embed({
      model,
      value: trimmed.slice(0, MAX_EMBED_CHARS),
    });
    if (!checkWidth(embedding, modelId)) return undefined;
    return { vector: embedding, modelId };
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : error },
      'could not embed the query; falling back to keyword search'
    );
    return undefined;
  }
}

/**
 * Embed many documents in one request.
 *
 * For the backfill, where the alternative is one HTTP round trip per document
 * and a corpus that takes an hour to become searchable. Returns a result per
 * input, positionally, with `undefined` where a document had no text — so a
 * caller can zip it back against the documents it passed in without tracking
 * indices itself.
 */
export async function embedDocuments(
  documents: EmbeddableDocument[]
): Promise<Array<DocumentEmbedding | undefined>> {
  const prepared = documents.map(prepare);
  const embeddable = prepared
    .map((text, index) => ({ text, index }))
    .filter((entry): entry is { text: string; index: number } =>
      Boolean(entry.text)
    );

  if (!embeddable.length) return documents.map(() => undefined);

  const provider = createAIProvider();
  const model = provider.embeddingModel?.();
  const embeddingModelId = provider.embeddingModelId?.();
  if (!model || !embeddingModelId) return documents.map(() => undefined);

  const results: Array<DocumentEmbedding | undefined> = documents.map(
    () => undefined
  );

  try {
    const { embeddings } = await embedMany({
      model,
      values: embeddable.map((entry) => entry.text),
    });

    embeddable.forEach((entry, position) => {
      const embedding = embeddings[position];
      // A short response would otherwise pair vectors with the WRONG documents
      // from that point on — every subsequent one silently mis-embedded.
      if (!embedding || !checkWidth(embedding, embeddingModelId)) return;
      results[entry.index] = {
        searchText: entry.text,
        embedding,
        embeddingModelId,
      };
    });

    if (embeddings.length !== embeddable.length) {
      log.error(
        { asked: embeddable.length, returned: embeddings.length },
        'embedding batch came back short; the missing documents were skipped'
      );
    }
  } catch (error) {
    log.error(
      {
        count: embeddable.length,
        error: error instanceof Error ? error.message : error,
      },
      'could not embed batch; those documents stay absent from semantic search'
    );
  }

  return results;
}
