import crypto from 'node:crypto';
import { awsCredentials } from './aws-credentials';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  collectionName,
  deleteDocument,
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';

export type MediaAssetFeature =
  | 'a-plus'
  | 'ads'
  | 'listings'
  | 'shared'
  /** Invoices, receipts, customs paperwork — evidence, not creative. */
  | 'documents';

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
    // Undefined locally, so the SDK uses the SSO profile; on Vercel this is the
    // OIDC-assumed role, because there is no credential there to find (#11).
    credentials: awsCredentials(),
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

/**
 * One user's assets, newest first.
 *
 * The only listing there has ever been on this collection — everything else
 * reads an asset the caller already had the id of, which is why a seller could
 * upload thirty files and have no way to see them. Backed by
 * `idx_assets_user_created`; there is no primary index on this cluster
 * (ADR-0004), so the `userId` leading key is required, not merely faster.
 *
 * Ordered by `createdAt`, unlike `listDocuments`, which orders by the date on
 * the document. This list answers "what did I upload", and for that the upload
 * time IS the answer.
 */
export async function listAssets(params: {
  userId: string;
  /** Narrow to one feature's uploads — `documents` for the file manager. */
  feature?: MediaAssetFeature;
  limit?: number;
}): Promise<MediaAsset[]> {
  if (!params.userId) return [];

  const conditions = ['d.`userId` = $userId', "d.`status` != 'pending_upload'"];
  const parameters: Record<string, unknown> = {
    userId: params.userId,
    limit: params.limit ?? 500,
  };
  if (params.feature) {
    conditions.push('d.`createdForFeature` = $feature');
    parameters['feature'] = params.feature;
  }

  const { rows } = await executeQuery<MediaAsset>(
    SCOPE,
    `SELECT RAW d FROM \`${collectionName(SCOPE, ASSETS_COLLECTION)}\` AS d
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.\`createdAt\` DESC
      LIMIT $limit`,
    { parameters, readonly: true }
  );
  return rows;
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

export function extensionForMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  // Falling through to 'png' for every unknown type meant a PDF invoice was
  // stored as invoice.png — harmless to S3, confusing to every human and tool
  // that later opens it.
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  if (mime.includes('tiff')) return 'tiff';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('zip')) return 'zip';
  if (mime.includes('illustrator')) return 'ai';
  if (mime.includes('postscript')) return 'eps';
  return 'png';
}

/**
 * Read an asset's bytes from S3 — ownership-checked, so callers can pass
 * untrusted asset ids (e.g. from model tool calls).
 */
export async function loadAssetBytes(params: {
  userId: string;
  assetId: string;
}): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const asset = await getAsset(params.assetId);
  if (
    !asset ||
    asset.userId !== params.userId ||
    asset.status === 'pending_upload'
  ) {
    return null;
  }
  const client = createAssetS3Client();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: asset.storage.bucket,
      Key: asset.storage.key,
    })
  );
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) return null;
  return { bytes, mimeType: asset.mimeType };
}

/**
 * Persist generated bytes (image, zip, …) as an uploaded asset, deduped by
 * content hash. The `generated-` file-name prefix marks it eligible for
 * asset GC (user uploads are never collected).
 */
/**
 * Custom S3 object metadata, so an object is self-describing without the DB.
 *
 * Couchbase stays the source of truth — this exists so the BUCKET can be
 * reconciled against it (orphans from failed confirms, docs whose object is
 * gone) and so a lost DB could be rebuilt from the objects. It is also what S3
 * Metadata's `user_metadata` column would expose if those tables get enabled.
 *
 * Only immutable facts belong here: object metadata cannot be changed without
 * copying the object, so mutable state (status, links) would silently go stale.
 * `userId` adds no new exposure — it is already a path segment in the key.
 *
 * Values must be US-ASCII and the whole set is capped at 2KB by S3.
 */
function assetObjectMetadata(fields: {
  assetId: string;
  userId: string;
  feature: string;
  sha256?: string;
}): Record<string, string> {
  const clean = (value: string) =>
    value.replace(/[^\x20-\x7E]/g, '').slice(0, 256);
  return {
    assetId: clean(fields.assetId),
    userId: clean(fields.userId),
    feature: clean(fields.feature),
    ...(fields.sha256 ? { sha256: clean(fields.sha256) } : {}),
  };
}

export async function persistGeneratedFileAsset(params: {
  userId: string;
  bytes: Buffer;
  mimeType: string;
  extension: string;
  feature?: MediaAssetFeature;
  /**
   * The name the seller's file already had. Pass it for anything a HUMAN
   * uploaded; omit it for bytes this app generated.
   *
   * Two things follow from it, and both are why it is worth threading through.
   * `invoice-8821.pdf` is what the file manager has to show — `generated-
   * asset_9f3c….pdf` is not a name anyone can find a document by, and it is
   * also a recognition signal in its own right, so re-reading a stored file
   * classified it worse than the upload that stored it did. And the
   * `generated-` prefix is precisely what marks an asset collectable
   * (`a-plus-asset-cleanup`), so a real name is also what keeps an uploaded
   * invoice out of GC's reach.
   */
  originalFileName?: string;
}): Promise<MediaAsset> {
  const sha256 = crypto.createHash('sha256').update(params.bytes).digest('hex');

  const existing = await getDuplicateAsset({ userId: params.userId, sha256 });
  if (existing) {
    // Re-uploading a file we already hold under a generated name is the repair
    // for one stored before names were kept: adopt the name now that we know
    // it, rather than returning a record the seller cannot identify.
    if (
      params.originalFileName &&
      existing.originalFileName.startsWith('generated-')
    ) {
      const renamed: MediaAsset = {
        ...existing,
        originalFileName: params.originalFileName,
        updatedAt: Date.now(),
      };
      await upsertAsset(renamed);
      return renamed;
    }
    return existing;
  }

  const assetId = createAssetId();
  const fileName =
    params.originalFileName || `generated-${assetId}.${params.extension}`;
  const bucket = getAssetBucket();
  const key = createAssetKey({ userId: params.userId, assetId, fileName });
  const client = createAssetS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      // Parity with the presigned upload path, which has always tagged objects
      // with sha256/originalFileName — generated assets were the blind spot.
      Metadata: assetObjectMetadata({
        assetId,
        userId: params.userId,
        feature: params.feature ?? 'a-plus',
        sha256,
      }),
    })
  );
  const now = Date.now();
  const asset: MediaAsset = {
    assetId,
    userId: params.userId,
    createdForFeature: params.feature ?? 'a-plus',
    originalFileName: fileName,
    mimeType: params.mimeType,
    sizeBytes: params.bytes.byteLength,
    hashes: { sha256 },
    status: 'uploaded',
    storage: { provider: 's3', bucket, key },
    createdAt: now,
    updatedAt: now,
  };
  await Promise.all([upsertAsset(asset), upsertHashPointer(asset)]);
  return asset;
}

/**
 * Persist a generated image (data URL) as an uploaded asset — thin wrapper
 * over persistGeneratedFileAsset.
 */
export async function persistGeneratedImageAsset(params: {
  userId: string;
  dataUrl: string;
  feature?: MediaAssetFeature;
}): Promise<MediaAsset> {
  const match = params.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Image generator did not return decodable image bytes.');
  }
  const mimeType = match[1] || 'image/png';
  return persistGeneratedFileAsset({
    userId: params.userId,
    bytes: Buffer.from(match[2], 'base64'),
    mimeType,
    extension: extensionForMime(mimeType),
    feature: params.feature,
  });
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
