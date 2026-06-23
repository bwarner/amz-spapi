import { deleteAsset, getAsset } from './media-assets';
import {
  listAllAPlusDraftDocs,
  listBrandGuides,
  type APlusDraft,
} from './a-plus-drafts';

/**
 * Reference-aware garbage collection for A+ generated images.
 *
 * Assets are deduped by content hash and can be shared across drafts/brand
 * guides, so we never delete by age — only when nothing references an asset.
 * And we only ever auto-delete *generated* images (filename `generated-*`);
 * user uploads are never removed automatically.
 *
 * Asset ids follow `asset_<uuid>` (see media-assets.createAssetId). Rather than
 * walk every possible nesting in the opaque draft payload, we scan the
 * stringified document for those ids — robust to wherever a slot/library/logo
 * happens to store them.
 */
const ASSET_ID_RE =
  /asset_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** All `asset_*` ids referenced anywhere inside an arbitrary JSON value. */
export function collectAssetIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (value == null) return ids;
  const json = typeof value === 'string' ? value : safeStringify(value);
  for (const match of json.matchAll(ASSET_ID_RE)) ids.add(match[0]);
  return ids;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function draftAssetIds(
  draft: Pick<APlusDraft, 'payload' | 'packageJson'>
): Set<string> {
  const ids = collectAssetIds(draft.payload);
  for (const id of collectAssetIds(draft.packageJson)) ids.add(id);
  return ids;
}

/**
 * The set of asset ids still referenced by any of the user's drafts (optionally
 * excluding one draft) plus brand-guide logos.
 *
 * INVARIANT: A+ drafts (module slots) and brand-guide logos are the ONLY places
 * generated A+ images are referenced. This is what makes age-free GC safe. If a
 * new feature ever references these assets (a published/exported listing, a chat
 * attachment, an ads creative, etc.), it MUST be added to this scan — otherwise
 * cleanup will delete an in-use image. When that happens, prefer moving to real
 * reference-counting on the asset doc over chasing every referencer here.
 */
async function referencedAssetIds(
  userId: string,
  excludeDraftId?: string
): Promise<Set<string>> {
  const [drafts, guides] = await Promise.all([
    listAllAPlusDraftDocs(userId),
    listBrandGuides(userId),
  ]);

  const refs = new Set<string>();
  for (const draft of drafts) {
    if (excludeDraftId && draft.draftId === excludeDraftId) continue;
    for (const id of draftAssetIds(draft)) refs.add(id);
  }
  for (const guide of guides) {
    if (guide.logoAsset?.assetId) refs.add(guide.logoAsset.assetId);
  }
  return refs;
}

/**
 * Delete each candidate asset that (a) is a generated image, (b) belongs to the
 * user, and (c) is referenced by nothing else. Returns the count deleted.
 */
async function gcGeneratedAssets(
  userId: string,
  candidateIds: Iterable<string>,
  excludeDraftId?: string
): Promise<number> {
  const candidates = [...new Set(candidateIds)];
  if (candidates.length === 0) return 0;

  const referenced = await referencedAssetIds(userId, excludeDraftId);

  let deleted = 0;
  for (const assetId of candidates) {
    if (referenced.has(assetId)) continue;
    const asset = await getAsset(assetId);
    if (!asset || asset.userId !== userId) continue;
    // Safety bound: never auto-delete user uploads, only generated images.
    if (!asset.originalFileName.startsWith('generated-')) continue;
    if (await deleteAsset(assetId, userId)) deleted++;
  }
  return deleted;
}

/**
 * On draft save: delete generated images the *previous* version referenced that
 * the *new* version no longer does (e.g. after a slot image was refreshed),
 * provided nothing else still references them. No-op when nothing was dropped,
 * so the common autosave path does zero extra DB work.
 */
export async function cleanupSupersededDraftAssets(params: {
  userId: string;
  draftId: string;
  oldDraft: Pick<APlusDraft, 'payload' | 'packageJson'> | null;
  newPayload: unknown;
  newPackageJson: unknown;
}): Promise<number> {
  if (!params.oldDraft) return 0;

  const oldIds = draftAssetIds(params.oldDraft);
  const newIds = new Set<string>([
    ...collectAssetIds(params.newPayload),
    ...collectAssetIds(params.newPackageJson),
  ]);

  const dropped = [...oldIds].filter((id) => !newIds.has(id));
  if (dropped.length === 0) return 0;

  return gcGeneratedAssets(params.userId, dropped, params.draftId);
}

/**
 * On draft delete: delete the generated images this draft referenced that no
 * other draft/brand-guide references.
 */
export async function cleanupDeletedDraftAssets(params: {
  userId: string;
  draftId: string;
  draft: Pick<APlusDraft, 'payload' | 'packageJson'>;
}): Promise<number> {
  return gcGeneratedAssets(
    params.userId,
    draftAssetIds(params.draft),
    params.draftId
  );
}
