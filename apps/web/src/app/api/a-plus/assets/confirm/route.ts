import { auth0 } from '../../../../../lib/auth0';
import {
  getAsset,
  headAssetObject,
  upsertAsset,
  upsertHashPointer,
} from '../../../../../lib/media-assets';

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { assetId?: unknown };
  if (typeof body.assetId !== 'string') {
    return Response.json({ error: 'assetId is required.' }, { status: 400 });
  }

  try {
    const asset = await getAsset(body.assetId);
    if (!asset || asset.userId !== session.user.sub) {
      return Response.json({ error: 'Asset not found.' }, { status: 404 });
    }

    const head = await headAssetObject(asset);
    const updated = {
      ...asset,
      status: 'uploaded' as const,
      sizeBytes: head.ContentLength || asset.sizeBytes,
      mimeType: head.ContentType || asset.mimeType,
      updatedAt: Date.now(),
    };

    await upsertAsset(updated);
    await upsertHashPointer(updated);

    return Response.json({ asset: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Asset confirmation failed.';
    return Response.json({ error: message }, { status: 500 });
  }
}
