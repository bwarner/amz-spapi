import { describe, expect, it } from 'vitest';
import { buildFileView, type FileViewInput } from './document-center';
import type { MediaAsset } from './media-assets';
import type {
  ReportImport,
  StoredBoxLabel,
  StoredDocument,
  StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';

/**
 * The assembly, not the stores.
 *
 * Every failure this guards against is silent on screen: a file listed twice
 * because the sha256 join missed, a purchase total that quietly sums a quote
 * and the invoice that replaced it, a settlement whose rows nobody can find
 * because the import was never attached to the file it came from.
 */

const USER = 'auth0|seller';

function asset(
  overrides: Partial<MediaAsset> & { assetId: string }
): MediaAsset {
  return {
    userId: USER,
    createdForFeature: 'documents',
    originalFileName: `${overrides.assetId}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    hashes: { sha256: `sha-${overrides.assetId}` },
    status: 'uploaded',
    storage: { provider: 's3', bucket: 'b', key: 'k' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function document(
  overrides: Partial<StoredDocument> & { assetId: string }
): StoredDocument {
  return {
    documentId: `${USER}::${overrides.assetId}`,
    userId: USER,
    role: 'commercial-invoice',
    roleSource: 'recognised',
    recognition: {
      kind: 'commercial-invoice',
      confidence: 0.9,
      needsUserChoice: false,
      alternatives: [],
      signals: [],
    },
    extracted: {
      vendorName: 'Shenzhen Ruiyi',
      documentDate: '2026-03-04',
      currency: 'USD',
      total: 4180,
      lines: [],
    } as StoredDocument['extracted'],
    issues: [],
    needsReview: false,
    storedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function reportImport(overrides: Partial<ReportImport>): ReportImport {
  return {
    importId: 'imp-1',
    sellerId: 'A1SELLER',
    kind: 'settlement',
    reportType: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE',
    source: 'upload',
    rowsParsed: 1043,
    rowsNew: 1043,
    rowsDuplicate: 0,
    createdAt: 2_000,
    ...overrides,
  };
}

function emptyGrouping(
  documents: StoredDocument[] = []
): FileViewInput['grouping'] {
  return { purchases: [], suggestions: [], documents };
}

function po(overrides: Partial<StoredPurchaseOrder> = {}): StoredPurchaseOrder {
  return {
    key: `${USER}::PO-2026-0003`,
    userId: USER,
    order: {
      poNumber: 'PO-2026-0003',
      issueDate: '2026-05-29',
      revision: 1,
      status: 'open',
      vendorId: 'fernandez-plantation',
      currency: 'USD',
      lines: [
        {
          sku: 'FB-COF-HGE-250',
          description: 'Honey Geisha 250g',
          quantity: 80,
          unitPrice: 18.5,
        },
      ],
    } as StoredPurchaseOrder['order'],
    renders: [],
    storedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('buildFileView', () => {
  it('lists a stored file and the report it was ingested as, once', () => {
    // The case a seller hits by dropping a settlement .csv on the Import page:
    // it is stored AND ingested, and two records describe one file.
    const stored = asset({ assetId: 'a1', originalFileName: 'settlement.csv' });
    const view = buildFileView({
      userId: USER,
      assets: [stored],
      imports: [reportImport({ fileSha256: 'sha-a1' })],
      boxLabels: [],
      grouping: emptyGrouping(),
    });

    expect(view.files).toHaveLength(1);
    expect(view.files[0].fileName).toBe('settlement.csv');
    expect(view.files[0].assetId).toBe('a1');
    expect(view.files[0].importId).toBe('imp-1');
    expect(view.files[0].produced).toEqual([
      expect.objectContaining({ kind: 'report-rows', rowsNew: 1043 }),
    ]);
  });

  it('lists an import whose file was never stored', () => {
    // The reports importer keeps rows and no bytes, so this entry has no asset
    // and must still be visible and deletable.
    const view = buildFileView({
      userId: USER,
      assets: [],
      imports: [reportImport({ fileName: 'settlement-2588.txt' })],
      boxLabels: [],
      grouping: emptyGrouping(),
    });

    expect(view.files).toHaveLength(1);
    expect(view.files[0].id).toBe('import:imp-1');
    expect(view.files[0].assetId).toBeUndefined();
    expect(view.files[0].fileName).toBe('settlement-2588.txt');
  });

  it('does not join an import to a file with different bytes', () => {
    const view = buildFileView({
      userId: USER,
      assets: [asset({ assetId: 'a1' })],
      imports: [reportImport({ fileSha256: 'sha-somethingelse' })],
      boxLabels: [],
      grouping: emptyGrouping(),
    });

    expect(view.files).toHaveLength(2);
  });

  it('falls back to the extracted name when the asset was stored unnamed', () => {
    // Assets uploaded before names were kept are `generated-…`; the extraction
    // recorded the real one.
    const view = buildFileView({
      userId: USER,
      assets: [
        asset({ assetId: 'a1', originalFileName: 'generated-asset_9f.pdf' }),
      ],
      imports: [],
      boxLabels: [],
      grouping: emptyGrouping([
        document({ assetId: 'a1', fileName: 'ruiyi-invoice-8821.pdf' }),
      ]),
    });

    expect(view.files[0].fileName).toBe('ruiyi-invoice-8821.pdf');
  });

  it('names a render after the order it prints, and says what it is', () => {
    // The app's own PO renders are stored as `generated-…` with no name.
    // Before this they listed as "Unnamed PDF — stored, but nothing was read
    // from it", which is a strange thing to say about a file the app wrote.
    const view = buildFileView({
      userId: USER,
      assets: [
        asset({ assetId: 'r1', originalFileName: 'generated-asset_r1.pdf' }),
      ],
      imports: [],
      boxLabels: [],
      grouping: emptyGrouping(),
      purchaseOrders: [
        po({
          renders: [{ format: 'pdf', assetId: 'r1', renderedAt: 3_000 }],
          shipmentIds: ['FBA19F8Q9N8C'],
        }),
      ],
    });

    const [file] = view.files;
    expect(file.fileName).toBe('PO-2026-0003.pdf');
    expect(file.nameUnknown).toBeUndefined();
    expect(file.produced).toEqual([
      {
        kind: 'issued-po-render',
        poNumber: 'PO-2026-0003',
        format: 'pdf',
        vendorName: 'Fernandez Plantation',
        issueDate: '2026-05-29',
        currency: 'USD',
        // 80 × 18.50 from the order's own lines — totals are never stored.
        total: 1480,
        shipmentIds: ['FBA19F8Q9N8C'],
      },
    ]);
  });

  it('leaves a superseded render unnamed rather than presenting stale figures as current', () => {
    // A revision drops the order's pointer to its old render; the bytes stay
    // behind. Naming the orphan after the order would caption last week's
    // figures with this week's name.
    const view = buildFileView({
      userId: USER,
      assets: [
        asset({ assetId: 'old', originalFileName: 'generated-asset_old.pdf' }),
      ],
      imports: [],
      boxLabels: [],
      grouping: emptyGrouping(),
      purchaseOrders: [
        po({ renders: [{ format: 'pdf', assetId: 'new', renderedAt: 3_000 }] }),
      ],
    });

    expect(view.files[0].fileName).toBe('Unnamed PDF');
    expect(view.files[0].produced).toEqual([]);
  });

  it('summarises box labels per shipment, not per box', () => {
    const labels: StoredBoxLabel[] = [1, 2, 3, 4].map((box) => ({
      labelId: `A1SELLER::FBA15K::box-${box}`,
      sellerId: 'A1SELLER',
      shipmentId: 'FBA15K',
      boxNumber: box,
      destinationFc: 'ONT8',
      quantity: 10,
      singleSku: true,
      identityIsContentHash: false,
      assetId: 'a1',
      warnings: [],
      storedAt: 1_000,
    }));

    const view = buildFileView({
      userId: USER,
      assets: [asset({ assetId: 'a1' })],
      imports: [],
      boxLabels: labels,
      grouping: emptyGrouping(),
    });

    expect(view.files[0].produced).toEqual([
      expect.objectContaining({
        kind: 'box-labels',
        shipmentId: 'FBA15K',
        boxes: 4,
        units: 40,
      }),
    ]);
  });

  it('totals a purchase from the invoice alone', () => {
    // A payment record restates the same money and a proforma is a quote for
    // it. Summing any of them together doubles the cost of goods, which is a
    // plausible-looking number and the reason PURCHASE_AUTHORITY exists.
    const invoice = document({ assetId: 'a1', role: 'commercial-invoice' });
    const receipt = document({
      assetId: 'a2',
      role: 'payment-record',
      extracted: {
        vendorName: 'Shenzhen Ruiyi',
        documentDate: '2026-03-06',
        currency: 'USD',
        total: 4180,
        lines: [],
      } as StoredDocument['extracted'],
    });

    const view = buildFileView({
      userId: USER,
      assets: [asset({ assetId: 'a1' }), asset({ assetId: 'a2' })],
      imports: [],
      boxLabels: [],
      grouping: {
        documents: [invoice, receipt],
        suggestions: [],
        purchases: [
          {
            purchaseId: invoice.documentId,
            documentIds: [invoice.documentId, receipt.documentId],
            joins: [
              {
                on: 'invoice-number',
                value: 'INV-8821',
                documentIds: [invoice.documentId, receipt.documentId],
              },
            ],
          },
        ],
      },
    });

    expect(view.purchases[0].total).toBe(4180);
    expect(view.purchases[0].joins).toEqual(['invoice number INV-8821']);
    expect(view.purchases[0].fileIds).toEqual(['a1', 'a2']);
  });

  it('does not call a lone document a purchase', () => {
    // groupPurchaseDocuments returns a group per connected component, so every
    // unjoined invoice arrives as its own single-document "purchase". Listing
    // those puts a card above the file list for every document that was joined
    // to nothing, which buries the groups that mean something.
    const lone = document({ assetId: 'a1' });
    const view = buildFileView({
      userId: USER,
      assets: [asset({ assetId: 'a1' })],
      imports: [],
      boxLabels: [],
      grouping: {
        documents: [lone],
        suggestions: [],
        purchases: [
          {
            purchaseId: lone.documentId,
            documentIds: [lone.documentId],
            joins: [],
          },
        ],
      },
    });

    expect(view.purchases).toHaveLength(0);
    // …and the document is still listed, with everything known about it.
    expect(view.files[0].produced).toEqual([
      expect.objectContaining({
        kind: 'purchase-document',
        vendorName: 'Shenzhen Ruiyi',
      }),
    ]);
  });

  it('describes a file whose name was never recorded', () => {
    const view = buildFileView({
      userId: USER,
      assets: [
        asset({ assetId: 'a1', originalFileName: 'generated-asset_9f.pdf' }),
      ],
      imports: [],
      boxLabels: [],
      grouping: emptyGrouping(),
    });

    // An internal identifier is not a name. Flagged, so the UI can say so
    // rather than presenting it as what the seller called the file.
    expect(view.files[0].fileName).toBe('Unnamed PDF');
    expect(view.files[0].nameUnknown).toBe(true);
  });

  it('carries a suggestion’s own reason and resolves it to files', () => {
    const a = document({ assetId: 'a1' });
    const b = document({ assetId: 'a2' });
    const view = buildFileView({
      userId: USER,
      assets: [asset({ assetId: 'a1' }), asset({ assetId: 'a2' })],
      imports: [],
      boxLabels: [],
      grouping: {
        documents: [a, b],
        purchases: [],
        suggestions: [
          {
            documentIds: [a.documentId, b.documentId],
            vendorName: 'Shenzhen Ruiyi',
            daysApart: 3,
            reason: 'Same supplier, 3 days apart',
          },
        ],
      },
    });

    expect(view.suggestions[0].reason).toBe('Same supplier, 3 days apart');
    expect(view.suggestions[0].fileIds).toEqual(['a1', 'a2']);
  });

  it('folds an uploaded PO onto the issued order it copies, by number', () => {
    const copy = document({
      assetId: 'a1',
      role: 'purchase-order',
      extracted: {
        vendorName: 'Panama Select',
        invoiceNumber: 'po-2026-0001 ', // as a model reads it: case and space
        currency: 'USD',
        total: 1600,
        lines: [],
      } as StoredDocument['extracted'],
    });
    // An invoice CITING the PO it answers carries the same number. Folding it
    // would file the bill as the order, so only PO-role documents fold.
    const citingInvoice = document({
      assetId: 'a2',
      role: 'commercial-invoice',
      extracted: {
        vendorName: 'Panama Select',
        invoiceNumber: 'PO-2026-0001',
        currency: 'USD',
        total: 1600,
        lines: [],
      } as StoredDocument['extracted'],
    });

    const view = buildFileView({
      userId: USER,
      assets: [asset({ assetId: 'a1' }), asset({ assetId: 'a2' })],
      imports: [],
      boxLabels: [],
      grouping: emptyGrouping([copy, citingInvoice]),
      purchaseOrders: [
        {
          key: `${USER}::PO-2026-0001`,
          userId: USER,
          order: { poNumber: 'PO-2026-0001' },
          renders: [],
          storedAt: 1,
          updatedAt: 1,
        } as never,
      ],
    });

    const produced = (assetId: string) =>
      view.files
        .find((file) => file.assetId === assetId)!
        .produced.find((item) => item.kind === 'purchase-document') as {
        issuedPoNumber?: string;
      };
    expect(produced('a1').issuedPoNumber).toBe('PO-2026-0001');
    expect(produced('a2').issuedPoNumber).toBeUndefined();
  });

  it('orders files and imports together, newest first', () => {
    const view = buildFileView({
      userId: USER,
      assets: [
        asset({ assetId: 'old', createdAt: 1_000 }),
        asset({ assetId: 'new', createdAt: 3_000 }),
      ],
      imports: [reportImport({ createdAt: 2_000, fileName: 'middle.txt' })],
      boxLabels: [],
      grouping: emptyGrouping(),
    });

    expect(view.files.map((file) => file.id)).toEqual([
      'new',
      'import:imp-1',
      'old',
    ]);
  });
});
