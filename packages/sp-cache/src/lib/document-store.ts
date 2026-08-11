/**
 * Persist extracted purchase documents (#50).
 *
 * Extraction used to exist only for the lifetime of an HTTP response: the
 * invoice was read, the figures returned, and the record dropped. That blocks
 * reconciliation (#43), whose whole premise is documents that arrive **weeks
 * apart** — the order receipt at order time, the supplier's invoice when it
 * ships, the waybill from the carrier, the proof of delivery on arrival.
 * Grouping them requires all of them to still exist. It also meant every
 * re-upload paid the model again for a document already read.
 *
 * Identity is (user, asset). The asset layer already dedupes on sha256, so the
 * same file always yields the same asset id, so re-uploading upserts the same
 * document rather than creating a second one. That is the idempotency #50 asks
 * for, and it comes from reusing the identity that already exists rather than
 * hashing again here.
 *
 * Roles are editable. Recognition can be wrong, and the role decides which
 * document is authoritative for which question under `PURCHASE_AUTHORITY` —
 * filing a waybill as an invoice would make freight count as cost. When a human
 * corrects one, that is recorded as such, so a later re-import cannot quietly
 * overwrite the correction with the guess it replaced.
 */

import {
  collectionName,
  deleteDocument,
  executeQuery,
  getDocument as getCouchbaseDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  groupPurchaseDocuments,
  type DocumentRole,
  type ExtractedDocument,
  type ExtractionIssue,
  type PurchaseDocument,
  type PurchaseGrouping,
  type RecognisedKind,
} from '@farvisionllc/models';

/** Seam for tests: ESM exports are read-only and cannot be monkey-patched. */
export const documentStorage = {
  executeQuery,
  upsertDocument,
  deleteDocument,
  getDocument: getCouchbaseDocument,
};

/**
 * Where extracted documents live.
 *
 * Exported because the Search index has to name the same keyspace, and naming
 * it twice is how the two drift apart — an index pointed at a collection
 * nothing writes to builds cleanly and returns nothing forever.
 */
export const DOCUMENTS_DOMAIN = 'purchases';
export const DOCUMENTS_COLLECTION = 'documents';

const SCOPE = DOCUMENTS_DOMAIN;
const COLLECTION = DOCUMENTS_COLLECTION;

/** How a document came to have the role it has. */
export type RoleSource =
  /** Derived from the recogniser's verdict. */
  | 'recognised'
  /** A human said so, and must not be overwritten by a later guess. */
  | 'user';

/** The recogniser's verdict, kept so a wrong guess can be argued with. */
export type StoredRecognition = {
  kind: RecognisedKind;
  confidence: number;
  needsUserChoice: boolean;
  alternatives: RecognisedKind[];
  /** Human-readable reasons, not the weights — those are not reviewable. */
  signals: string[];
};

export type StoredDocument = {
  documentId: string;
  userId: string;
  /** The file this was read from, so any figure can be traced back to its PDF. */
  assetId: string;
  fileName?: string;
  role: DocumentRole;
  roleSource: RoleSource;
  recognition: StoredRecognition;
  extracted: ExtractedDocument;
  issues: ExtractionIssue[];
  /** True when a human should look before these figures are used as cost. */
  needsReview: boolean;
  /** Which model produced the extraction, so a suspect figure is attributable. */
  modelId?: string;
  /** Semantic index text, indexed by the Search service. */
  searchText?: string;
  /** Embedding of `searchText`. Absent until the document has been embedded. */
  embedding?: number[];
  /** Which model produced `embedding`, so stale vectors can be found. */
  embeddingModelId?: string;
  /**
   * Set when a human confirmed a grouping the joins could not make on their
   * own. Derived grouping is the default and stays consistent with the
   * documents; this exists because `groupPurchaseDocuments` deliberately
   * refuses to guess, so something has to remember the answer it asked for.
   */
  confirmedPurchaseId?: string;
  storedAt: number;
  updatedAt: number;
};

export class DocumentStoreError extends Error {}

/**
 * Which purchase role a recognised kind implies, or `null` for a file that is
 * not part of a purchase at all.
 *
 * Deliberately not a rename of the recogniser's vocabulary. `recognizeDocument`
 * answers "what is this document", and the two vocabularies disagree in ways
 * that matter: a receipt is recognised as a receipt but files as a
 * `payment-record`, because under `PURCHASE_AUTHORITY` it proves money moved
 * and is never the authority on what the goods cost. Box labels, artwork and
 * Amazon reports are documents the seller keeps, and none of them belongs in a
 * purchase.
 */
export function roleForRecognisedKind(
  kind: RecognisedKind
): DocumentRole | null {
  switch (kind) {
    case 'commercial-invoice':
      return 'commercial-invoice';
    case 'receipt':
      return 'payment-record';
    case 'proof-of-delivery':
      return 'proof-of-delivery';
    case 'transport-document':
      return 'transport-document';
    case 'customs-declaration':
      return 'customs-declaration';
    case 'packing-list':
      return 'packing-list';
    case 'amazon-report':
    case 'fba-box-label':
    case 'fnsku-label':
    case 'design-artwork':
    case 'unknown':
      return null;
  }
}

function documentKey(userId: string, assetId: string): string {
  return `${userId}::${assetId}`;
}

export type StoreDocumentParams = {
  userId: string;
  assetId: string;
  fileName?: string;
  recognition: StoredRecognition;
  extracted: ExtractedDocument;
  issues: ExtractionIssue[];
  needsReview: boolean;
  modelId?: string;
  /** Overrides the role the recognition implies. Records the human as source. */
  role?: DocumentRole;
  /**
   * Semantic index of this document (from `documentSearchText`) and its
   * embedding. Both optional: a document stored without them is still a
   * document, it is simply absent from semantic search until re-embedded.
   *
   * Computed by the caller rather than here, so this package keeps no
   * dependency on the AI provider — the import route already holds one.
   */
  searchText?: string;
  embedding?: number[];
  /**
   * Which model produced `embedding`. Recorded rather than assumed: the vector
   * width is baked into the Search index, so after a model change knowing
   * WHICH rows are stale is the difference between re-embedding the corpus and
   * rebuilding it blind.
   */
  embeddingModelId?: string;
};

/**
 * Store one extracted document, or update the one this asset already produced.
 *
 * A user-set role survives re-import. Otherwise a seller who corrected a
 * misfiled waybill would find their correction undone by uploading the same
 * file again, which is exactly the sort of silent regression that makes people
 * stop trusting a correction they made once.
 */
export async function storeExtractedDocument(
  params: StoreDocumentParams
): Promise<StoredDocument> {
  const { userId, assetId } = params;
  if (!userId) throw new DocumentStoreError('A document needs an owner.');
  if (!assetId) {
    // Without the asset there is no identity, so re-upload would duplicate, and
    // no figure could be traced back to the file it came from.
    throw new DocumentStoreError(
      'A document needs the asset it was read from, for identity and provenance.'
    );
  }

  const documentId = documentKey(userId, assetId);
  const existing = await documentStorage.getDocument<StoredDocument>(
    SCOPE,
    COLLECTION,
    documentId
  );

  const recognisedRole = roleForRecognisedKind(params.recognition.kind);
  const role =
    params.role ??
    (existing?.roleSource === 'user' ? existing.role : recognisedRole) ??
    'other';
  const roleSource: RoleSource =
    params.role || existing?.roleSource === 'user' ? 'user' : 'recognised';

  const now = Date.now();
  const record: StoredDocument = {
    documentId,
    userId,
    assetId,
    fileName: params.fileName,
    role,
    roleSource,
    recognition: params.recognition,
    extracted: params.extracted,
    issues: params.issues,
    needsReview: params.needsReview,
    modelId: params.modelId,
    // Re-reading a file with no embedder configured must not silently strip
    // the vector a previous import produced — that would drop the document
    // out of semantic search with nothing to show for it.
    searchText: params.searchText ?? existing?.searchText,
    embedding: params.embedding ?? existing?.embedding,
    embeddingModelId: params.embeddingModelId ?? existing?.embeddingModelId,
    // A confirmed grouping is about these documents' relationship, not their
    // content, so re-reading the file must not forget it.
    confirmedPurchaseId: existing?.confirmedPurchaseId,
    storedAt: existing?.storedAt ?? now,
    updatedAt: now,
  };

  await documentStorage.upsertDocument(SCOPE, COLLECTION, documentId, record);
  return record;
}

export type ListDocumentsFilters = {
  userId: string;
  /** ISO date, inclusive. Filters on the document's own date, not upload time. */
  from?: string;
  to?: string;
  vendorName?: string;
  limit?: number;
};

/**
 * One seller's documents, newest first.
 *
 * Ordered and filtered on `extracted.documentDate` rather than `storedAt`,
 * because a purchase is grouped by when it happened. A waybill for a January
 * order often arrives in March, and ordering by upload time would scatter one
 * purchase across the list.
 */
export async function listDocuments(
  filters: ListDocumentsFilters
): Promise<StoredDocument[]> {
  const { userId } = filters;
  if (!userId) throw new DocumentStoreError('A document listing needs a user.');

  const conditions = ['`userId` = $userId', '`deleted` IS MISSING'];
  const parameters: Record<string, unknown> = { userId };

  if (filters.from) {
    conditions.push('`extracted`.`documentDate` >= $from');
    parameters['from'] = filters.from;
  }
  if (filters.to) {
    conditions.push('`extracted`.`documentDate` <= $to');
    parameters['to'] = filters.to;
  }
  if (filters.vendorName) {
    // Case-insensitive: a supplier is spelled differently on every document
    // they issue, and an exact match would hide half of a purchase.
    conditions.push('LOWER(`extracted`.`vendorName`) = LOWER($vendorName)');
    parameters['vendorName'] = filters.vendorName;
  }

  const { rows } = await documentStorage.executeQuery<StoredDocument>(
    SCOPE,
    `SELECT RAW d FROM \`${collectionName(SCOPE, COLLECTION)}\` d
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.\`extracted\`.\`documentDate\` DESC
     LIMIT $limit`,
    { parameters: { ...parameters, limit: filters.limit ?? 200 } }
  );

  return rows;
}

export async function getStoredDocument(
  userId: string,
  documentId: string
): Promise<StoredDocument | null> {
  const doc = await documentStorage.getDocument<StoredDocument>(
    SCOPE,
    COLLECTION,
    documentId
  );
  // Ownership is checked here rather than trusted from the key, so a guessed
  // id cannot read another seller's evidence.
  if (!doc || doc.userId !== userId) return null;
  return doc;
}

/**
 * Forget an extracted document.
 *
 * Deleted outright rather than flagged. A soft delete would leave the figures
 * in place for anything that reads the collection without knowing to exclude
 * them, and the point of removing a misread invoice is that its numbers stop
 * counting — a half-deleted cost is worse than either state.
 *
 * Ownership-checked through `getStoredDocument`, so a guessed id deletes
 * nothing. Returns false when there was nothing to delete, which is the same
 * outcome the caller wanted and not an error.
 */
export async function deleteStoredDocument(params: {
  userId: string;
  documentId: string;
}): Promise<boolean> {
  const existing = await getStoredDocument(params.userId, params.documentId);
  if (!existing) return false;
  await documentStorage.deleteDocument(SCOPE, COLLECTION, params.documentId);
  return true;
}

/**
 * Correct a document's role.
 *
 * The role decides authority, so this is the difference between freight being
 * counted as cost and not. Marked as user-set, which makes it survive the next
 * re-import of the same file.
 */
export async function setDocumentRole(params: {
  userId: string;
  documentId: string;
  role: DocumentRole;
}): Promise<StoredDocument> {
  const existing = await getStoredDocument(params.userId, params.documentId);
  if (!existing) {
    throw new DocumentStoreError(`No document ${params.documentId}.`);
  }

  const record: StoredDocument = {
    ...existing,
    role: params.role,
    roleSource: 'user',
    updatedAt: Date.now(),
  };
  await documentStorage.upsertDocument(
    SCOPE,
    COLLECTION,
    record.documentId,
    record
  );
  return record;
}

/**
 * Record that a human confirmed several documents are one purchase.
 *
 * `groupPurchaseDocuments` joins only on identifiers strong enough to be sure —
 * an invoice number, a tracking number — and offers everything else as a
 * suggestion rather than guessing. This is where the answer to such a
 * suggestion lives, kept on the documents themselves so there is no second
 * collection to fall out of step with them.
 */
export async function confirmPurchase(params: {
  userId: string;
  documentIds: string[];
}): Promise<StoredDocument[]> {
  if (params.documentIds.length < 2) {
    throw new DocumentStoreError(
      'Confirming a purchase needs at least two documents.'
    );
  }

  // The lowest id, matching how groupPurchaseDocuments names a derived group,
  // so a confirmed purchase and a derived one are named the same way.
  const purchaseId = [...params.documentIds].sort()[0];

  const updated: StoredDocument[] = [];
  for (const documentId of params.documentIds) {
    const existing = await getStoredDocument(params.userId, documentId);
    if (!existing) throw new DocumentStoreError(`No document ${documentId}.`);

    const record: StoredDocument = {
      ...existing,
      confirmedPurchaseId: purchaseId,
      updatedAt: Date.now(),
    };
    await documentStorage.upsertDocument(SCOPE, COLLECTION, documentId, record);
    updated.push(record);
  }

  return updated;
}

/**
 * A seller's purchases: derived by joining, then merged by what a human confirmed.
 *
 * Derived is the default because it stays consistent with the documents — add a
 * waybill and it joins itself. Confirmations are layered on top rather than
 * replacing the derivation, so a human answer never has to be re-given, and the
 * documents it grouped keep joining anything else they match.
 */
export async function purchaseGrouping(
  filters: ListDocumentsFilters
): Promise<PurchaseGrouping & { documents: StoredDocument[] }> {
  const documents = await listDocuments(filters);

  const purchaseDocuments: PurchaseDocument[] = documents.map((doc) => ({
    documentId: doc.documentId,
    role: doc.role,
    extracted: doc.extracted,
  }));

  const derived = groupPurchaseDocuments(purchaseDocuments);
  const confirmations = new Map<string, string>();
  for (const doc of documents) {
    if (doc.confirmedPurchaseId) {
      confirmations.set(doc.documentId, doc.confirmedPurchaseId);
    }
  }

  if (!confirmations.size) return { ...derived, documents };

  // Merge any derived groups that a confirmation spans. Two documents joined by
  // a human pull their whole derived groups together — otherwise confirming one
  // pair would split a purchase the joins had already assembled.
  const merged: typeof derived.purchases = [];
  const byConfirmation = new Map<string, (typeof derived.purchases)[number]>();

  for (const group of derived.purchases) {
    const confirmed = group.documentIds
      .map((id) => confirmations.get(id))
      .find(Boolean);

    if (!confirmed) {
      merged.push(group);
      continue;
    }

    const existing = byConfirmation.get(confirmed);
    if (existing) {
      existing.documentIds = [
        ...new Set([...existing.documentIds, ...group.documentIds]),
      ].sort();
      existing.joins = [...existing.joins, ...group.joins];
    } else {
      const entry = { ...group, purchaseId: confirmed };
      byConfirmation.set(confirmed, entry);
      merged.push(entry);
    }
  }

  return {
    purchases: merged,
    // A suggestion a human already answered is not a question any more.
    suggestions: derived.suggestions.filter(
      (suggestion) =>
        !suggestion.documentIds.every((id) => confirmations.has(id))
    ),
    documents,
  };
}
