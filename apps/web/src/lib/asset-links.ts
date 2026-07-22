import crypto from 'node:crypto';
import {
  deleteDocument,
  executeQuery,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  AssetLinkSchema,
  type AssetLink,
  type AssetOwnerType,
} from '@farvisionllc/models';

const SCOPE = 'media';
const COLLECTION = 'asset_links';

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

/** Deterministic key makes link/unlink idempotent and dedups the (owner,asset) pair. */
function linkDocKey(
  userId: string,
  ownerType: AssetOwnerType,
  ownerId: string,
  assetId: string
): string {
  return `asset-link::${safeUserPart(
    userId
  )}::${ownerType}::${ownerId}::${assetId}`;
}

export async function linkAsset(params: {
  userId: string;
  assetId: string;
  ownerType: AssetOwnerType;
  ownerId: string;
  role?: string;
}): Promise<AssetLink> {
  const document = AssetLinkSchema.parse({
    linkId: `link_${crypto.randomUUID()}`,
    assetId: params.assetId,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    userId: params.userId,
    role: params.role,
    createdAt: Date.now(),
  });
  await upsertDocument(
    SCOPE,
    COLLECTION,
    linkDocKey(params.userId, params.ownerType, params.ownerId, params.assetId),
    document
  );
  return document;
}

export async function unlinkAsset(params: {
  userId: string;
  assetId: string;
  ownerType: AssetOwnerType;
  ownerId: string;
}): Promise<boolean> {
  return deleteDocument(
    SCOPE,
    COLLECTION,
    linkDocKey(params.userId, params.ownerType, params.ownerId, params.assetId)
  );
}

/** All asset ids linked to one owner (product/variant/listing/brand). */
export async function listAssetsForOwner(params: {
  userId: string;
  ownerType: AssetOwnerType;
  ownerId: string;
}): Promise<AssetLink[]> {
  const result = await executeQuery<AssetLink>(
    SCOPE,
    `SELECT RAW l FROM \`${COLLECTION}\` l
     WHERE l.userId = $userId AND l.ownerType = $ownerType AND l.ownerId = $ownerId`,
    { parameters: params }
  );
  return result.rows;
}

/** All owners of one asset — used by GC to know if an asset is still referenced. */
export async function listOwnersOfAsset(params: {
  userId: string;
  assetId: string;
}): Promise<AssetLink[]> {
  const result = await executeQuery<AssetLink>(
    SCOPE,
    `SELECT RAW l FROM \`${COLLECTION}\` l
     WHERE l.userId = $userId AND l.assetId = $assetId`,
    { parameters: params }
  );
  return result.rows;
}

/** Remove all links for an owner (cascade on product/variant/listing delete). */
export async function unlinkAllForOwner(params: {
  userId: string;
  ownerType: AssetOwnerType;
  ownerId: string;
}): Promise<number> {
  const links = await listAssetsForOwner(params);
  let removed = 0;
  for (const link of links) {
    if (
      await deleteDocument(
        SCOPE,
        COLLECTION,
        linkDocKey(params.userId, link.ownerType, link.ownerId, link.assetId)
      )
    ) {
      removed++;
    }
  }
  return removed;
}
