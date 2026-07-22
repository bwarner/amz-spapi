import { auth0 } from '../../../../../../../lib/auth0';
import {
  deleteDraftVersion,
  getDraftVersion,
} from '../../../../../../../lib/a-plus-drafts';
import { cleanupDeletedVersionAssets } from '../../../../../../../lib/a-plus-asset-cleanup';

type RouteParams = { params: Promise<{ draftId: string; versionId: string }> };

/** Full version (payload included) — fetched by the editor on restore. */
export async function GET(_request: Request, { params }: RouteParams) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { draftId, versionId } = await params;
  const version = await getDraftVersion({
    userId: session.user.sub,
    draftId,
    versionId,
  });
  if (!version) {
    return Response.json({ error: 'Version not found.' }, { status: 404 });
  }
  return Response.json({ version });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { draftId, versionId } = await params;
  // Load first so we can GC the images only this snapshot referenced.
  const version = await getDraftVersion({
    userId: session.user.sub,
    draftId,
    versionId,
  });
  if (!version) {
    return Response.json({ error: 'Version not found.' }, { status: 404 });
  }
  await deleteDraftVersion({ userId: session.user.sub, draftId, versionId });
  try {
    await cleanupDeletedVersionAssets({ userId: session.user.sub, version });
  } catch {
    // Swallow — leftover assets are harmless storage, not a delete failure.
  }
  return Response.json({ ok: true });
}
