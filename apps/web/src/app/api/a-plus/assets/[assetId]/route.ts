import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { auth0 } from '../../../../../lib/auth0';
import { createAssetS3Client, getAsset } from '../../../../../lib/media-assets';

const SIGNED_URL_TTL_SECONDS = 300;
const BROWSER_CACHE_SECONDS = 240;

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
