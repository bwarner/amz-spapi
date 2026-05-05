import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { auth0 } from '../../../../../lib/auth0';
import {
  MediaAsset,
  createAssetId,
  createAssetKey,
  createAssetS3Client,
  getAssetBucket,
  getDuplicateAsset,
  upsertAsset,
} from '../../../../../lib/media-assets';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function normalizeAssetPreflightError(error: unknown) {
  const message =
    error instanceof Error ? error.message : 'Asset preflight failed.';

  if (
    message.includes('Token is expired') ||
    message.includes('aws sso login') ||
    message.includes('SSO session')
  ) {
    return {
      status: 503,
      code: 'aws_credentials_expired',
      message:
        'Media storage needs a fresh AWS session before uploads can continue.',
      action: 'Run aws sso login with the configured AWS profile, then retry.',
    };
  }

  if (
    message.includes('Media asset storage is not configured') ||
    message.includes('MEDIA_ASSETS_BUCKET')
  ) {
    return {
      status: 503,
      code: 'media_storage_not_configured',
      message: 'Media storage is not configured for this environment.',
      action: 'Set MEDIA_ASSETS_BUCKET and redeploy or restart the server.',
    };
  }

  return {
    status: 500,
    code: 'asset_preflight_failed',
    message: 'Could not prepare this image for upload.',
    action:
      'Retry the upload. If it fails again, check the media storage logs.',
  };
}

function isValidSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    fileName?: unknown;
    mimeType?: unknown;
    sizeBytes?: unknown;
    sha256?: unknown;
  };

  if (
    typeof body.fileName !== 'string' ||
    typeof body.mimeType !== 'string' ||
    typeof body.sizeBytes !== 'number' ||
    !isValidSha256(body.sha256)
  ) {
    return Response.json({ error: 'Invalid asset metadata.' }, { status: 400 });
  }

  if (!body.mimeType.startsWith('image/')) {
    return Response.json(
      { error: 'Only image files are supported.' },
      { status: 400 }
    );
  }

  if (body.sizeBytes <= 0 || body.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return Response.json(
      { error: 'Image must be between 1 byte and 25 MB.' },
      { status: 400 }
    );
  }

  try {
    const duplicate = await getDuplicateAsset({
      userId: session.user.sub,
      sha256: body.sha256.toLowerCase(),
    });

    if (duplicate) {
      return Response.json({
        duplicate: true,
        asset: duplicate,
      });
    }

    const bucket = getAssetBucket();
    const assetId = createAssetId();
    const key = createAssetKey({
      userId: session.user.sub,
      assetId,
      fileName: body.fileName,
    });
    const now = Date.now();
    const asset: MediaAsset = {
      assetId,
      userId: session.user.sub,
      createdForFeature: 'a-plus',
      originalFileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      hashes: {
        sha256: body.sha256.toLowerCase(),
      },
      status: 'pending_upload',
      storage: {
        provider: 's3',
        bucket,
        key,
      },
      createdAt: now,
      updatedAt: now,
    };

    await upsertAsset(asset);

    const uploadUrl = await getSignedUrl(
      createAssetS3Client(),
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: body.mimeType,
        Metadata: {
          sha256: body.sha256.toLowerCase(),
          originalFileName: encodeURIComponent(body.fileName),
        },
      }),
      { expiresIn: 10 * 60 }
    );

    return Response.json({
      duplicate: false,
      asset,
      upload: {
        method: 'PUT',
        url: uploadUrl,
        headers: {
          'Content-Type': body.mimeType,
        },
      },
    });
  } catch (error) {
    const normalized = normalizeAssetPreflightError(error);
    return Response.json(
      {
        error: normalized.message,
        code: normalized.code,
        action: normalized.action,
      },
      { status: normalized.status }
    );
  }
}
