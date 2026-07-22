import { auth0 } from '../../../../../../lib/auth0';
import {
  createDraftVersion,
  getAPlusDraft,
  listDraftVersions,
  type APlusDraftVersionOrigin,
} from '../../../../../../lib/a-plus-drafts';
import { cleanupDeletedVersionAssets } from '../../../../../../lib/a-plus-asset-cleanup';

// Version snapshots of a design: protective auto-snapshots (pre-generation /
// pre-restore) plus manual checkpoints, so the seller can experiment and
// backtrack.

const ORIGINS: readonly APlusDraftVersionOrigin[] = [
  'pre-generation',
  'pre-restore',
  'manual',
];

/** Summary computed server-side from the snapshot payload, best-effort. */
function summarize(
  payload: unknown,
  name: unknown
): {
  name: string;
  contentTier?: string;
  sectionCount: number;
  score?: number;
} {
  const p = (payload ?? {}) as {
    contentTier?: unknown;
    experience?: { sections?: unknown[] };
    evaluation?: { judge?: unknown };
    productName?: unknown;
  };
  const sectionCount = Array.isArray(p.experience?.sections)
    ? p.experience.sections.length
    : 0;
  // The persisted evaluation carries only the judge; overall score is
  // recomputed live in the editor — surface the quality signal if present.
  let score: number | undefined;
  const judge = p.evaluation?.judge as
    | { dimensions?: Record<string, { score?: unknown }> }
    | undefined;
  if (judge?.dimensions) {
    const scores = Object.values(judge.dimensions)
      .map((dimension) => dimension?.score)
      .filter((value): value is number => typeof value === 'number');
    if (scores.length) {
      score = Math.round(
        scores.reduce((sum, value) => sum + value, 0) / scores.length
      );
    }
  }
  return {
    name:
      (typeof name === 'string' && name.trim()) ||
      (typeof p.productName === 'string' && p.productName.trim()) ||
      'Untitled design',
    contentTier: typeof p.contentTier === 'string' ? p.contentTier : undefined,
    sectionCount,
    score,
  };
}

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
  const versions = await listDraftVersions(session.user.sub, draftId);
  return Response.json({ versions });
}

export async function POST(
  request: Request,
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

  const body = (await request.json().catch(() => ({}))) as {
    payload?: unknown;
    packageJson?: unknown;
    origin?: unknown;
    label?: unknown;
    name?: unknown;
  };
  const origin = ORIGINS.includes(body.origin as APlusDraftVersionOrigin)
    ? (body.origin as APlusDraftVersionOrigin)
    : 'manual';
  const payload = body.payload ?? {};
  // Nothing worth versioning before the first generation.
  if (!(payload as { experience?: unknown }).experience) {
    return Response.json(
      { error: 'Nothing to snapshot yet — generate content first.' },
      { status: 400 }
    );
  }

  const { version, pruned } = await createDraftVersion({
    draftId,
    userId: session.user.sub,
    origin,
    label:
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 120)
        : undefined,
    summary: summarize(payload, body.name ?? draft.name),
    payload,
    packageJson: body.packageJson,
  });

  // Best-effort GC of images only the pruned snapshots referenced.
  for (const prunedVersion of pruned) {
    try {
      await cleanupDeletedVersionAssets({
        userId: session.user.sub,
        version: prunedVersion,
      });
    } catch {
      // Swallow — orphaned assets are harmless and swept on later GCs.
    }
  }

  return Response.json({
    version: {
      versionId: version.versionId,
      draftId: version.draftId,
      createdAt: version.createdAt,
      origin: version.origin,
      label: version.label,
      summary: version.summary,
    },
  });
}
