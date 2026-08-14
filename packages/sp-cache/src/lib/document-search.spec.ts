/**
 * Document search.
 *
 * The failure this file exists for is not "search returns nothing". It is
 * search returning ANOTHER SELLER'S invoices: a Search index spans the whole
 * collection, a query missing its tenant clause is perfectly valid, and the
 * results look entirely plausible — someone else's vendors, someone else's
 * totals, ranked by relevance. Nothing downstream can detect it.
 *
 * So most of what follows asserts the shape of the query we send, not the
 * results we get back. The query is the part that can be wrong silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_SEARCH_INDEX,
  documentSearchIndexDefinition,
  DOCUMENT_SEARCH_FIELDS,
  documentSearchTypeKey,
  DocumentSearchError,
  EMBEDDING_DIMENSIONS,
  documentSearchText,
  documentSearchTransport,
  searchDocuments,
  suggestLinks,
} from './document-search.js';
import { collectionName } from '@amz-spapi/couchbase-utils';
import {
  DOCUMENTS_COLLECTION,
  DOCUMENTS_DOMAIN,
  type StoredDocument,
} from './document-store.js';

const vector = (length = EMBEDDING_DIMENSIONS, fill = 0.1) =>
  Array.from({ length }, () => fill);

let sent: { index: string; body: Record<string, unknown> } | undefined;

/** The request the module actually sent, failing the test if it sent none. */
function lastRequest(): { index: string; body: Record<string, unknown> } {
  if (!sent) throw new Error('No search request was sent.');
  return sent;
}

function lastBody(): Record<string, unknown> {
  return lastRequest().body;
}

function lastKnn(): Record<string, unknown> {
  const knn = lastBody()['knn'] as Array<Record<string, unknown>> | undefined;
  if (!knn?.length) throw new Error('The request carried no knn block.');
  return knn[0];
}

function knnFilter(): Record<string, unknown> {
  const filter = lastKnn()['filter'];
  if (!filter) throw new Error('The knn block carried no tenant pre-filter.');
  return filter as Record<string, unknown>;
}

function respondWith(
  hits: Array<{ id: string; score: number; fields?: Record<string, unknown> }>,
  extra: Record<string, unknown> = {}
) {
  documentSearchTransport.searchQuery = vi.fn(async (params) => {
    sent = params;
    return { hits, total: hits.length, ...extra };
  }) as typeof documentSearchTransport.searchQuery;
}

/** Every clause the request carries, flattened, so nesting is not asserted. */
function clauses(body: Record<string, unknown>): unknown[] {
  const found: unknown[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    found.push(node);
    Object.values(node as Record<string, unknown>).forEach(walk);
  };
  walk(body);
  return found;
}

const hasTenantClause = (body: Record<string, unknown>, userId: string) =>
  clauses(body).some(
    (clause) =>
      typeof clause === 'object' &&
      clause !== null &&
      (clause as Record<string, unknown>)['field'] === 'userId' &&
      (clause as Record<string, unknown>)['term'] === userId
  );

beforeEach(() => {
  sent = undefined;
  respondWith([]);
});

describe('tenant isolation', () => {
  it('scopes a keyword search to the seller', async () => {
    await searchDocuments({ userId: 'seller-a', text: 'weilong' });
    expect(hasTenantClause(lastBody(), 'seller-a')).toBe(true);
  });

  it('scopes the vector half too, not just the keyword half', async () => {
    // The one that matters most. A knn block without a pre-filter searches
    // every seller's documents and unions the winners into these results,
    // however tightly the keyword query is scoped.
    await searchDocuments({
      userId: 'seller-a',
      text: 'freight',
      vector: vector(),
    });

    expect(hasTenantClause(knnFilter(), 'seller-a')).toBe(true);
  });

  it('still scopes a vector-only search, which has no keyword query to hang it on', async () => {
    await searchDocuments({ userId: 'seller-a', vector: vector() });
    expect(hasTenantClause(lastBody(), 'seller-a')).toBe(true);
    expect(hasTenantClause(knnFilter(), 'seller-a')).toBe(true);
  });

  it('refuses to search without a user rather than searching everyone', async () => {
    await expect(
      searchDocuments({ userId: '', text: 'invoice' })
    ).rejects.toBeInstanceOf(DocumentSearchError);
    await expect(
      searchDocuments({ userId: '   ', text: 'invoice' })
    ).rejects.toBeInstanceOf(DocumentSearchError);
    expect(sent).toBeUndefined();
  });

  it('matches the user id exactly rather than through the analyser', async () => {
    // `match` would analyse the id and could share a token with another id;
    // `term` compares byte for byte.
    await searchDocuments({ userId: 'seller-a', text: 'x' });
    const tenant = clauses(lastBody()).find(
      (clause) =>
        typeof clause === 'object' &&
        clause !== null &&
        (clause as Record<string, unknown>)['field'] === 'userId'
    ) as Record<string, unknown>;
    expect(tenant['term']).toBe('seller-a');
    expect(tenant['match']).toBeUndefined();
  });
});

describe('query construction', () => {
  it('needs something to search on', async () => {
    await expect(
      searchDocuments({ userId: 'seller-a' })
    ).rejects.toBeInstanceOf(DocumentSearchError);
  });

  it('rejects a query vector of the wrong width instead of letting the service fail', async () => {
    await expect(
      searchDocuments({ userId: 'seller-a', vector: vector(768) })
    ).rejects.toThrow(/768 wide but the index holds 1536/);
  });

  it('carries role and date filters into both halves', async () => {
    await searchDocuments({
      userId: 'seller-a',
      text: 'towel',
      vector: vector(),
      roles: ['commercial-invoice'],
      from: '2026-01-01',
      to: '2026-06-30',
    });

    for (const scope of [lastBody(), knnFilter()]) {
      const all = clauses(scope);
      expect(
        all.some(
          (clause) =>
            (clause as Record<string, unknown>)['field'] === 'role' &&
            (clause as Record<string, unknown>)['term'] === 'commercial-invoice'
        )
      ).toBe(true);
      expect(
        all.some(
          (clause) =>
            (clause as Record<string, unknown>)['field'] ===
            'extracted.documentDate'
        )
      ).toBe(true);
    }
  });

  it('clamps the limit rather than letting a caller ask for everything', async () => {
    await searchDocuments({ userId: 'seller-a', text: 'x', limit: 100000 });
    expect(lastBody()['size']).toBe(200);
    await searchDocuments({ userId: 'seller-a', text: 'x', limit: 0 });
    expect(lastBody()['size']).toBe(1);
  });

  it('asks for the fields a result row needs, so rendering needs no second fetch', async () => {
    await searchDocuments({ userId: 'seller-a', text: 'x' });
    // The full paths, which is how the index names nested fields. Asking for
    // 'vendorName' returns nothing and the row renders with no supplier.
    expect(lastBody()['fields']).toContain('extracted.vendorName');
    expect(lastBody()['fields']).toContain('extracted.total');
  });
});

describe('results', () => {
  it('reads stored fields off a hit', async () => {
    respondWith([
      {
        id: 'seller-a::asset-1',
        score: 1.2,
        // Verbatim the shape Couchbase returns: nested fields come back under
        // their full path, not flattened to the name given in the mapping.
        fields: {
          'extracted.vendorName': 'Guangzhou Weilong',
          'extracted.total': 4102.04,
          'extracted.currency': 'USD',
          role: 'commercial-invoice',
        },
      },
    ]);

    const result = await searchDocuments({ userId: 'seller-a', text: 'x' });
    expect(result.hits[0]).toMatchObject({
      id: 'seller-a::asset-1',
      vendorName: 'Guangzhou Weilong',
      total: 4102.04,
    });
    expect(result.partial).toBe(false);
  });

  it('flags a partially failed search rather than passing a subset off as complete', async () => {
    // A packet built from a silently truncated search is missing the evidence
    // it needed, and says nothing about it.
    respondWith([{ id: 'seller-a::asset-1', score: 1 }], {
      errors: { partition_3: 'context deadline exceeded' },
    });

    const result = await searchDocuments({ userId: 'seller-a', text: 'x' });
    expect(result.partial).toBe(true);
  });
});

describe('suggested links', () => {
  it('excludes the document from its own neighbours', async () => {
    respondWith([
      { id: 'seller-a::self', score: 1.0 },
      { id: 'seller-a::other', score: 0.84 },
    ]);

    const links = await suggestLinks({
      userId: 'seller-a',
      documentId: 'seller-a::self',
      vector: vector(),
    });

    expect(links.map((link) => link.id)).toEqual(['seller-a::other']);
  });

  it('drops neighbours below the floor', async () => {
    respondWith([
      { id: 'seller-a::close', score: 0.9 },
      { id: 'seller-a::noise', score: 0.2 },
    ]);

    const links = await suggestLinks({
      userId: 'seller-a',
      documentId: 'seller-a::self',
      vector: vector(),
      minScore: 0.5,
    });

    expect(links.map((link) => link.id)).toEqual(['seller-a::close']);
  });

  it('returns scores, so the UI can show what it is asserting', async () => {
    // The design shows "0.91 · Link · No" — a suggestion the reviewer confirms.
    // Hiding the score would make a guess look like a fact.
    respondWith([{ id: 'seller-a::other', score: 0.91 }]);
    const [link] = await suggestLinks({
      userId: 'seller-a',
      documentId: 'seller-a::self',
      vector: vector(),
    });
    expect(link.score).toBe(0.91);
  });

  it('needs the document’s embedding', async () => {
    await expect(
      suggestLinks({
        userId: 'seller-a',
        documentId: 'seller-a::self',
        vector: [],
      })
    ).rejects.toBeInstanceOf(DocumentSearchError);
  });
});

describe('what gets embedded', () => {
  const document = {
    documentId: 'd1',
    userId: 'seller-a',
    assetId: 'asset-1',
    fileName: 'weilong-invoice-2291.pdf',
    role: 'commercial-invoice',
    roleSource: 'recognised',
    recognition: {
      kind: 'commercial-invoice',
      confidence: 0.93,
      needsUserChoice: false,
      alternatives: [],
      signals: [],
    },
    extracted: {
      vendorName: 'Guangzhou Weilong Packaging',
      invoiceNumber: 'INV-2291',
      currency: 'USD',
      total: 4102.04,
      lines: [
        { description: 'Kraft mailer 10x13, printed 2c', amount: 1760 },
        { description: 'Corrugated shipper 12x9x4', amount: 1290 },
      ],
    },
    issues: [],
    needsReview: true,
    storedAt: 0,
    updatedAt: 0,
  } as unknown as StoredDocument;

  it('includes the counterparty, the reference and the line descriptions', () => {
    const text = documentSearchText(document);
    expect(text).toContain('Guangzhou Weilong Packaging');
    expect(text).toContain('INV-2291');
    expect(text).toContain('Kraft mailer 10x13, printed 2c');
  });

  it('leaves the amounts out', () => {
    // A total is a term to match exactly, which is the keyword half's job.
    // Embedded, it is noise: "4102.04" has no semantic neighbourhood.
    expect(documentSearchText(document)).not.toContain('4102.04');
  });

  it('skips absent fields rather than emitting empty separators', () => {
    const sparse = {
      ...document,
      fileName: undefined,
      extracted: { ...document.extracted, invoiceNumber: undefined },
    } as StoredDocument;
    expect(documentSearchText(sparse)).not.toMatch(/—\s+—/);
  });
});

describe('the index definition and the queries agree', () => {
  const definition = documentSearchIndexDefinition({
    bucket: 'sell-avant',
    environmentScope: 'dev',
  });
  const mapping = definition.params.mapping.types[documentSearchTypeKey('dev')];

  it('maps the keyspace documents are actually written to', () => {
    // The other silent-empty failure. `mode: scope.collection.type_field` keys
    // this mapping by `<scope>.<collection>`, and ADR-0005 moved both halves:
    // the scope is the environment, the collection is flat. Keyed the old way
    // (`purchases.documents`) the index builds, holds zero documents, and every
    // search returns nothing — indistinguishable on screen from an empty
    // library. Asserted against `collectionName` so it cannot drift.
    expect(documentSearchTypeKey('dev')).toBe(
      `dev.${collectionName(DOCUMENTS_DOMAIN, DOCUMENTS_COLLECTION)}`
    );
    expect(mapping).toBeDefined();
  });

  it('follows the environment scope rather than hardcoding one', () => {
    const prod = documentSearchIndexDefinition({
      bucket: 'sell-avant',
      environmentScope: 'prod',
    });
    expect(
      prod.params.mapping.types[documentSearchTypeKey('prod')]
    ).toBeDefined();
    // ...and does NOT still carry dev's key, which would index the wrong scope.
    expect(
      prod.params.mapping.types[documentSearchTypeKey('dev')]
    ).toBeUndefined();
  });

  it('names the bucket it reads from', () => {
    // Without sourceName the Search service has no source to index.
    expect(definition.sourceName).toBe('sell-avant');
  });

  it('indexes userId, or every search silently returns nothing', () => {
    // The quiet failure: `tenantClause` matches an unindexed field, finds
    // nothing, and the Library reads as "no documents" rather than as broken.
    expect(mapping.properties.userId.fields[0].name).toBe('userId');
    expect(mapping.properties.userId.fields[0].index).toBe(true);
  });

  it('compares userId as one token', () => {
    expect(mapping.properties.userId.fields[0].analyzer).toBe('keyword');
  });

  it('declares the same vector width the query builder enforces', () => {
    expect(mapping.properties.embedding.fields[0].dims).toBe(
      EMBEDDING_DIMENSIONS
    );
  });

  it('stores every field a result row reads', () => {
    const stored = new Set<string>();
    const collect = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record['store'] === true && typeof record['name'] === 'string') {
        stored.add(record['name']);
      }
      Object.values(record).forEach(collect);
    };
    collect(mapping);

    for (const field of ['vendorName', 'documentDate', 'total', 'currency']) {
      expect(stored).toContain(field);
    }
  });

  it('addresses nested fields by their full path, as the index names them', () => {
    // The defect this pins. A child field under an object mapping is addressed
    // as `extracted.vendorName`; the `name` in the mapping does not flatten it.
    // Queried as `vendorName` it matches nothing and returns empty rather than
    // erroring — and the vector half keeps returning documents, so the search
    // looks like it works while the keyword half is dead.
    expect(DOCUMENT_SEARCH_FIELDS.vendorName).toBe('extracted.vendorName');
    expect(DOCUMENT_SEARCH_FIELDS.documentDate).toBe('extracted.documentDate');
    expect(DOCUMENT_SEARCH_FIELDS.total).toBe('extracted.total');
    expect(DOCUMENT_SEARCH_FIELDS.currency).toBe('extracted.currency');
    // Top-level fields stay unprefixed.
    expect(DOCUMENT_SEARCH_FIELDS.userId).toBe('userId');
    expect(DOCUMENT_SEARCH_FIELDS.searchText).toBe('searchText');
  });

  it('every field the queries name is one the index defines', () => {
    // Walks the mapping and rebuilds the addressable names, so a field renamed
    // or moved under `extracted` fails here rather than in production silence.
    const addressable = new Set<string>();
    const walk = (
      properties: Record<string, unknown>,
      prefix: string
    ): void => {
      for (const [key, value] of Object.entries(properties)) {
        const node = value as {
          fields?: Array<{ name?: string }>;
          properties?: Record<string, unknown>;
        };
        for (const field of node.fields ?? []) {
          if (field.name) addressable.add(`${prefix}${field.name}`);
        }
        if (node.properties) walk(node.properties, `${prefix}${key}.`);
      }
    };
    walk(mapping.properties as Record<string, unknown>, '');

    for (const name of Object.values(DOCUMENT_SEARCH_FIELDS)) {
      expect(addressable).toContain(name);
    }
  });

  it('puts the free-text fields in _all, or unfielded search finds nothing', () => {
    // `searchDocuments` sends a query_string with no field, which searches the
    // composite `_all` field. A field only joins `_all` when it says so, and
    // omitting it is silent: keyword search matches nothing while the vector
    // half still answers.
    const inAll = new Set<string>();
    const collect = (node: unknown, prefix: string): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as {
        fields?: Array<{ name?: string; include_in_all?: boolean }>;
        properties?: Record<string, unknown>;
      };
      for (const field of record.fields ?? []) {
        if (field.include_in_all && field.name) inAll.add(field.name);
      }
      for (const [key, value] of Object.entries(record.properties ?? {})) {
        collect(value, `${prefix}${key}.`);
      }
    };
    collect(mapping, '');

    expect(inAll).toContain('searchText');
    expect(inAll).toContain('vendorName');
    expect(inAll).toContain('fileName');
  });

  it('is named the same as the index the queries hit', () => {
    expect(definition.name).toBe(DOCUMENT_SEARCH_INDEX);
  });
});

describe('facets', () => {
  it('asks for role and period facets with generated month ranges', async () => {
    await searchDocuments({ userId: 'seller-a', text: 'coffee' });

    const facets = (sent?.body as Record<string, unknown>)['facets'] as Record<
      string,
      { field: string; date_ranges?: Array<{ name: string }> }
    >;
    expect(facets['role'].field).toBe('role');
    expect(facets['period'].field).toBe('extracted.documentDate');
    // Six months plus the open-started "older" bucket. Names are the months
    // themselves, so the chips need no translation table.
    expect(facets['period'].date_ranges).toHaveLength(7);
    expect(
      facets['period'].date_ranges?.every(
        (range) => /^\d{4}-\d{2}$/.test(range.name) || range.name === 'older'
      )
    ).toBe(true);
  });

  it('normalises service facets into roles and periods, zero-count buckets dropped', async () => {
    respondWith([], {
      facets: {
        role: {
          field: 'role',
          total: 8,
          missing: 0,
          other: 0,
          terms: [
            { term: 'commercial-invoice', count: 6 },
            { term: 'purchase-order', count: 2 },
            { term: 'receipt', count: 0 },
          ],
        },
        period: {
          field: 'extracted.documentDate',
          total: 8,
          missing: 3,
          other: 0,
          date_ranges: [
            {
              name: '2026-07',
              start: '2026-07-01T00:00:00.000Z',
              end: '2026-08-01T00:00:00.000Z',
              count: 4,
            },
            { name: '2026-06', count: 0 },
            {
              name: '2026-05',
              start: '2026-05-01T00:00:00.000Z',
              end: '2026-06-01T00:00:00.000Z',
              count: 1,
            },
          ],
        },
      },
    });

    const result = await searchDocuments({
      userId: 'seller-a',
      text: 'coffee',
    });
    expect(result.facets).toEqual({
      roles: [
        { role: 'commercial-invoice', count: 6 },
        { role: 'purchase-order', count: 2 },
      ],
      periods: [
        { label: '2026-07', from: '2026-07-01', to: '2026-08-01', count: 4 },
        { label: '2026-05', from: '2026-05-01', to: '2026-06-01', count: 1 },
      ],
    });
  });

  it('a response without facets stays without facets — absent, not empty', async () => {
    const result = await searchDocuments({
      userId: 'seller-a',
      text: 'coffee',
    });
    // "The service answered no facets" and "nothing matched any bucket" are
    // different statements; only the second may render an empty chip row.
    expect(result.facets).toBeUndefined();
    expect('facets' in result).toBe(false);
  });
});
