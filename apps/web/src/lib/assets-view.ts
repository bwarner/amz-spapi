import {
  listDocuments,
  listPurchaseOrders,
  type StoredDocument,
  type StoredPurchaseOrder,
} from '@amz-spapi/sp-cache';
import type { AssetLink } from '@farvisionllc/models';
import { aplusAssetReferences } from './a-plus-asset-cleanup';
import { listLinksForUser } from './asset-links';
import { chatAssetIds } from './chat-store';
import {
  deleteAsset,
  listAssets,
  type MediaAsset,
  type MediaAssetFeature,
} from './media-assets';

/**
 * The assets view: creative files as the same record, a different face.
 *
 * The Documents page shows evidence (invoices, labels, PODs); this page shows
 * the CREATIVE library — A+ imagery, listing photos, ad creative — plus one
 * category from the documents side: generated files nothing references. Those
 * need a face somewhere, because they are the only assets it is ever safe to
 * delete in bulk.
 *
 * ## The collection rule, stated once
 *
 * Only MODEL OUTPUT is ever collected, and only when the full reference scan
 * finds nothing pointing at it. Anything a human uploaded stays, referenced or
 * not — a person's file is theirs to delete one at a time with their eyes
 * open, never a sweep's to reap. The `generated-` filename prefix is the
 * marker (see `persistGeneratedFileAsset`), and the scan must include EVERY
 * referencer: A+ drafts, version snapshots and brand-guide logos, catalog
 * links, chat messages, filed documents, and issued orders' render pointers.
 * The A+ cleanup's INVARIANT comment lists exactly this trap — a sweep that
 * misses one referencer deletes an image something still shows.
 */

export type AssetReference = {
  kind: 'a-plus' | 'catalog' | 'chat' | 'document' | 'po-render';
  /** "A+ content", "product", "chat", "filed document", "PO-2026-0003". */
  label: string;
};

export type AssetCard = {
  assetId: string;
  fileName: string;
  /** The name is a description, not a name anyone chose. */
  nameUnknown?: boolean;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  feature: MediaAssetFeature;
  generated: boolean;
  createdAt: number;
  references: AssetReference[];
};

export type AssetsView = {
  cards: AssetCard[];
  /** Creative-feature counts for the header — the documents face lives on
      its own page and is not counted here. */
  counts: Partial<Record<MediaAssetFeature, number>>;
  unreferencedGenerated: { count: number; bytes: number };
};

const CREATIVE_FEATURES: MediaAssetFeature[] = [
  'a-plus',
  'ads',
  'listings',
  'shared',
];

export type AssetsViewInput = {
  /** Assets of the creative features — all of them appear. */
  creative: MediaAsset[];
  /** Documents-feature assets — only unreferenced GENERATED ones appear
      (orphaned PO renders and the like); the rest belong to the Documents
      page. */
  documents: MediaAsset[];
  aplusRefs: Set<string>;
  chatRefs: Set<string>;
  links: AssetLink[];
  documentAssetIds: Set<string>;
  /** Current render pointers: assetId → PO number. */
  renderAssetIds: Map<string, string>;
};

function cardName(asset: MediaAsset): {
  fileName: string;
  nameUnknown?: boolean;
} {
  if (!asset.originalFileName.startsWith('generated-')) {
    return { fileName: asset.originalFileName };
  }
  const kind = asset.mimeType.startsWith('image/') ? 'image' : 'file';
  return { fileName: `Generated ${kind}`, nameUnknown: true };
}

export function buildAssetsView(input: AssetsViewInput): AssetsView {
  const linksByAsset = new Map<string, AssetLink[]>();
  for (const link of input.links) {
    const existing = linksByAsset.get(link.assetId);
    if (existing) existing.push(link);
    else linksByAsset.set(link.assetId, [link]);
  }

  const referencesFor = (asset: MediaAsset): AssetReference[] => {
    const references: AssetReference[] = [];
    if (input.aplusRefs.has(asset.assetId)) {
      references.push({ kind: 'a-plus', label: 'A+ content' });
    }
    for (const link of linksByAsset.get(asset.assetId) ?? []) {
      references.push({ kind: 'catalog', label: link.ownerType });
    }
    if (input.chatRefs.has(asset.assetId)) {
      references.push({ kind: 'chat', label: 'chat' });
    }
    if (input.documentAssetIds.has(asset.assetId)) {
      references.push({ kind: 'document', label: 'filed document' });
    }
    const poNumber = input.renderAssetIds.get(asset.assetId);
    if (poNumber) {
      references.push({ kind: 'po-render', label: poNumber });
    }
    return references;
  };

  const toCard = (asset: MediaAsset): AssetCard => ({
    assetId: asset.assetId,
    ...cardName(asset),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    feature: asset.createdForFeature,
    generated: asset.originalFileName.startsWith('generated-'),
    createdAt: asset.createdAt,
    references: referencesFor(asset),
  });

  const cards = [
    ...input.creative.map(toCard),
    // The documents face contributes only what this page can act on: a
    // generated file nothing references. A referenced render or a filed
    // upload already has its home on the Documents page.
    ...input.documents
      .map(toCard)
      .filter((card) => card.generated && card.references.length === 0),
  ].sort((a, b) => b.createdAt - a.createdAt);

  const counts: Partial<Record<MediaAssetFeature, number>> = {};
  for (const asset of input.creative) {
    counts[asset.createdForFeature] =
      (counts[asset.createdForFeature] ?? 0) + 1;
  }

  const collectable = cards.filter(
    (card) => card.generated && card.references.length === 0
  );
  return {
    cards,
    counts,
    unreferencedGenerated: {
      count: collectable.length,
      bytes: collectable.reduce((sum, card) => sum + card.sizeBytes, 0),
    },
  };
}

/** The assets a collection sweep may delete. Pure, and the ONLY decision the
 * sweep trusts — recomputed server-side at collect time, never taken from the
 * client. */
export function collectableAssetIds(view: AssetsView): string[] {
  return view.cards
    .filter((card) => card.generated && card.references.length === 0)
    .map((card) => card.assetId);
}

async function loadInput(userId: string): Promise<AssetsViewInput> {
  const [features, documents, links, aplusRefs, chatRefs, storedDocs, orders] =
    await Promise.all([
      Promise.all(
        CREATIVE_FEATURES.map((feature) => listAssets({ userId, feature }))
      ),
      listAssets({ userId, feature: 'documents' }),
      listLinksForUser(userId),
      aplusAssetReferences(userId),
      chatAssetIds(userId),
      listDocuments({ userId, limit: 500 }),
      listPurchaseOrders({ userId }),
    ]);

  return {
    creative: features.flat(),
    documents,
    aplusRefs,
    chatRefs,
    links,
    documentAssetIds: new Set(
      storedDocs.map((document: StoredDocument) => document.assetId)
    ),
    renderAssetIds: new Map(
      orders.flatMap((order: StoredPurchaseOrder) =>
        order.renders.map(
          (render) => [render.assetId, order.order.poNumber] as const
        )
      )
    ),
  };
}

export async function loadAssetsView(userId: string): Promise<AssetsView> {
  return buildAssetsView(await loadInput(userId));
}

/**
 * Delete every unreferenced generated asset. The reference scan is recomputed
 * here, moments before deletion — the view the seller confirmed against is
 * advisory, never authoritative, so a reference created between page load and
 * confirm still protects its asset.
 */
export async function collectUnreferencedGeneratedAssets(
  userId: string
): Promise<{ deleted: number; bytesFreed: number }> {
  const view = buildAssetsView(await loadInput(userId));
  let deleted = 0;
  let bytesFreed = 0;
  const bySize = new Map(
    view.cards.map((card) => [card.assetId, card.sizeBytes])
  );
  for (const assetId of collectableAssetIds(view)) {
    if (await deleteAsset(assetId, userId)) {
      deleted += 1;
      bytesFreed += bySize.get(assetId) ?? 0;
    }
  }
  return { deleted, bytesFreed };
}
