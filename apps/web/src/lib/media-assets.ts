import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  deleteDocument,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';

export type MediaAssetFeature = 'a-plus' | 'ads' | 'listings' | 'shared';

export type MediaAssetStatus = 'pending_upload' | 'uploaded' | 'duplicate';

export type MediaAsset = {
  assetId: string;
  userId: string;
  createdForFeature: MediaAssetFeature;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  hashes: {
    sha256: string;
  };
  width?: number;
  height?: number;
  status: MediaAssetStatus;
  storage: {
    provider: 's3';
    bucket: string;
    key: string;
  };
  duplicateOfAssetId?: string;
  createdAt: number;
  updatedAt: number;
};

export type MediaAssetHashPointer = {
  sha256: string;
  userId: string;
  assetId: string;
  createdAt: number;
};

const SCOPE = 'media';
const ASSETS_COLLECTION = 'assets';
const HASHES_COLLECTION = 'asset_hashes';

export function getAssetBucket(): string {
  const bucket =
    process.env['MEDIA_ASSETS_BUCKET'] ||
    process.env['APLUS_ASSETS_BUCKET'] ||
    process.env['S3_ASSETS_BUCKET'] ||
    process.env['AWS_S3_BUCKET'];

  if (!bucket) {
    throw new Error(
      'Media asset storage is not configured. Set MEDIA_ASSETS_BUCKET.'
    );
  }

  return bucket;
}

export function createAssetS3Client(): S3Client {
  return new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
  });
}

export function assetDocKey(assetId: string): string {
  return `asset::${assetId}`;
}

export function hashDocKey(userId: string, sha256: string): string {
  return `sha256::${safeKeyPart(userId)}::${sha256}`;
}

export function safeKeyPart(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function sanitizeFileName(fileName: string): string {
  return (
    fileName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'asset'
  );
}

export function createAssetId(): string {
  return `asset_${crypto.randomUUID()}`;
}

export function createAssetKey(params: {
  userId: string;
  assetId: string;
  fileName: string;
}): string {
  return [
    'users',
    safeKeyPart(params.userId),
    'assets',
    params.assetId,
    `original-${sanitizeFileName(params.fileName)}`,
  ].join('/');
}

export async function getAsset(assetId: string): Promise<MediaAsset | null> {
  return getDocument<MediaAsset>(
    SCOPE,
    ASSETS_COLLECTION,
    assetDocKey(assetId)
  );
}

export async function upsertAsset(asset: MediaAsset): Promise<void> {
  await upsertDocument(
    SCOPE,
    ASSETS_COLLECTION,
    assetDocKey(asset.assetId),
    asset
  );
}

export async function getDuplicateAsset(params: {
  userId: string;
  sha256: string;
}): Promise<MediaAsset | null> {
  const pointer = await getDocument<MediaAssetHashPointer>(
    SCOPE,
    HASHES_COLLECTION,
    hashDocKey(params.userId, params.sha256)
  );

  if (!pointer) return null;

  const asset = await getAsset(pointer.assetId);
  if (!asset || asset.status !== 'uploaded') return null;
  return asset;
}

export async function upsertHashPointer(asset: MediaAsset): Promise<void> {
  await upsertDocument<MediaAssetHashPointer>(
    SCOPE,
    HASHES_COLLECTION,
    hashDocKey(asset.userId, asset.hashes.sha256),
    {
      sha256: asset.hashes.sha256,
      userId: asset.userId,
      assetId: asset.assetId,
      createdAt: Date.now(),
    }
  );
}

export async function headAssetObject(asset: MediaAsset) {
  const client = createAssetS3Client();
  return client.send(
    new HeadObjectCommand({
      Bucket: asset.storage.bucket,
      Key: asset.storage.key,
    })
  );
}

/**
 * Permanently delete an asset: its S3 object, its Couchbase doc, and its
 * sha256 hash pointer (only when the pointer still points at this asset, so a
 * later asset that re-deduped onto the same hash isn't orphaned).
 *
 * Best-effort on S3: if the object delete fails we still remove the DB records
 * so the asset stops appearing/serving. Callers are responsible for ensuring
 * the asset is unreferenced before calling this — see a-plus-asset-cleanup.
 *
 * `userId` is required and enforced here (defense in depth): an asset is never
 * deleted unless it belongs to the caller, so a future caller can't turn this
 * into an IDOR delete by omitting the ownership check.
 */
export async function deleteAsset(
  assetId: string,
  userId: string
): Promise<boolean> {
  const asset = await getAsset(assetId);
  if (!asset || asset.userId !== userId) return false;

  try {
    await createAssetS3Client().send(
      new DeleteObjectCommand({
        Bucket: asset.storage.bucket,
        Key: asset.storage.key,
      })
    );
  } catch {
    // Object may already be gone; continue removing the DB records.
  }

  await deleteDocument(SCOPE, ASSETS_COLLECTION, assetDocKey(assetId));

  const pointerKey = hashDocKey(asset.userId, asset.hashes.sha256);
  const pointer = await getDocument<MediaAssetHashPointer>(
    SCOPE,
    HASHES_COLLECTION,
    pointerKey
  );
  if (pointer?.assetId === assetId) {
    await deleteDocument(SCOPE, HASHES_COLLECTION, pointerKey);
  }

  return true;
}
