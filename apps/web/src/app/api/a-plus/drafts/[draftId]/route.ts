import { auth0 } from '../../../../../lib/auth0';
import {
  deleteAPlusDraft,
  deleteDraftVersionsForDraft,
  getAPlusDraft,
} from '../../../../../lib/a-plus-drafts';
import { cleanupDeletedDraftAssets } from '../../../../../lib/a-plus-asset-cleanup';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { draftId } = await params;
  const draft = await getAPlusDraft({ userId: session.user.sub, draftId });
  if (!draft) {
    return Response.json({ error: 'Draft not found.' }, { status: 404 });
  }

  return Response.json({ draft });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { draftId } = await params;
  // Load before deleting so we know which generated images this draft owned.
  const draft = await getAPlusDraft({ userId: session.user.sub, draftId });
  await deleteAPlusDraft({ userId: session.user.sub, draftId });

  // Cascade version snapshots FIRST so their references don't keep the
  // draft's generated images alive during GC.
  let deletedVersions: Awaited<ReturnType<typeof deleteDraftVersionsForDraft>> =
    [];
  try {
    deletedVersions = await deleteDraftVersionsForDraft({
      userId: session.user.sub,
      draftId,
    });
  } catch {
    // Swallow — orphaned versions are invisible (listed per draft) and their
    // assets get swept whenever GC next runs.
  }

  if (draft) {
    // Best-effort: delete generated images no other draft/guide references.
    try {
      await cleanupDeletedDraftAssets({
        userId: session.user.sub,
        draftId,
        draft,
        deletedVersions,
      });
    } catch {
      // Swallow — leftover assets are harmless storage, not a delete failure.
    }
  }

  return Response.json({ ok: true });
}
