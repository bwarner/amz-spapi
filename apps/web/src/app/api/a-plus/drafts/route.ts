import { auth0 } from '../../../../lib/auth0';
import {
  createDraftId,
  getAPlusDraft,
  listAPlusDrafts,
  upsertAPlusDraft,
} from '../../../../lib/a-plus-drafts';
import { cleanupSupersededDraftAssets } from '../../../../lib/a-plus-asset-cleanup';

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const drafts = await listAPlusDrafts(session.user.sub);
  return Response.json({ drafts });
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    draftId?: unknown;
    brandGuideId?: unknown;
    name?: unknown;
    productName?: unknown;
    asin?: unknown;
    contentTier?: unknown;
    payload?: unknown;
    packageJson?: unknown;
  };

  const draftId =
    typeof body.draftId === 'string' && body.draftId
      ? body.draftId
      : createDraftId();
  const existing = await getAPlusDraft({
    userId: session.user.sub,
    draftId,
  });

  const draft = await upsertAPlusDraft({
    draftId,
    userId: session.user.sub,
    brandGuideId:
      typeof body.brandGuideId === 'string' && body.brandGuideId
        ? body.brandGuideId
        : undefined,
    name:
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : 'Untitled A+ draft',
    productName:
      typeof body.productName === 'string' ? body.productName : undefined,
    asin: typeof body.asin === 'string' ? body.asin : undefined,
    contentTier:
      body.contentTier === 'Premium A+' || body.contentTier === 'Basic A+'
        ? body.contentTier
        : undefined,
    payload: body.payload ?? {},
    packageJson: body.packageJson,
    createdAt: existing?.createdAt,
  });

  // Free generated images this save dropped (e.g. a refreshed slot) once
  // nothing else references them. Best-effort: never fail a save on cleanup.
  try {
    await cleanupSupersededDraftAssets({
      userId: session.user.sub,
      draftId,
      oldDraft: existing,
      newPayload: body.payload ?? {},
      newPackageJson: body.packageJson,
    });
  } catch {
    // Swallow — orphaned assets are harmless and get swept on the next save.
  }

  return Response.json({ draft });
}
