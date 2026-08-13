import { collectionName, searchQuery } from '@amz-spapi/couchbase-utils';
import {
  DOCUMENTS_COLLECTION,
  DOCUMENTS_DOMAIN,
  type StoredDocument,
} from './document-store.js';

/**
 * Finding a document by what it says, and finding the documents that belong
 * beside it.
 *
 * Two searches over one Search index: keyword (FTS) for "the Weilong invoice
 * with the freight line", and vector for "papers about the same shipment as
 * this one", which is the query behind the suggested links a reviewer confirms.
 * Couchbase answers both from the same index and the same request, so they are
 * one call here rather than two systems to keep in step.
 *
 * EVERY query in this module is scoped to one seller, and that is enforced
 * here rather than left to callers. A Search index spans the whole collection:
 * a query missing its `userId` clause does not error, it returns another
 * seller's invoices, with their vendors and their totals, ranked by relevance.
 * `userId` is therefore a required argument on every exported function and is
 * conjoined into both the keyword query and the vector pre-filter — never one
 * or the other, because a `knn` block without a filter searches the whole
 * corpus however tightly the keyword half is scoped.
 */

/** Seam for tests, matching `documentStorage` in the store. */
export const documentSearchTransport = { searchQuery };

/** Search index name, scoped to the bucket and environment scope. */
export const DOCUMENT_SEARCH_INDEX = 'documents_search';

/**
 * Width of the stored vectors, and of the index that holds them.
 *
 * Must equal the output width of the model in `ai-provider`'s
 * `DEFAULT_EMBEDDING_MODEL`. A mismatch is not a degradation — the Search
 * service rejects the query — so the two are asserted equal in tests rather
 * than left to agree by memory.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export class DocumentSearchError extends Error {}

/**
 * What each field is called INSIDE the Search index.
 *
 * Not cosmetic, and not guessable. A child field under an object mapping is
 * addressed by its full path — `extracted.vendorName`, never `vendorName` —
 * and the `name` given in the mapping does not flatten it. Every way of getting
 * this wrong is silent:
 *
 *  - a query on `vendorName` matches nothing and returns an empty result, not
 *    an error;
 *  - a `documentDate` range filter matches nothing, so adding a date range
 *    makes every search return zero and reads as "no documents in that period";
 *  - asking for `total` in `fields` returns it as absent, so a result row
 *    renders with no supplier and no amount.
 *
 * All three were live: the vector half still returned documents, so the search
 * looked like it worked while the keyword half matched nothing at all. The
 * query builder, the stored-field request and the result reader now all read
 * from here, and the index definition below is built from the same names.
 */
const FIELD = {
  userId: 'userId',
  role: 'role',
  fileName: 'fileName',
  searchText: 'searchText',
  embedding: 'embedding',
  vendorName: 'extracted.vendorName',
  documentDate: 'extracted.documentDate',
  invoiceNumber: 'extracted.invoiceNumber',
  trackingNumber: 'extracted.trackingNumber',
  total: 'extracted.total',
  currency: 'extracted.currency',
} as const;

/** Exported so tests can assert the queries and the index agree. */
export const DOCUMENT_SEARCH_FIELDS = FIELD;

// ---------------------------------------------------------------------------
// What gets indexed
// ---------------------------------------------------------------------------

/**
 * The text that stands for a document in search.
 *
 * Not the raw page text. A scanned invoice is mostly boilerplate — addresses,
 * bank details, terms — and embedding that buries the two facts a seller
 * actually searches on (who it was from, what was on it) under a page of
 * letterhead every supplier shares. So this is the extracted meaning:
 * counterparty, references, and the line descriptions that distinguish one
 * shipment from another.
 *
 * Numbers are deliberately left out of the embedded text. "4,102.04" carries no
 * semantic neighbourhood — it is a term to MATCH exactly, which is the keyword
 * half's job, and including it only adds noise to the vector.
 */
export function documentSearchText(
  /**
   * A structural subset, not the whole stored record, so this can be computed
   * BEFORE the document is written. Embedding after the write would mean
   * storing every document twice, and leaving a window in which a document
   * exists but is unsearchable.
   */
  document: Pick<
    StoredDocument,
    'role' | 'recognition' | 'extracted' | 'fileName'
  >
): string {
  const extracted = document.extracted;
  const parts = [
    document.role,
    document.recognition.kind,
    extracted.vendorName,
    extracted.carrier,
    extracted.shipperName,
    extracted.receiverName,
    extracted.contentsDescription,
    extracted.deliveryLocation,
    extracted.invoiceNumber,
    extracted.receiptNumber,
    extracted.trackingNumber,
    document.fileName,
    ...(extracted.lines ?? []).map((line) => line.description),
  ];
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' — ');
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * The clause that keeps one seller's search inside their own documents.
 *
 * A term query on the exact id, not a match query: `match` runs the analyser,
 * and an analysed user id can share a token with another user id. `term` is
 * compared byte for byte.
 */
function tenantClause(userId: string): Record<string, unknown> {
  return { field: FIELD.userId, term: userId };
}

function requireUser(userId: string | undefined): string {
  if (!userId || !userId.trim()) {
    throw new DocumentSearchError(
      'A document search needs a user. Searching every seller at once is not ' +
        'a supported query.'
    );
  }
  return userId;
}

export type DocumentSearchFilters = {
  /** Roles to include. Empty or absent means every role. */
  roles?: string[];
  /** Inclusive ISO bounds on the document's own date, not its upload time. */
  from?: string;
  to?: string;
};

function filterClauses(filters: DocumentSearchFilters): unknown[] {
  const clauses: unknown[] = [];
  if (filters.roles?.length) {
    clauses.push({
      disjuncts: filters.roles.map((role) => ({
        field: FIELD.role,
        term: role,
      })),
    });
  }
  if (filters.from || filters.to) {
    clauses.push({
      field: FIELD.documentDate,
      ...(filters.from ? { start: filters.from, inclusive_start: true } : {}),
      ...(filters.to ? { end: filters.to, inclusive_end: true } : {}),
    });
  }
  return clauses;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type DocumentSearchHit = {
  /** Storage key, `${userId}::${assetId}`. */
  id: string;
  score: number;
  /** Stored index fields, enough to render a row without fetching the document. */
  fileName?: string;
  role?: string;
  vendorName?: string;
  documentDate?: string;
  total?: number;
  currency?: string;
};

/**
 * Facets over the WHOLE match set, not the page of hits returned.
 *
 * This is what the Search service's facets are for: "8 shown of 41" can still
 * say "29 are invoices, 12 are receipts" without fetching them. In a hybrid
 * request the service computes facets over the KEYWORD half only — the vector
 * half's matches are not counted — which is the honest reading for a filter
 * UI, since the chips then filter exactly what they counted.
 */
export type DocumentSearchFacets = {
  roles: Array<{ role: string; count: number }>;
  periods: Array<{ label: string; from?: string; to?: string; count: number }>;
};

export type DocumentSearchResult = {
  hits: DocumentSearchHit[];
  total: number;
  /**
   * True when some index partition failed and these hits are a subset.
   *
   * Surfaced rather than swallowed: a partial result presented as complete is
   * how a reimbursement packet ends up missing the one document that proved
   * the claim.
   */
  partial: boolean;
  /** Absent when the service answered without facets (older index, error). */
  facets?: DocumentSearchFacets;
};

/**
 * The period facet's month buckets: the current month, five before it, and
 * one open-started "older". FTS date-range facets take explicit named ranges
 * — there is no auto-bucketing — so the ranges are generated here from the
 * clock. `start` is inclusive, `end` exclusive, matching the service.
 */
export function periodFacetRanges(
  now = new Date()
): Array<{ name: string; start?: string; end?: string }> {
  const monthStart = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const ranges: Array<{ name: string; start?: string; end?: string }> = [];
  for (let offset = 0; offset < 6; offset++) {
    const start = monthStart(offset);
    ranges.push({
      name: start.toISOString().slice(0, 7),
      start: start.toISOString(),
      end: monthStart(offset - 1).toISOString(),
    });
  }
  ranges.push({ name: 'older', end: monthStart(5).toISOString() });
  return ranges;
}

function normaliseFacets(
  facets:
    | Record<
        string,
        {
          terms?: Array<{ term: string; count: number }>;
          date_ranges?: Array<{
            name: string;
            start?: string;
            end?: string;
            count: number;
          }>;
        }
      >
    | undefined
): DocumentSearchFacets | undefined {
  if (!facets) return undefined;
  return {
    roles: (facets['role']?.terms ?? [])
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((entry) => ({ role: entry.term, count: entry.count })),
    periods: (facets['period']?.date_ranges ?? [])
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.name.localeCompare(a.name))
      .map((entry) => ({
        label: entry.name,
        from: entry.start?.slice(0, 10),
        to: entry.end?.slice(0, 10),
        count: entry.count,
      })),
  };
}

function toHit(hit: {
  id: string;
  score: number;
  fields?: Record<string, unknown>;
}): DocumentSearchHit {
  const fields = hit.fields ?? {};
  const text = (key: string): string | undefined =>
    typeof fields[key] === 'string' ? (fields[key] as string) : undefined;
  const num = (key: string): number | undefined =>
    typeof fields[key] === 'number' ? (fields[key] as number) : undefined;
  return {
    id: hit.id,
    score: hit.score,
    ...(text(FIELD.fileName) ? { fileName: text(FIELD.fileName) } : {}),
    ...(text(FIELD.role) ? { role: text(FIELD.role) } : {}),
    ...(text(FIELD.vendorName) ? { vendorName: text(FIELD.vendorName) } : {}),
    ...(text(FIELD.documentDate)
      ? { documentDate: text(FIELD.documentDate) }
      : {}),
    ...(num(FIELD.total) !== undefined ? { total: num(FIELD.total) } : {}),
    ...(text(FIELD.currency) ? { currency: text(FIELD.currency) } : {}),
  };
}

const STORED_FIELDS = [
  FIELD.fileName,
  FIELD.role,
  FIELD.vendorName,
  FIELD.documentDate,
  FIELD.total,
  FIELD.currency,
];

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchDocumentsParams = DocumentSearchFilters & {
  userId: string;
  /** Words the seller typed. Optional when searching purely by vector. */
  text?: string;
  /**
   * Embedding of the seller's query, for the semantic half. Optional: callers
   * without an embedding model still get keyword search rather than an error.
   */
  vector?: number[];
  limit?: number;
};

/**
 * Search one seller's documents by keyword, by meaning, or by both.
 *
 * Hybrid is the default worth having. Keyword alone misses "the packaging
 * supplier in Guangzhou" when the invoice says "Weilong"; vector alone is bad
 * at exact tokens — invoice numbers, tracking ids, SKUs — which is most of what
 * a seller actually types into a document search. Couchbase unions the two, so
 * an exact reference still wins on its own term while a described document is
 * still found.
 */
export async function searchDocuments(
  params: SearchDocumentsParams
): Promise<DocumentSearchResult> {
  const userId = requireUser(params.userId);
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 200);
  const filters = filterClauses(params);
  const trimmed = params.text?.trim();

  if (!trimmed && !params.vector?.length) {
    throw new DocumentSearchError(
      'A document search needs either text or a vector.'
    );
  }

  if (params.vector && params.vector.length !== EMBEDDING_DIMENSIONS) {
    throw new DocumentSearchError(
      `Query vector is ${params.vector.length} wide but the index holds ` +
        `${EMBEDDING_DIMENSIONS}. This means the embedding model changed ` +
        `without the index being rebuilt.`
    );
  }

  const scoped = [tenantClause(userId), ...filters];

  const body: Record<string, unknown> = {
    size: limit,
    fields: STORED_FIELDS,
    // Facets count the WHOLE match set (already tenant-scoped by the
    // conjuncts below), so the palette can offer "29 invoices · 12 receipts"
    // while showing eight hits. Named with the same identifiers the queries
    // use — the FIELD map is the single vocabulary for this index.
    facets: {
      role: { field: FIELD.role, size: 12 },
      period: {
        field: FIELD.documentDate,
        size: 8,
        date_ranges: periodFacetRanges(),
      },
    },
  };

  if (trimmed) {
    body['query'] = {
      conjuncts: [
        ...scoped,
        // `query_string` so a seller can still type an exact phrase or a
        // field:value, without us reimplementing a query language.
        { query: trimmed },
      ],
    };
  } else {
    // Vector-only: the query half still has to exist, or the tenant clause has
    // nowhere to live and the search runs unscoped.
    body['query'] = { conjuncts: scoped };
  }

  if (params.vector?.length) {
    body['knn'] = [
      {
        field: FIELD.embedding,
        vector: params.vector,
        k: limit,
        // The pre-filter is not optional. Without it the vector half searches
        // every seller's documents and unions the winners into these results,
        // however well-scoped the keyword half is.
        filter: { conjuncts: scoped },
      },
    ];
  }

  const response = await documentSearchTransport.searchQuery({
    index: DOCUMENT_SEARCH_INDEX,
    body,
  });

  const facets = normaliseFacets(response.facets);
  return {
    hits: response.hits.map(toHit),
    total: response.total,
    partial: Boolean(response.errors && Object.keys(response.errors).length),
    ...(facets ? { facets } : {}),
  };
}

// ---------------------------------------------------------------------------
// Suggested links
// ---------------------------------------------------------------------------

export type SuggestedLink = DocumentSearchHit & {
  /** Cosine-ish relevance, as the Search service scored it. */
  score: number;
};

/**
 * Documents that read as though they belong with this one.
 *
 * This is a SUGGESTION and the type says so: nothing here is a link until a
 * human confirms it. A 0.84 similarity between an invoice and a waybill is
 * evidence they concern the same shipment; it is not proof, and a freight cost
 * allocated onto the wrong goods on the strength of a cosine score is a wrong
 * number that no later check catches. Callers must persist confirmation
 * separately — a suggestion that writes itself into the record is the failure
 * this shape exists to prevent.
 *
 * The document itself is excluded from its own results, since it is by
 * definition its own nearest neighbour.
 */
export async function suggestLinks(params: {
  userId: string;
  /** Storage key of the document being reviewed, excluded from the results. */
  documentId: string;
  /** That document's stored embedding. */
  vector: number[];
  limit?: number;
  /** Below this the neighbours are noise rather than candidates. */
  minScore?: number;
}): Promise<SuggestedLink[]> {
  const userId = requireUser(params.userId);
  if (!params.vector?.length) {
    throw new DocumentSearchError(
      'Suggesting links needs the document’s embedding.'
    );
  }

  const limit = Math.min(Math.max(params.limit ?? 5, 1), 50);
  const minScore = params.minScore ?? 0;

  // Ask for one extra: the document itself will be the top hit and is dropped.
  const result = await searchDocuments({
    userId,
    vector: params.vector,
    limit: limit + 1,
  });

  return result.hits
    .filter((hit) => hit.id !== params.documentId && hit.score >= minScore)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Index definition
// ---------------------------------------------------------------------------

/**
 * The Search index, as code.
 *
 * Kept here rather than clicked together in the Capella UI so that the fields
 * the queries above depend on — `userId` above all — cannot quietly not exist.
 * An index missing `userId` does not fail: `tenantClause` matches nothing, and
 * every search returns empty, which reads as "no documents" rather than as a
 * broken index. Tests assert the two agree.
 *
 * Provision with:
 *   PUT /_p/fts/api/bucket/{bucket}/scope/{scope}/index/documents_search
 */
/**
 * The keyspace this index reads, as the Search service names it.
 *
 * `mode: 'scope.collection.type_field'` keys every type mapping by
 * `<scope>.<collection>`, and BOTH halves moved under ADR-0005: the scope is
 * now the environment (`dev`, `staging`, `prod`) and the collection is flat
 * (`purchases_documents`). Written as `purchases.documents` — the pre-ADR
 * shape — the mapping matches no document at all, the index builds happily
 * with zero documents, and every search returns nothing. That reads on screen
 * as "you have no documents", which is the same silent-empty failure the
 * tenant clause is guarded against, arriving by a different door.
 *
 * Derived rather than written down, so it cannot drift from `collectionName`.
 */
export function documentSearchTypeKey(environmentScope: string): string {
  return `${environmentScope}.${collectionName(
    DOCUMENTS_DOMAIN,
    DOCUMENTS_COLLECTION
  )}`;
}

/**
 * The index definition for one environment.
 *
 * A function of the bucket and scope rather than a constant, because both
 * appear inside it: `sourceName` is the bucket, and the type mapping is keyed
 * by the scope. A constant could only have been right for one environment, and
 * would have been wrong everywhere else in a way nothing reports.
 */
export function documentSearchIndexDefinition(params: {
  bucket: string;
  environmentScope: string;
}) {
  return {
    name: DOCUMENT_SEARCH_INDEX,
    type: 'fulltext-index',
    sourceType: 'gocbcore',
    sourceName: params.bucket,
    params: {
      doc_config: {
        mode: 'scope.collection.type_field',
        type_field: 'type',
      },
      mapping: {
        default_analyzer: 'standard',
        default_mapping: { enabled: false, dynamic: false },
        types: {
          [documentSearchTypeKey(params.environmentScope)]: {
            enabled: true,
            dynamic: false,
            properties: {
              // Scoping. `keyword` so the id is one token and compares exactly.
              userId: {
                enabled: true,
                fields: [
                  {
                    name: 'userId',
                    type: 'text',
                    analyzer: 'keyword',
                    index: true,
                    docvalues: true,
                  },
                ],
              },
              role: {
                enabled: true,
                fields: [
                  {
                    name: 'role',
                    type: 'text',
                    analyzer: 'keyword',
                    index: true,
                    store: true,
                    docvalues: true,
                  },
                ],
              },
              fileName: {
                enabled: true,
                fields: [
                  {
                    name: 'fileName',
                    type: 'text',
                    index: true,
                    store: true,
                    include_in_all: true,
                  },
                ],
              },
              // The embedded meaning of the document, and the vector beside it.
              searchText: {
                enabled: true,
                fields: [
                  {
                    name: 'searchText',
                    type: 'text',
                    index: true,
                    // The one that matters most: this field carries the whole
                    // document's meaning — vendor, references, line
                    // descriptions — so an unfielded keyword search that
                    // excludes it is searching almost nothing.
                    include_in_all: true,
                  },
                ],
              },
              embedding: {
                enabled: true,
                fields: [
                  {
                    name: 'embedding',
                    type: 'vector',
                    index: true,
                    dims: EMBEDDING_DIMENSIONS,
                    similarity: 'dot_product',
                    vector_index_optimized_for: 'recall',
                  },
                ],
              },
              extracted: {
                enabled: true,
                dynamic: false,
                properties: {
                  vendorName: {
                    enabled: true,
                    fields: [
                      {
                        name: 'vendorName',
                        type: 'text',
                        index: true,
                        store: true,
                        include_in_all: true,
                      },
                    ],
                  },
                  documentDate: {
                    enabled: true,
                    fields: [
                      {
                        name: 'documentDate',
                        type: 'datetime',
                        index: true,
                        store: true,
                        docvalues: true,
                      },
                    ],
                  },
                  invoiceNumber: {
                    enabled: true,
                    fields: [
                      {
                        name: 'invoiceNumber',
                        type: 'text',
                        analyzer: 'keyword',
                        index: true,
                        include_in_all: true,
                      },
                    ],
                  },
                  trackingNumber: {
                    enabled: true,
                    fields: [
                      {
                        name: 'trackingNumber',
                        type: 'text',
                        analyzer: 'keyword',
                        index: true,
                        include_in_all: true,
                      },
                    ],
                  },
                  total: {
                    enabled: true,
                    fields: [
                      {
                        name: 'total',
                        type: 'number',
                        index: true,
                        store: true,
                        docvalues: true,
                      },
                    ],
                  },
                  currency: {
                    enabled: true,
                    fields: [
                      {
                        name: 'currency',
                        type: 'text',
                        analyzer: 'keyword',
                        index: true,
                        store: true,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  } as const;
}
