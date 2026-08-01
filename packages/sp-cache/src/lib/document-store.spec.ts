import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedDocument } from '@farvisionllc/models';
import {
  confirmPurchase,
  documentStorage,
  getStoredDocument,
  listDocuments,
  purchaseGrouping,
  roleForRecognisedKind,
  setDocumentRole,
  storeExtractedDocument,
  type StoredDocument,
} from './document-store.js';

/**
 * The parts with judgement in them: which role a recognised kind implies, what
 * survives a re-import, and how a human's grouping answer merges with the joins
 * the code could make on its own. The Couchbase calls are a seam, so none of
 * this needs a cluster.
 */

const stored = new Map<string, StoredDocument>();

function extracted(overrides: Partial<ExtractedDocument> = {}) {
  return {
    documentType: 'invoice' as const,
    vendorName: 'Shenzhen Widgets',
    documentDate: '2026-03-04',
    currency: 'USD',
    total: 1200,
    lines: [
      {
        description: 'Widget',
        kind: 'goods' as const,
        quantity: 100,
        amount: 1200,
      },
    ],
    ...overrides,
  } as ExtractedDocument;
}

const recognition = {
  kind: 'commercial-invoice' as const,
  confidence: 0.9,
  needsUserChoice: false,
  alternatives: [],
  signals: ['says "commercial invoice"'],
};

function store(
  params: Partial<Parameters<typeof storeExtractedDocument>[0]> = {}
) {
  return storeExtractedDocument({
    userId: 'auth0|seller',
    assetId: 'asset-1',
    fileName: 'invoice.pdf',
    recognition,
    extracted: extracted(),
    issues: [],
    needsReview: false,
    ...params,
  });
}

beforeEach(() => {
  stored.clear();
  vi.spyOn(documentStorage, 'upsertDocument').mockImplementation(
    async (_scope, _collection, key, value) => {
      stored.set(key as string, value as StoredDocument);
      return true as never;
    }
  );
  vi.spyOn(documentStorage, 'getDocument').mockImplementation(
    async (_scope, _collection, key) =>
      (stored.get(key as string) ?? null) as never
  );
  vi.spyOn(documentStorage, 'executeQuery').mockImplementation(
    async () => ({ rows: [...stored.values()] } as never)
  );
});

describe('roleForRecognisedKind', () => {
  it('files a receipt as a payment record, not as cost', () => {
    // PURCHASE_AUTHORITY says payment is never the authority on what the goods
    // cost. A receipt proves money moved; the invoice says what was bought.
    expect(roleForRecognisedKind('receipt')).toBe('payment-record');
  });

  it('keeps a waybill a transport document, so freight is not counted as cost', () => {
    expect(roleForRecognisedKind('transport-document')).toBe(
      'transport-document'
    );
  });

  it('returns null for files that are not part of a purchase', () => {
    // Kept by the seller, but they have no place in a purchase — grouping one
    // in would put a box label's weight into a freight allocation.
    for (const kind of [
      'fba-box-label',
      'fnsku-label',
      'design-artwork',
      'amazon-report',
      'unknown',
    ] as const) {
      expect(roleForRecognisedKind(kind)).toBeNull();
    }
  });
});

describe('storeExtractedDocument', () => {
  it('is idempotent on re-upload, because identity is the deduped asset', async () => {
    await store();
    await store();

    expect(stored.size).toBe(1);
  });

  it('keeps the original storedAt but moves updatedAt', async () => {
    const first = await store();
    const second = await store();

    expect(second.storedAt).toBe(first.storedAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.storedAt);
  });

  it('refuses a document with no asset, which would have no provenance', async () => {
    await expect(store({ assetId: '' })).rejects.toThrow(/asset/i);
  });

  it('derives the role from recognition when nobody has said otherwise', async () => {
    const doc = await store();

    expect(doc.role).toBe('commercial-invoice');
    expect(doc.roleSource).toBe('recognised');
  });

  it('falls back to "other" for a file the recogniser gives no purchase role', async () => {
    const doc = await store({
      recognition: { ...recognition, kind: 'design-artwork' },
    });

    expect(doc.role).toBe('other');
  });

  it('does not let a re-import overwrite a role a human corrected', async () => {
    // The regression this exists to stop: someone refiles a misread waybill,
    // then uploads the same PDF again and silently gets the wrong guess back.
    await store();
    await setDocumentRole({
      userId: 'auth0|seller',
      documentId: 'auth0|seller::asset-1',
      role: 'transport-document',
    });

    const reimported = await store();

    expect(reimported.role).toBe('transport-document');
    expect(reimported.roleSource).toBe('user');
  });

  it('keeps a confirmed grouping across a re-import', async () => {
    await store();
    await store({ assetId: 'asset-2' });
    await confirmPurchase({
      userId: 'auth0|seller',
      documentIds: ['auth0|seller::asset-1', 'auth0|seller::asset-2'],
    });

    const reimported = await store();

    // Re-reading the file says nothing about its relationship to another file.
    expect(reimported.confirmedPurchaseId).toBe('auth0|seller::asset-1');
  });
});

describe('getStoredDocument', () => {
  it('refuses to return another seller’s document', async () => {
    await store();

    expect(
      await getStoredDocument('auth0|someone-else', 'auth0|seller::asset-1')
    ).toBeNull();
  });
});

describe('setDocumentRole', () => {
  it('marks the correction as the user’s', async () => {
    await store();

    const updated = await setDocumentRole({
      userId: 'auth0|seller',
      documentId: 'auth0|seller::asset-1',
      role: 'freight-invoice',
    });

    expect(updated.role).toBe('freight-invoice');
    expect(updated.roleSource).toBe('user');
  });

  it('refuses on a document the user does not own', async () => {
    await store();

    await expect(
      setDocumentRole({
        userId: 'auth0|someone-else',
        documentId: 'auth0|seller::asset-1',
        role: 'other',
      })
    ).rejects.toThrow(/No document/);
  });
});

describe('confirmPurchase', () => {
  it('needs at least two documents to be a grouping at all', async () => {
    await expect(
      confirmPurchase({ userId: 'auth0|seller', documentIds: ['one'] })
    ).rejects.toThrow(/at least two/);
  });

  it('names the purchase after the lowest id, as derived groups are', async () => {
    await store();
    await store({ assetId: 'asset-2' });

    const [first, second] = await confirmPurchase({
      userId: 'auth0|seller',
      documentIds: ['auth0|seller::asset-2', 'auth0|seller::asset-1'],
    });

    expect(first.confirmedPurchaseId).toBe('auth0|seller::asset-1');
    expect(second.confirmedPurchaseId).toBe('auth0|seller::asset-1');
  });
});

describe('purchaseGrouping', () => {
  it('joins on a shared invoice number without being asked', async () => {
    await store({
      assetId: 'asset-1',
      extracted: extracted({ invoiceNumber: 'INV-9' }),
    });
    await store({
      assetId: 'asset-2',
      recognition: { ...recognition, kind: 'receipt' },
      extracted: extracted({ invoiceNumber: 'INV-9', documentType: 'receipt' }),
    });

    const grouping = await purchaseGrouping({ userId: 'auth0|seller' });

    expect(grouping.purchases).toHaveLength(1);
    expect(grouping.purchases[0].documentIds).toHaveLength(2);
  });

  it('merges separate derived groups once a human confirms across them', async () => {
    // Nothing joins these: different vendors, no shared identifier.
    await store({
      assetId: 'asset-1',
      extracted: extracted({ vendorName: 'A' }),
    });
    await store({
      assetId: 'asset-2',
      extracted: extracted({ vendorName: 'B' }),
    });

    const before = await purchaseGrouping({ userId: 'auth0|seller' });
    expect(before.purchases).toHaveLength(2);

    await confirmPurchase({
      userId: 'auth0|seller',
      documentIds: ['auth0|seller::asset-1', 'auth0|seller::asset-2'],
    });

    const after = await purchaseGrouping({ userId: 'auth0|seller' });
    expect(after.purchases).toHaveLength(1);
    expect(after.purchases[0].documentIds).toEqual([
      'auth0|seller::asset-1',
      'auth0|seller::asset-2',
    ]);
  });

  it('returns the documents alongside, so a caller need not fetch twice', async () => {
    await store();

    const grouping = await purchaseGrouping({ userId: 'auth0|seller' });

    expect(grouping.documents).toHaveLength(1);
  });
});

describe('listDocuments', () => {
  it('refuses without a user, which would list everyone’s evidence', async () => {
    await expect(listDocuments({ userId: '' })).rejects.toThrow(/user/i);
  });
});
