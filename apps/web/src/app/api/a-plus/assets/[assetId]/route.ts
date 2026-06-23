import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { auth0 } from '../../../../../lib/auth0';
import { createAssetS3Client, getAsset } from '../../../../../lib/media-assets';

// sharp requires the Node runtime.
export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;
const BROWSER_CACHE_SECONDS = 240;
// Thumbnails are immutable per asset id, so cache them hard.
const THUMB_CACHE_SECONDS = 60 * 60 * 24 * 30;
const MIN_THUMB_WIDTH = 16;
const MAX_THUMB_WIDTH = 1024;

function parseThumbWidth(value: string | null): number | null {
  if (!value) return null;
  const width = Number.parseInt(value, 10);
  if (!Number.isFinite(width)) return null;
  return Math.min(MAX_THUMB_WIDTH, Math.max(MIN_THUMB_WIDTH, width));
}

function sanitizeDownloadName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\r\n"]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId } = await context.params;
  if (!assetId) {
    return Response.json({ error: 'assetId is required.' }, { status: 400 });
  }

  let asset;
  try {
    asset = await getAsset(assetId);
  } catch {
    return Response.json({ error: 'Asset lookup failed.' }, { status: 500 });
  }

  if (!asset || asset.userId !== session.user.sub) {
    return Response.json({ error: 'Asset not found.' }, { status: 404 });
  }

  if (asset.status !== 'uploaded') {
    return Response.json(
      { error: 'Asset is not ready for preview.' },
      { status: 409 }
    );
  }

  const url = new URL(request.url);

  // Thumbnail path: `?w=<px>` streams a server-resized PNG (cheap, cacheable)
  // instead of redirecting to the full-resolution original. Any failure falls
  // through to the full-res signed-URL path below so previews still work.
  const thumbWidth = parseThumbWidth(url.searchParams.get('w'));
  if (thumbWidth) {
    try {
      const object = await createAssetS3Client().send(
        new GetObjectCommand({
          Bucket: asset.storage.bucket,
          Key: asset.storage.key,
        })
      );
      const bytes = await object.Body?.transformToByteArray();
      if (bytes) {
        const png = await sharp(Buffer.from(bytes), { density: 240 })
          .resize({
            width: thumbWidth,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        return new Response(new Uint8Array(png), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': `private, max-age=${THUMB_CACHE_SECONDS}, immutable`,
          },
        });
      }
    } catch {
      // Fall through to the full-resolution signed URL below.
    }
  }

  const download = url.searchParams.get('download') === '1';
  const requestedName = url.searchParams.get('filename') || '';
  const downloadName = download
    ? sanitizeDownloadName(requestedName, asset.originalFileName)
    : undefined;

  const client = createAssetS3Client();
  const signed = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: asset.storage.bucket,
      Key: asset.storage.key,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName}"`
        : undefined,
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS }
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed,
      'Cache-Control': download
        ? 'no-store'
        : `private, max-age=${BROWSER_CACHE_SECONDS}`,
    },
  });
}
