import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the agent is allowed to do with a document.
 *
 * The rule these defend is #73's: reading answers a question, filing is a
 * separate decision. Getting it wrong is asymmetric — silently filing someone's
 * personal receipt into the business record is worse than one extra question —
 * so "read does not persist" is pinned rather than assumed.
 */

const loadAssetBytes = vi.fn();
const getAsset = vi.fn();
const extractDocument = vi.fn();
const extractPdfText = vi.fn();
const storeExtractedDocument = vi.fn();
const listDocuments = vi.fn();
const getStoredDocument = vi.fn();
const setDocumentRole = vi.fn();

const recognizeDocument = vi.fn();

// The recogniser has its own tests; mocking it keeps these about what
// document-ops does with a verdict rather than about how one is reached.
vi.mock('@farvisionllc/models', () => ({ recognizeDocument }));
vi.mock('./media-assets', () => ({ loadAssetBytes, getAsset }));
vi.mock('./document-extraction', () => ({ extractDocument }));
vi.mock('./pdf-text', () => ({ extractPdfText }));
vi.mock('@amz-spapi/sp-cache', () => ({
  storeExtractedDocument,
  listDocuments,
  getStoredDocument,
  setDocumentRole,
  roleForRecognisedKind: (kind: string) =>
    kind === 'commercial-invoice'
      ? 'commercial-invoice'
      : kind === 'receipt'
      ? 'payment-record'
      : null,
}));

const INVOICE_TEXT = 'COMMERCIAL INVOICE\nShenzhen Widgets\nTotal 1200 USD';

const document = {
  documentType: 'invoice',
  vendorName: 'Shenzhen Widgets',
  documentDate: '2026-03-04',
  currency: 'USD',
  total: 1200,
  lines: [
    { description: 'Widget', kind: 'goods', quantity: 100, amount: 1200 },
  ],
};

async function ops() {
  const { createDocumentOps } = await import('./document-ops');
  return createDocumentOps({ userId: 'auth0|seller' });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  loadAssetBytes.mockResolvedValue({
    bytes: Buffer.from(INVOICE_TEXT),
    mimeType: 'application/pdf',
  });
  getAsset.mockResolvedValue({ originalFileName: 'invoice.pdf' });
  recognizeDocument.mockReturnValue({
    kind: 'commercial-invoice',
    confidence: 0.92,
    needsUserChoice: false,
    alternatives: [{ kind: 'receipt', score: 0.3 }],
    signals: [{ reason: 'says "commercial invoice"', weight: 1 }],
  });
  extractPdfText.mockResolvedValue({
    text: INVOICE_TEXT,
    pages: [INVOICE_TEXT],
    looksScannedOrArtwork: false,
  });
  extractDocument.mockResolvedValue({
    document,
    issues: [],
    needsReview: false,
    modelId: 'test-model',
  });
  listDocuments.mockResolvedValue([]);
  getStoredDocument.mockResolvedValue(null);
  storeExtractedDocument.mockResolvedValue({
    documentId: 'auth0|seller::asset-1',
    role: 'commercial-invoice',
  });
});

describe('readDocument', () => {
  it('does not persist — reading is not filing', async () => {
    await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(storeExtractedDocument).not.toHaveBeenCalled();
  });

  it('reports whether the vendor is a known supplier, which recognition cannot', async () => {
    listDocuments.mockResolvedValue([{ documentId: 'earlier' }]);

    const reading = await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(reading.vendorIsKnownSupplier).toBe(true);
  });

  it('says the vendor is unknown when nothing has been bought from them', async () => {
    // The signal that turns "this is a receipt" into "this may be personal".
    const reading = await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(reading.vendorIsKnownSupplier).toBe(false);
  });

  it('returns the figures the question needs', async () => {
    const reading = await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(reading.extraction?.total).toBe(1200);
    expect(reading.extraction?.vendorName).toBe('Shenzhen Widgets');
  });

  it('refuses an asset that is not the caller’s', async () => {
    loadAssetBytes.mockResolvedValue(null);

    await expect(
      (await ops()).readDocument({ assetId: 'someone-elses' })
    ).rejects.toThrow(/not yours/i);
  });

  it('does not pay the model for a document with no cost in it', async () => {
    recognizeDocument.mockReturnValue({
      kind: 'fba-box-label',
      confidence: 0.95,
      needsUserChoice: false,
      alternatives: [],
      signals: [],
    });

    const reading = await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(extractDocument).not.toHaveBeenCalled();
    expect(reading.note).toBeTruthy();
  });

  it('does not pay the model for a scan with no text', async () => {
    extractPdfText.mockResolvedValue({
      text: '',
      pages: [],
      looksScannedOrArtwork: true,
    });

    await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(extractDocument).not.toHaveBeenCalled();
  });

  it('flags a document already filed, so saving again is known to be a no-op', async () => {
    getStoredDocument.mockResolvedValue({
      documentId: 'auth0|seller::asset-1',
    });

    const reading = await (await ops()).readDocument({ assetId: 'asset-1' });

    expect(reading.alreadySaved).toBe(true);
  });
});

describe('saveDocument', () => {
  it('files what was read, without paying the model twice', async () => {
    const subject = await ops();
    await subject.readDocument({ assetId: 'asset-1' });
    expect(extractDocument).toHaveBeenCalledTimes(1);

    await subject.saveDocument({ assetId: 'asset-1' });

    // The reading is reused; #50 exists partly because re-reading used to
    // re-bill for a document already read.
    expect(extractDocument).toHaveBeenCalledTimes(1);
    expect(storeExtractedDocument).toHaveBeenCalledTimes(1);
  });

  it('re-reads rather than failing when the reading is not cached', async () => {
    // A different serverless instance, or a save minutes later. Correctness
    // must not depend on the cache being warm.
    await (await ops()).saveDocument({ assetId: 'asset-1' });

    expect(extractDocument).toHaveBeenCalledTimes(1);
    expect(storeExtractedDocument).toHaveBeenCalledTimes(1);
  });

  it('passes a role override through as the user’s decision', async () => {
    await (
      await ops()
    ).saveDocument({
      assetId: 'asset-1',
      role: 'transport-document',
    });

    expect(storeExtractedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'transport-document' })
    );
  });

  it('refuses to file a document with no figures in it', async () => {
    recognizeDocument.mockReturnValue({
      kind: 'fba-box-label',
      confidence: 0.95,
      needsUserChoice: false,
      alternatives: [],
      signals: [],
    });

    await expect(
      (await ops()).saveDocument({ assetId: 'asset-1' })
    ).rejects.toThrow(/nothing to file/i);
    expect(storeExtractedDocument).not.toHaveBeenCalled();
  });
});

describe('listDocuments', () => {
  it('scopes every listing to the calling user', async () => {
    await (await ops()).listDocuments({ vendorName: 'Shenzhen Widgets' });

    expect(listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth0|seller',
        vendorName: 'Shenzhen Widgets',
      })
    );
  });

  it('returns the fields a cost answer needs, and no ciphertext of a document', async () => {
    listDocuments.mockResolvedValue([
      {
        documentId: 'd1',
        role: 'commercial-invoice',
        extracted: document,
        needsReview: true,
      },
    ]);

    const [row] = await (await ops()).listDocuments({});

    expect(row).toEqual({
      documentId: 'd1',
      role: 'commercial-invoice',
      vendorName: 'Shenzhen Widgets',
      documentDate: '2026-03-04',
      currency: 'USD',
      total: 1200,
      needsReview: true,
    });
  });
});
