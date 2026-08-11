import {
  deleteBoxLabelsForAsset,
  deleteImport,
  deleteStoredDocument,
  listBoxLabels,
  listImports,
  listPurchaseOrders,
  purchaseGrouping,
  REPORTS,
  type ReportImport,
  type StoredBoxLabel,
  type StoredDocument,
  type StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';
import {
  PURCHASE_AUTHORITY,
  type PurchaseGrouping,
  type PurchaseJoin,
} from '@farvisionllc/models';
import { resolveAmazonConnection } from './amazon-connections';
import {
  deleteAsset,
  getAsset,
  listAssets,
  type MediaAsset,
} from './media-assets';

/**
 * One view of everything a seller has brought into the app.
 *
 * ## Why this has to be assembled rather than read
 *
 * Importing a file writes to whichever store the file's CONTENT implies, and
 * nothing has ever written a record of the import itself. A settlement export
 * becomes rows in `reports_rows` plus a ledger entry in `reports_imports`, and
 * no asset at all. A supplier invoice becomes an asset in `media_assets` plus,
 * if it carried figures, an extracted document in `purchases_documents`. A box
 * label PDF becomes an asset plus a row per box in `reports_box_labels`. A
 * spreadsheet that turns out to be an Amazon report becomes an asset AND an
 * import.
 *
 * Each of those is the right home for the data. None of them is the answer to
 * "what have I uploaded", which is the question a person actually asks — so the
 * answer is composed here, from four reads, rather than stored a fifth time and
 * left to drift out of step with the four.
 *
 * ## The join
 *
 * Two records describe one file when their bytes match: `ReportImport` keeps
 * `fileSha256` and `MediaAsset` keeps `hashes.sha256`. Without that join a
 * seller who dropped a settlement onto the Import page would see it twice —
 * once as a stored file and once as an import — and deleting either copy would
 * leave the other behind, looking like it had failed.
 *
 * `buildFileView` is pure, and the joins are the reason: getting them wrong is
 * silent (a duplicated row, an orphaned import) and testing them against a
 * cluster would be testing Couchbase.
 */

/** What one imported file turned into. A file can produce more than one. */
export type Produced =
  | {
      kind: 'report-rows';
      importId: string;
      reportKind: string;
      /** The registry's human label, e.g. "Settlement (payments archive)". */
      label: string;
      rowsNew: number;
      rowsParsed: number;
      observedFrom?: string;
      observedTo?: string;
      unmappedHeaders?: string[];
    }
  | {
      kind: 'purchase-document';
      documentId: string;
      role: string;
      roleSource: string;
      vendorName?: string;
      documentDate?: string;
      currency?: string;
      total?: number;
      needsReview: boolean;
      /** The purchase this document belongs to, derived or confirmed. */
      purchaseId?: string;
      /** Shipments this document is attached to — the other end of the link
          the Shipments screen writes, so an attach is visible from BOTH sides. */
      shipmentIds?: string[];
      /**
       * Set when this upload is a COPY of an order the app itself issued —
       * its extracted number matches an issued PO's number, which is ours and
       * sequential, so a match is identity rather than coincidence. Byte
       * hashing cannot make this join: a re-render or a download that rewrites
       * metadata changes every byte of "the same document".
       */
      issuedPoNumber?: string;
    }
  | {
      kind: 'box-labels';
      shipmentId: string;
      boxes: number;
      units: number;
      destinationFc?: string;
    };

export type FileEntry = {
  /** Stable key for the UI and for the delete call. */
  id: string;
  /**
   * True when no record of the original name survives, so `fileName` is a
   * description rather than the name the seller gave it. Flagged rather than
   * left to the UI to sniff for a prefix, which would put a storage detail in
   * a component's business.
   */
  nameUnknown?: boolean;
  /** Present when the bytes were kept, so the file can be downloaded again. */
  assetId?: string;
  /**
   * Present when the file was ingested as an Amazon report. A file can have
   * both — a spreadsheet that was stored AND recognised.
   */
  importId?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Epoch ms. Upload time, not the date printed on the document. */
  uploadedAt: number;
  produced: Produced[];
};

export type PurchaseView = {
  purchaseId: string;
  /** File ids, in the order the grouping returned their documents. */
  fileIds: string[];
  vendorName?: string;
  documentDate?: string;
  currency?: string;
  /** Sum of the documents that are authoritative for cost. */
  total?: number;
  /** Why these were joined — "invoice number INV-8821", and so on. */
  joins: string[];
  confirmed: boolean;
};

export type SuggestionView = {
  fileIds: string[];
  documentIds: string[];
  reason: string;
};

export type DocumentCenter = {
  files: FileEntry[];
  purchases: PurchaseView[];
  suggestions: SuggestionView[];
  /**
   * Whether the seller-scoped half of the list could be read at all.
   *
   * Report imports and box labels are keyed by seller, so without a connection
   * they cannot be listed — and an empty list reads as "you imported nothing",
   * which is a different and much worse claim. `unavailable` is kept apart from
   * `not-connected` for the same reason: "we could not ask" and "there is
   * nothing to ask about" must not render as the same sentence.
   */
  sellerStatus: 'connected' | 'not-connected' | 'unavailable';
};

/** The four reads, already done. Keeps the assembly testable. */
export type FileViewInput = {
  userId: string;
  assets: MediaAsset[];
  imports: ReportImport[];
  boxLabels: StoredBoxLabel[];
  grouping: PurchaseGrouping & { documents: StoredDocument[] };
  /** Issued orders, for folding uploaded copies onto their originals. */
  purchaseOrders?: StoredPurchaseOrder[];
};

/** "po-2026-0001 " and "PO-2026-0001" are the same number. */
function normalisePoNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Which issued order, if any, an uploaded document is a copy of.
 *
 * Only documents FILED as purchase orders are considered: an invoice that
 * cites the PO it answers carries the same number, and folding it would file
 * the bill as the order. The number is Sellavant's own — assigned
 * sequentially at issue — so a match on it is identity, not resemblance.
 */
export function issuedOrderFor(
  document: Pick<StoredDocument, 'role' | 'extracted'>,
  ordersByNumber: Map<string, string>
): string | undefined {
  if (document.role !== 'purchase-order') return undefined;
  const number =
    document.extracted.invoiceNumber ?? document.extracted.receiptNumber;
  if (!number) return undefined;
  return ordersByNumber.get(normalisePoNumber(number));
}

/**
 * A file's display name.
 *
 * Assets uploaded before names were kept are stored as `generated-asset_….pdf`
 * (see `persistGeneratedFileAsset`). Anything that read the file later — the
 * extracted document, a box label — recorded the real name, so prefer those and
 * fall back to the placeholder rather than inventing one.
 */
function displayName(
  asset: MediaAsset,
  document?: StoredDocument,
  labels?: StoredBoxLabel[]
): { fileName: string; nameUnknown?: boolean } {
  if (!asset.originalFileName.startsWith('generated-')) {
    return { fileName: asset.originalFileName };
  }

  const recovered =
    document?.fileName ?? labels?.find((label) => label.fileName)?.fileName;
  if (recovered) return { fileName: recovered };

  // Nothing recorded it. Showing `generated-asset_7f2748dd-…pdf` puts an
  // internal identifier where a name goes and helps nobody find anything — say
  // plainly that the name is not known, and let the date and type identify it.
  const kind = describeType(asset.mimeType);
  return { fileName: `Unnamed ${kind}`, nameUnknown: true };
}

/** A short, human word for a mime type. */
function describeType(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('illustrator')) return 'Illustrator file';
  if (mimeType === 'text/csv' || mimeType.includes('spreadsheet')) {
    return 'spreadsheet';
  }
  if (mimeType.startsWith('text/')) return 'text file';
  return 'file';
}

/**
 * Assemble the view. Pure — every read has already happened.
 *
 * Ordered newest first across BOTH sources, so a settlement imported this
 * morning and an invoice uploaded this afternoon sit in the order they
 * happened rather than in two separate lists the eye has to merge.
 */
export function buildFileView(input: FileViewInput): {
  files: FileEntry[];
  purchases: PurchaseView[];
  suggestions: SuggestionView[];
} {
  const documentsByAsset = new Map<string, StoredDocument>();
  for (const document of input.grouping.documents) {
    documentsByAsset.set(document.assetId, document);
  }

  const ordersByNumber = new Map<string, string>();
  for (const po of input.purchaseOrders ?? []) {
    ordersByNumber.set(normalisePoNumber(po.order.poNumber), po.order.poNumber);
  }

  const labelsByAsset = new Map<string, StoredBoxLabel[]>();
  for (const label of input.boxLabels) {
    if (!label.assetId) continue;
    const existing = labelsByAsset.get(label.assetId);
    if (existing) existing.push(label);
    else labelsByAsset.set(label.assetId, [label]);
  }

  // Which purchase each document ended up in, so a file can say so without the
  // UI having to search the groups.
  const purchaseByDocument = new Map<string, string>();
  for (const purchase of input.grouping.purchases) {
    for (const documentId of purchase.documentIds) {
      purchaseByDocument.set(documentId, purchase.purchaseId);
    }
  }

  const importsBySha = new Map<string, ReportImport>();
  for (const record of input.imports) {
    if (record.fileSha256) importsBySha.set(record.fileSha256, record);
  }

  const claimedImports = new Set<string>();
  const fileIdByDocument = new Map<string, string>();

  const files: FileEntry[] = input.assets.map((asset) => {
    const document = documentsByAsset.get(asset.assetId);
    const labels = labelsByAsset.get(asset.assetId);
    const produced: Produced[] = [];

    // The same bytes, ingested as a report. Claimed here so the import is not
    // listed a second time on its own below.
    const record = importsBySha.get(asset.hashes.sha256);
    if (record) {
      claimedImports.add(record.importId);
      produced.push(producedFromImport(record));
    }

    if (document) {
      fileIdByDocument.set(document.documentId, asset.assetId);
      produced.push({
        kind: 'purchase-document',
        documentId: document.documentId,
        role: document.role,
        roleSource: document.roleSource,
        vendorName: document.extracted.vendorName,
        documentDate: document.extracted.documentDate,
        currency: document.extracted.currency,
        total: document.extracted.total,
        needsReview: document.needsReview,
        purchaseId: purchaseByDocument.get(document.documentId),
        issuedPoNumber: issuedOrderFor(document, ordersByNumber),
        shipmentIds: document.shipmentIds,
      });
    }

    for (const shipment of summariseLabels(labels ?? [])) {
      produced.push(shipment);
    }

    return {
      id: asset.assetId,
      assetId: asset.assetId,
      importId: record?.importId,
      ...displayName(asset, document, labels),
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      uploadedAt: asset.createdAt,
      produced,
    };
  });

  // Imports whose file was never stored — everything that came through the
  // report importer, which keeps rows and no bytes.
  for (const record of input.imports) {
    if (claimedImports.has(record.importId)) continue;
    files.push({
      id: `import:${record.importId}`,
      importId: record.importId,
      fileName:
        record.fileName ??
        (record.source === 'api'
          ? `${REPORTS[record.kind]?.label ?? record.kind} (from Amazon)`
          : 'Uploaded report'),
      uploadedAt: record.createdAt,
      produced: [producedFromImport(record)],
    });
  }

  files.sort((a, b) => b.uploadedAt - a.uploadedAt);

  const documentTotals = new Map<string, StoredDocument>();
  for (const document of input.grouping.documents) {
    documentTotals.set(document.documentId, document);
  }

  const purchases: PurchaseView[] = input.grouping.purchases
    // A group of one is not a relationship. `groupPurchaseDocuments` returns a
    // group per connected component, so every lone invoice comes back as its
    // own "purchase" — listing those puts a card above the file list for every
    // document that was joined to nothing, which buries the groups that mean
    // something. The lone document still appears in the list below, with its
    // role, supplier and total.
    .filter((purchase) => purchase.documentIds.length > 1)
    .map((purchase) => {
      const documents = purchase.documentIds
        .map((id) => documentTotals.get(id))
        .filter((doc): doc is StoredDocument => Boolean(doc));

      // The invoice is what a purchase COST. A receipt proves money moved, a
      // proforma is a quote, a waybill carries freight the supplier may already
      // have billed — every one of them states a total, and summing them is the
      // double-count `PURCHASE_AUTHORITY` exists to prevent. Read from that
      // constant rather than repeating its answer here.
      const costing = documents.filter(
        (doc) => doc.role === PURCHASE_AUTHORITY.cost
      );
      const totals = costing
        .map((doc) => doc.extracted.total)
        .filter((total): total is number => typeof total === 'number');

      return {
        purchaseId: purchase.purchaseId,
        fileIds: purchase.documentIds.map(
          (id) => fileIdByDocument.get(id) ?? `document:${id}`
        ),
        vendorName: documents.find((doc) => doc.extracted.vendorName)?.extracted
          .vendorName,
        documentDate: documents
          .map((doc) => doc.extracted.documentDate)
          .filter((date): date is string => Boolean(date))
          .sort()[0],
        currency: costing[0]?.extracted.currency,
        total: totals.length
          ? totals.reduce((sum, value) => sum + value, 0)
          : undefined,
        joins: purchase.joins.map((join) => describeJoin(join)),
        confirmed: documents.some(
          (doc) => doc.confirmedPurchaseId === purchase.purchaseId
        ),
      };
    });

  const suggestions: SuggestionView[] = input.grouping.suggestions.map(
    (suggestion) => ({
      documentIds: suggestion.documentIds,
      fileIds: suggestion.documentIds.map(
        (id) => fileIdByDocument.get(id) ?? `document:${id}`
      ),
      // The grouping already writes this for a human — it is the whole reason a
      // suggestion is a suggestion rather than a join.
      reason: suggestion.reason,
    })
  );

  return { files, purchases, suggestions };
}

function producedFromImport(record: ReportImport): Produced {
  return {
    kind: 'report-rows',
    importId: record.importId,
    reportKind: record.kind,
    label: REPORTS[record.kind]?.label ?? record.kind,
    rowsNew: record.rowsNew,
    rowsParsed: record.rowsParsed,
    observedFrom: record.observedFrom,
    observedTo: record.observedTo,
    unmappedHeaders: record.unmappedHeaders,
  };
}

/**
 * One entry per shipment, not per box.
 *
 * A four-box sheet is one upload and one shipment; listing four identical rows
 * would say nothing the rollup does not, and would bury a file that produced
 * two shipments under one that produced twenty boxes of the same.
 */
function summariseLabels(
  labels: StoredBoxLabel[]
): Array<Extract<Produced, { kind: 'box-labels' }>> {
  const byShipment = new Map<string, StoredBoxLabel[]>();
  for (const label of labels) {
    const existing = byShipment.get(label.shipmentId);
    if (existing) existing.push(label);
    else byShipment.set(label.shipmentId, [label]);
  }

  return [...byShipment.entries()].map(([shipmentId, group]) => ({
    kind: 'box-labels' as const,
    shipmentId,
    boxes: group.length,
    units: group.reduce((sum, label) => sum + (label.quantity ?? 0), 0),
    destinationFc: group.find((label) => label.destinationFc)?.destinationFc,
  }));
}

/**
 * Say WHY two documents were joined, in the seller's terms.
 *
 * The grouping refuses to guess, so every join it makes rests on something
 * specific. Showing that reason is what lets a seller disagree with it — a
 * group whose only explanation is "we think so" is one nobody can correct.
 */
function describeJoin(join: PurchaseJoin): string {
  const LABELS: Record<PurchaseJoin['on'], string> = {
    'invoice-number': 'invoice number',
    'receipt-number': 'receipt number',
    'tracking-number': 'tracking number',
    'piece-id': 'piece id',
  };
  const label = LABELS[join.on] ?? join.on;
  return join.value ? `${label} ${join.value}` : label;
}

export type SellerContext = {
  sellerId?: string;
  status: DocumentCenter['sellerStatus'];
};

/**
 * Which seller account this user's rows and labels belong to, if it can be
 * determined at all.
 *
 * One helper because every caller here needs the same three-way answer, and
 * because getting it wrong is not a compile error: `resolveAmazonConnection`
 * reaches the credential service, so it throws for reasons that have nothing to
 * do with documents — an expired token, a service having a bad minute. Called
 * bare, that exception took down first the listing and then the delete. Both
 * were found by running them, not by reading them, which is the argument for
 * there being one place to get this right.
 */
export async function resolveSellerContext(
  userId: string
): Promise<SellerContext> {
  try {
    const resolved = await resolveAmazonConnection({
      apiType: 'SP_API',
      userId,
    });
    return resolved.connected
      ? { sellerId: resolved.connection.profile.seller_id, status: 'connected' }
      : { status: 'not-connected' };
  } catch {
    return { status: 'unavailable' };
  }
}

export type DeleteOutcome = {
  fileDeleted: boolean;
  documentDeleted: boolean;
  boxLabelsDeleted: number;
  reportRowsDeleted: number;
  reportImportDeleted: boolean;
};

/**
 * Delete a file and everything it produced.
 *
 * The cascade is the point. A file's rows, extracted figures and box labels are
 * the file's claim on every number the app reports, so removing the bytes and
 * leaving those behind would keep the claim while destroying the evidence for
 * it — coverage that says a window is covered, margins built on an invoice
 * nobody can open. The seller is shown what goes before they agree, from the
 * same `produced` list this deletes.
 *
 * Derived records go first and the asset goes LAST. A failure part-way then
 * leaves a file that still lists what remains, which the seller can delete
 * again; the other order would leave rows whose file is gone and which nothing
 * on the screen can reach.
 */
export async function deleteFileEntry(params: {
  userId: string;
  /** Required only for the seller-scoped stores — rows and box labels. */
  sellerId?: string;
  assetId?: string;
  importId?: string;
}): Promise<DeleteOutcome> {
  const { userId, sellerId, assetId } = params;
  const outcome: DeleteOutcome = {
    fileDeleted: false,
    documentDeleted: false,
    boxLabelsDeleted: 0,
    reportRowsDeleted: 0,
    reportImportDeleted: false,
  };

  // Resolved before anything is deleted: once the asset is gone its sha256 is
  // gone with it, and the import it was ingested as could never be found again.
  let importId = params.importId;
  if (assetId && !importId && sellerId) {
    const asset = await getAsset(assetId);
    if (asset?.userId === userId) {
      const imports = await listImports({ sellerId });
      importId = imports.find(
        (record) => record.fileSha256 === asset.hashes.sha256
      )?.importId;
    }
  }

  if (assetId) {
    outcome.documentDeleted = await deleteStoredDocument({
      userId,
      documentId: `${userId}::${assetId}`,
    });
    if (sellerId) {
      outcome.boxLabelsDeleted = await deleteBoxLabelsForAsset({
        sellerId,
        assetId,
      });
    }
  }

  if (importId && sellerId) {
    const removed = await deleteImport({ sellerId, importId });
    outcome.reportRowsDeleted = removed.rowsDeleted;
    outcome.reportImportDeleted = removed.importDeleted;
  }

  if (assetId) {
    outcome.fileDeleted = await deleteAsset(assetId, userId);
  }

  return outcome;
}

/**
 * Load the whole view for one user.
 *
 * The seller-scoped reads are skipped entirely when there is no seller, rather
 * than run and allowed to come back empty: an empty list and an unreadable one
 * look identical on screen and mean opposite things.
 *
 * Resolving the connection is allowed to FAIL without taking the page with it.
 * It calls the credential service, so it fails for reasons that have nothing to
 * do with documents — a token that needs refreshing, a service having a bad
 * minute — and losing the seller's stored files to that would be absurd. The
 * upload path already refuses to fail an import over the same call; this is the
 * same rule on the way back out.
 */
export async function loadDocumentCenter(params: {
  userId: string;
}): Promise<DocumentCenter> {
  const { userId } = params;

  const { sellerId, status: sellerStatus } = await resolveSellerContext(userId);

  const [assets, grouping, imports, boxLabels, purchaseOrders] =
    await Promise.all([
      listAssets({ userId, feature: 'documents' }),
      purchaseGrouping({ userId }),
      sellerId ? listImports({ sellerId }) : Promise.resolve([]),
      sellerId ? listBoxLabels({ sellerId }) : Promise.resolve([]),
      listPurchaseOrders({ userId }),
    ]);

  return {
    ...buildFileView({
      userId,
      assets,
      imports,
      boxLabels,
      grouping,
      purchaseOrders,
    }),
    sellerStatus,
  };
}
