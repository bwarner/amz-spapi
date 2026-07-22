import sharp from 'sharp';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { auth0 } from '../../../../lib/auth0';
import { createAssetS3Client, getAsset } from '../../../../lib/media-assets';

// Exact-dimension asset export for Premium A+ NATIVE modules: the seller
// uploads raw photos into Amazon's image slots, so every download leaves the
// app cover-cropped (center) to the slot's exact pixel dims — zero manual
// cropping in Seller Central. Safe because raw slot photos carry no baked
// text. Designed-image bands export via the module-image route instead.
export const runtime = 'nodejs';
export const maxDuration = 30;

// Sanity bounds: Amazon slots run 300–1464px (VERIFY); reject absurd asks.
const MIN_DIM = 100;
const MAX_DIM = 3000;

export async function GET(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const assetId = url.searchParams.get('assetId');
  const width = Number(url.searchParams.get('width'));
  const height = Number(url.searchParams.get('height'));
  if (
    !assetId ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_DIM ||
    width > MAX_DIM ||
    height < MIN_DIM ||
    height > MAX_DIM
  ) {
    return Response.json(
      { error: 'assetId, width, and height (100–3000) are required.' },
      { status: 400 }
    );
  }

  const asset = await getAsset(assetId);
  if (!asset || asset.userId !== session.user.sub) {
    return Response.json({ error: 'Asset not found.' }, { status: 404 });
  }

  try {
    const s3 = createAssetS3Client();
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: asset.storage.bucket,
        Key: asset.storage.key,
      })
    );
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) {
      return Response.json(
        { error: 'Asset content is unavailable.' },
        { status: 502 }
      );
    }
    // Center-weighted cover crop to the EXACT slot dims. Slot briefs demand
    // the product centered, so edge trim is safe.
    const png = await sharp(Buffer.from(bytes))
      .resize({ width, height, fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

    const baseName = asset.originalFileName.replace(/\.[^.]+$/, '');
    const fileName = `${baseName}-${width}x${height}.png`;
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Asset export failed.';
    console.error(
      `[a-plus-asset-export] FAILED (asset=${assetId}, ${width}x${height}): ${message.slice(
        0,
        300
      )}`
    );
    return Response.json({ error: 'Could not export image.' }, { status: 500 });
  }
}
