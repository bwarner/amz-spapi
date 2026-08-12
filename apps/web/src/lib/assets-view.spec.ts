import { describe, expect, it } from 'vitest';
import {
  buildAssetsView,
  collectableAssetIds,
  type AssetsViewInput,
} from './assets-view';
import type { MediaAsset } from './media-assets';
import type { AssetLink } from '@farvisionllc/models';

/**
 * The collection rule is the whole risk of this page: a sweep that deletes an
 * upload destroys a person's file; one that misses a referencer deletes an
 * image something still shows. Every test here is one of those two failures.
 */

const USER = 'auth0|seller';

function asset(
  overrides: Partial<MediaAsset> & { assetId: string }
): MediaAsset {
  return {
    userId: USER,
    createdForFeature: 'a-plus',
    originalFileName: `generated-${overrides.assetId}.png`,
    mimeType: 'image/png',
    sizeBytes: 1000,
    hashes: { sha256: `sha-${overrides.assetId}` },
    status: 'uploaded',
    storage: { provider: 's3', bucket: 'b', key: 'k' },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function link(assetId: string, ownerType: AssetLink['ownerType']): AssetLink {
  return {
    linkId: `link-${assetId}`,
    assetId,
    ownerType,
    ownerId: 'owner-1',
    userId: USER,
    createdAt: 1,
  };
}

function input(overrides: Partial<AssetsViewInput> = {}): AssetsViewInput {
  return {
    creative: [],
    documents: [],
    aplusRefs: new Set(),
    chatRefs: new Set(),
    links: [],
    documentAssetIds: new Set(),
    renderAssetIds: new Map(),
    ...overrides,
  };
}

describe('buildAssetsView', () => {
  it('resolves every reference kind onto its card', () => {
    const view = buildAssetsView(
      input({
        creative: [
          asset({ assetId: 'in-draft' }),
          asset({ assetId: 'on-product' }),
          asset({ assetId: 'in-chat' }),
          asset({ assetId: 'orphan' }),
        ],
        aplusRefs: new Set(['in-draft']),
        chatRefs: new Set(['in-chat']),
        links: [link('on-product', 'product')],
      })
    );

    const byId = new Map(view.cards.map((card) => [card.assetId, card]));
    expect(byId.get('in-draft')?.references).toEqual([
      { kind: 'a-plus', label: 'A+ content' },
    ]);
    expect(byId.get('on-product')?.references).toEqual([
      { kind: 'catalog', label: 'product' },
    ]);
    expect(byId.get('in-chat')?.references).toEqual([
      { kind: 'chat', label: 'chat' },
    ]);
    expect(byId.get('orphan')?.references).toEqual([]);
    expect(view.unreferencedGenerated).toEqual({ count: 1, bytes: 1000 });
  });

  it('never marks an upload collectable, referenced or not', () => {
    const view = buildAssetsView(
      input({
        creative: [
          asset({
            assetId: 'upload',
            originalFileName: 'hero-towel-stack.jpg',
          }),
        ],
      })
    );

    // Unreferenced AND an upload: visible, flagged, but not in the sweep.
    expect(view.cards[0].references).toEqual([]);
    expect(view.unreferencedGenerated.count).toBe(0);
    expect(collectableAssetIds(view)).toEqual([]);
  });

  it('shows a documents-feature generated orphan, but not referenced ones', () => {
    // The orphaned PO render: generated, documents feature, nothing points at
    // it — this page is where it gets reviewed. Its referenced sibling and a
    // filed upload belong to the Documents page and stay off the grid.
    const view = buildAssetsView(
      input({
        documents: [
          asset({ assetId: 'orphan-render', createdForFeature: 'documents' }),
          asset({ assetId: 'live-render', createdForFeature: 'documents' }),
          asset({
            assetId: 'filed-invoice',
            createdForFeature: 'documents',
            originalFileName: 'invoice-8821.pdf',
          }),
        ],
        renderAssetIds: new Map([['live-render', 'PO-2026-0003']]),
      })
    );

    expect(view.cards.map((card) => card.assetId)).toEqual(['orphan-render']);
    expect(collectableAssetIds(view)).toEqual(['orphan-render']);
    // Documents-feature files never inflate the creative counts.
    expect(view.counts).toEqual({});
  });

  it('a current PO render pointer protects its asset from the sweep', () => {
    const view = buildAssetsView(
      input({
        creative: [asset({ assetId: 'render' })],
        renderAssetIds: new Map([['render', 'PO-2026-0001']]),
      })
    );

    expect(view.cards[0].references).toEqual([
      { kind: 'po-render', label: 'PO-2026-0001' },
    ]);
    expect(collectableAssetIds(view)).toEqual([]);
  });

  it('counts creative features for the header', () => {
    const view = buildAssetsView(
      input({
        creative: [
          asset({ assetId: 'a1' }),
          asset({ assetId: 'a2', createdForFeature: 'listings' }),
          asset({ assetId: 'a3', createdForFeature: 'listings' }),
        ],
      })
    );
    expect(view.counts).toEqual({ 'a-plus': 1, listings: 2 });
  });
});
