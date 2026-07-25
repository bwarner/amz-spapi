import crypto from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  SpApiClient,
  type ListingsPatchOperation,
} from '@farvisionllc/sp-client';
import {
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import { createAssetS3Client, getAsset } from './media-assets';

/**
 * Listing image writes — the guarded path to the live listing:
 * 1. SNAPSHOT the current submitted attributes (our undo button; Amazon has
 *    none) into catalog.listing_versions.
 * 2. PREVIEW: the exact patch in Amazon's VALIDATION_PREVIEW mode — a real
 *    dry run with zero effect on the listing.
 * 3. APPLY: same patch for real (behind chat-side human approval), then the
 *    caller re-reads and surfaces Amazon's issues.
 * 4. REVERT: re-patch the image slots from a stored snapshot.
 *
 * Amazon fetches image URLs unauthenticated, so assets are handed over as
 * S3 presigned GET URLs (fetch happens within minutes of submission).
 * TODO(production): serve from a public/CDN prefix instead — presigned URLs
 * inherit the signing credential's lifetime.
 */

const SCOPE = 'catalog';
const VERSIONS_COLLECTION = 'listing_versions';
const SNAPSHOT_KEEP = 10;
const PRESIGN_EXPIRY_SECONDS = 6 * 60 * 60;

export const IMAGE_SLOT_ATTRIBUTES = [
  'main_product_image_locator',
  ...Array.from(
    { length: 8 },
    (_, i) => `other_product_image_locator_${i + 1}`
  ),
] as const;

export type ListingSnapshot = {
  snapshotId: string;
  userId: string;
  sku: string;
  productType: string;
  capturedAt: number;
  /** Full submitted attribute map at capture time. */
  attributes: Record<string, unknown>;
};

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

function snapshotDocKey(userId: string, snapshotId: string): string {
  return `listing-ver::${safeUserPart(userId)}::${snapshotId}`;
}

export type ListingWritesDeps = {
  userId: string;
  sellerId: string;
  marketplaceId: string;
  spClient: SpApiClient;
  /** Optional hard allowlist (env LISTING_WRITE_SKU_ALLOWLIST): when set,
   * apply/revert refuse every other SKU — the training-wheels rung. */
  skuAllowlist?: string[];
};

function assertSkuAllowed(deps: ListingWritesDeps, sku: string): void {
  if (!deps.skuAllowlist?.length) return;
  if (!deps.skuAllowlist.includes(sku)) {
    throw new Error(
      `SKU ${sku} is not in LISTING_WRITE_SKU_ALLOWLIST — listing writes are ` +
        'restricted to the configured test SKUs.'
    );
  }
}

async function presignAssetUrl(
  userId: string,
  assetId: string
): Promise<string> {
  const asset = await getAsset(assetId);
  if (!asset || asset.userId !== userId || asset.status !== 'uploaded') {
    throw new Error(
      `Asset ${assetId} not found — use asset ids from this conversation's photos.`
    );
  }
  if (!asset.mimeType.startsWith('image/')) {
    throw new Error(`Asset ${assetId} is not an image.`);
  }
  return getSignedUrl(
    createAssetS3Client(),
    new GetObjectCommand({
      Bucket: asset.storage.bucket,
      Key: asset.storage.key,
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS }
  );
}

async function fetchListing(deps: ListingWritesDeps, sku: string) {
  const listing = await deps.spClient.getListingsItem({
    sku,
    sellerId: deps.sellerId,
    includedData: ['summaries', 'attributes', 'issues'],
  });
  const summary = (
    listing?.summaries as Array<{ productType?: string }> | undefined
  )?.[0];
  const productType = summary?.productType;
  if (!productType) {
    throw new Error(
      `Could not resolve the product type for SKU ${sku} — the listing may not exist.`
    );
  }
  return {
    productType,
    attributes: (listing?.attributes ?? {}) as Record<string, unknown>,
    issues: listing?.issues ?? [],
  };
}

/** Current vs proposed value for each image slot the patch touches. */
function imageDiff(
  attributes: Record<string, unknown>,
  patches: ListingsPatchOperation[]
): Array<{ slot: string; current?: string; proposed?: string }> {
  return patches.map((patch) => {
    const slot = patch.path.replace('/attributes/', '');
    const currentValue = attributes[slot] as
      | Array<{ media_location?: string }>
      | undefined;
    return {
      slot,
      current: currentValue?.[0]?.media_location,
      proposed: (patch.value?.[0] as { media_location?: string } | undefined)
        ?.media_location,
    };
  });
}

/**
 * Ordered images → slot patches: index 0 is the MAIN image, 1..8 the other
 * slots. Only provided slots are touched unless clearRemaining removes the
 * rest (explicit choice, never the default).
 */
async function buildImagePatches(
  deps: ListingWritesDeps,
  params: {
    images: Array<{ assetId: string }>;
    currentAttributes: Record<string, unknown>;
    clearRemaining?: boolean;
  }
): Promise<ListingsPatchOperation[]> {
  if (params.images.length === 0) {
    throw new Error('Provide at least one image (index 0 becomes MAIN).');
  }
  if (params.images.length > 9) {
    throw new Error('At most 9 images (1 main + 8 others).');
  }

  const patches: ListingsPatchOperation[] = [];
  for (let i = 0; i < params.images.length; i++) {
    const url = await presignAssetUrl(deps.userId, params.images[i].assetId);
    patches.push({
      op: 'replace',
      path: `/attributes/${IMAGE_SLOT_ATTRIBUTES[i]}`,
      value: [{ marketplace_id: deps.marketplaceId, media_location: url }],
    });
  }
  if (params.clearRemaining) {
    for (let i = params.images.length; i < IMAGE_SLOT_ATTRIBUTES.length; i++) {
      const slot = IMAGE_SLOT_ATTRIBUTES[i];
      if (params.currentAttributes[slot] !== undefined) {
        patches.push({ op: 'delete', path: `/attributes/${slot}` });
      }
    }
  }
  return patches;
}

export function createListingWrites(deps: ListingWritesDeps) {
  return {
    /** Amazon-side dry run: submitted patch, zero effect, real validation. */
    async previewImageUpdate(params: {
      sku: string;
      images: Array<{ assetId: string }>;
      clearRemaining?: boolean;
    }) {
      assertSkuAllowed(deps, params.sku);
      const listing = await fetchListing(deps, params.sku);
      const patches = await buildImagePatches(deps, {
        images: params.images,
        currentAttributes: listing.attributes,
        clearRemaining: params.clearRemaining,
      });
      const result = await deps.spClient.patchListingsItem({
        sku: params.sku,
        sellerId: deps.sellerId,
        productType: listing.productType,
        patches,
        mode: 'VALIDATION_PREVIEW',
      });
      return {
        status: result?.status,
        issues: result?.issues ?? [],
        diff: imageDiff(listing.attributes, patches),
      };
    },

    /** The real write — snapshot first, patch, report the snapshot id. */
    async applyImageUpdate(params: {
      sku: string;
      images: Array<{ assetId: string }>;
      clearRemaining?: boolean;
    }) {
      assertSkuAllowed(deps, params.sku);
      const listing = await fetchListing(deps, params.sku);

      const snapshotId = `lver_${crypto.randomUUID()}`;
      const snapshot: ListingSnapshot = {
        snapshotId,
        userId: deps.userId,
        sku: params.sku,
        productType: listing.productType,
        capturedAt: Date.now(),
        attributes: listing.attributes,
      };
      await upsertDocument(
        SCOPE,
        VERSIONS_COLLECTION,
        snapshotDocKey(deps.userId, snapshotId),
        snapshot
      );
      await pruneSnapshots(deps.userId, params.sku);

      const patches = await buildImagePatches(deps, {
        images: params.images,
        currentAttributes: listing.attributes,
        clearRemaining: params.clearRemaining,
      });
      const result = await deps.spClient.patchListingsItem({
        sku: params.sku,
        sellerId: deps.sellerId,
        productType: listing.productType,
        patches,
      });

      return {
        status: result?.status,
        submissionId: result?.submissionId,
        issues: result?.issues ?? [],
        snapshotId,
        diff: imageDiff(listing.attributes, patches),
      };
    },

    /** Restore image slots from a snapshot (latest for the SKU by default). */
    async revertImages(params: { sku: string; snapshotId?: string }) {
      assertSkuAllowed(deps, params.sku);
      const snapshot = params.snapshotId
        ? await getDocument<ListingSnapshot>(
            SCOPE,
            VERSIONS_COLLECTION,
            snapshotDocKey(deps.userId, params.snapshotId)
          )
        : await latestSnapshot(deps.userId, params.sku);
      if (!snapshot || snapshot.userId !== deps.userId) {
        throw new Error(`No snapshot found for SKU ${params.sku}.`);
      }

      const patches: ListingsPatchOperation[] = [];
      for (const slot of IMAGE_SLOT_ATTRIBUTES) {
        const value = snapshot.attributes[slot];
        if (value !== undefined) {
          patches.push({
            op: 'replace',
            path: `/attributes/${slot}`,
            value: value as Array<Record<string, unknown>>,
          });
        } else {
          patches.push({ op: 'delete', path: `/attributes/${slot}` });
        }
      }
      // delete-on-missing only makes sense for slots the listing has now
      const listing = await fetchListing(deps, params.sku);
      const effective = patches.filter(
        (patch) =>
          patch.op !== 'delete' ||
          listing.attributes[patch.path.replace('/attributes/', '')] !==
            undefined
      );
      if (effective.length === 0) {
        return {
          status: 'NOTHING_TO_REVERT',
          issues: [],
          snapshotId: snapshot.snapshotId,
        };
      }

      const result = await deps.spClient.patchListingsItem({
        sku: params.sku,
        sellerId: deps.sellerId,
        productType: snapshot.productType,
        patches: effective,
      });
      return {
        status: result?.status,
        submissionId: result?.submissionId,
        issues: result?.issues ?? [],
        snapshotId: snapshot.snapshotId,
      };
    },

    /** Re-read after a write so the agent can surface Amazon's issues. */
    async checkListing(params: { sku: string }) {
      const listing = await fetchListing(deps, params.sku);
      return { productType: listing.productType, issues: listing.issues };
    },
  };
}

export type SellerListingWritesImpl = ReturnType<typeof createListingWrites>;

async function latestSnapshot(
  userId: string,
  sku: string
): Promise<ListingSnapshot | null> {
  const result = await executeQuery<ListingSnapshot>(
    SCOPE,
    `SELECT RAW v FROM \`${VERSIONS_COLLECTION}\` v
     WHERE v.userId = $userId AND v.sku = $sku
     ORDER BY v.capturedAt DESC
     LIMIT 1`,
    { parameters: { userId, sku } }
  );
  return result.rows[0] ?? null;
}

async function pruneSnapshots(userId: string, sku: string): Promise<void> {
  try {
    await executeQuery(
      SCOPE,
      `DELETE FROM \`${VERSIONS_COLLECTION}\` v
       WHERE v.userId = $userId AND v.sku = $sku
         AND META(v).id NOT IN (
           SELECT RAW META(k).id FROM \`${VERSIONS_COLLECTION}\` k
           WHERE k.userId = $userId AND k.sku = $sku
           ORDER BY k.capturedAt DESC
           LIMIT ${SNAPSHOT_KEEP}
         )`,
      { parameters: { userId, sku } }
    );
  } catch {
    // Pruning is best-effort — snapshots are tiny.
  }
}
