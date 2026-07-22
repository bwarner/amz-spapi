import crypto from 'node:crypto';
import {
  deleteDocument,
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';

const SCOPE = 'a_plus';
const DRAFTS_COLLECTION = 'drafts';
const BRAND_GUIDES_COLLECTION = 'brand_guides';
const DRAFT_VERSIONS_COLLECTION = 'draft_versions';

/** Newest versions kept per draft; older ones are pruned on snapshot create. */
export const DRAFT_VERSION_RETENTION = 20;

export type APlusDraftSummary = {
  draftId: string;
  userId: string;
  brandGuideId?: string;
  name: string;
  productName?: string;
  /**
   * ASINs this design deploys to (first = primary, used for catalog lookups).
   * One A+ content document applies to MANY ASINs (e.g. a variation family).
   */
  asins?: string[];
  contentTier?: 'Basic A+' | 'Premium A+';
  createdAt: number;
  updatedAt: number;
};

/** One-way conversion: legacy single-`asin` docs read as an `asins` list. */
function normalizeDraftAsins<T extends { asins?: string[]; asin?: string }>(
  doc: T
): Omit<T, 'asin'> {
  const { asin, ...rest } = doc;
  if (!rest.asins && asin?.trim()) {
    (rest as { asins?: string[] }).asins = [asin.trim()];
  }
  return rest;
}

export type APlusDraft = APlusDraftSummary & {
  payload: unknown;
  packageJson?: unknown;
  deleted?: boolean;
};

export type APlusBrandGuide = {
  brandGuideId: string;
  userId: string;
  name: string;
  brandName?: string;
  colors?: string;
  palette?: {
    primaryForeground?: string;
    secondaryForeground?: string;
    background?: string;
  };
  fonts?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  voice?: string;
  logoAsset?: {
    assetId: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    storage: {
      provider: 's3';
      bucket: string;
      key: string;
    };
  };
  logoNotes?: string;
  styleGuideFiles?: Array<{
    name: string;
    mimeType: string;
    sizeBytes: number;
    lastModified: number;
  }>;
  styleGuideLinks?: string[];
  styleGuideNotes?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
};

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

export function createDraftId(): string {
  return `draft_${crypto.randomUUID()}`;
}

export function createBrandGuideId(): string {
  return `brand_${crypto.randomUUID()}`;
}

function draftDocKey(userId: string, draftId: string): string {
  return `draft::${safeUserPart(userId)}::${draftId}`;
}

function brandGuideDocKey(userId: string, brandGuideId: string): string {
  return `brand-guide::${safeUserPart(userId)}::${brandGuideId}`;
}

export async function listAPlusDrafts(
  userId: string
): Promise<APlusDraftSummary[]> {
  const result = await executeQuery<APlusDraftSummary & { asin?: string }>(
    SCOPE,
    `SELECT draftId, userId, brandGuideId, name, productName, asin, asins, contentTier, createdAt, updatedAt
     FROM \`${DRAFTS_COLLECTION}\`
     WHERE userId = $userId
     AND \`deleted\` IS MISSING
     ORDER BY updatedAt DESC`,
    { parameters: { userId } }
  );
  return result.rows.map(normalizeDraftAsins);
}

/**
 * Full draft documents (incl. `payload` + `packageJson`) for one user — used by
 * asset cleanup to scan for which assets are still referenced. Heavier than
 * {@link listAPlusDrafts}; call only when you need the whole payload.
 */
export async function listAllAPlusDraftDocs(
  userId: string
): Promise<APlusDraft[]> {
  const result = await executeQuery<APlusDraft>(
    SCOPE,
    `SELECT RAW d
     FROM \`${DRAFTS_COLLECTION}\` d
     WHERE d.userId = $userId
     AND d.\`deleted\` IS MISSING`,
    { parameters: { userId } }
  );
  return result.rows;
}

export async function getAPlusDraft(params: {
  userId: string;
  draftId: string;
}): Promise<APlusDraft | null> {
  const draft = await getDocument<APlusDraft & { asin?: string }>(
    SCOPE,
    DRAFTS_COLLECTION,
    draftDocKey(params.userId, params.draftId)
  );
  if (!draft || draft.deleted || draft.userId !== params.userId) return null;
  return normalizeDraftAsins(draft);
}

export async function upsertAPlusDraft(
  draft: Omit<APlusDraft, 'createdAt' | 'updatedAt'> &
    Partial<Pick<APlusDraft, 'createdAt' | 'updatedAt'>>
): Promise<APlusDraft> {
  const now = Date.now();
  const document: APlusDraft = {
    ...draft,
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
  };
  await upsertDocument(
    SCOPE,
    DRAFTS_COLLECTION,
    draftDocKey(document.userId, document.draftId),
    document
  );
  return document;
}

export async function deleteAPlusDraft(params: {
  userId: string;
  draftId: string;
}): Promise<boolean> {
  return deleteDocument(
    SCOPE,
    DRAFTS_COLLECTION,
    draftDocKey(params.userId, params.draftId)
  );
}

// ------------------------------ Draft versions -------------------------------
// Protective snapshots of a design so the seller can experiment and backtrack:
// taken right before a generation overwrites content, before a restore, or
// manually. Append-only docs, pruned to DRAFT_VERSION_RETENTION per draft.

export type APlusDraftVersionOrigin =
  | 'pre-generation'
  | 'pre-restore'
  | 'manual';

export type APlusDraftVersionSummary = {
  versionId: string;
  draftId: string;
  userId: string;
  createdAt: number;
  origin: APlusDraftVersionOrigin;
  label?: string;
  summary: {
    name: string;
    contentTier?: string;
    sectionCount: number;
    /** Overall evaluation score at snapshot time, when one existed. */
    score?: number;
  };
};

export type APlusDraftVersion = APlusDraftVersionSummary & {
  payload: unknown;
  packageJson?: unknown;
};

export function createVersionId(): string {
  return `ver_${crypto.randomUUID()}`;
}

function versionDocKey(
  userId: string,
  draftId: string,
  versionId: string
): string {
  return `draft-version::${safeUserPart(userId)}::${draftId}::${versionId}`;
}

const VERSION_SUMMARY_FIELDS =
  'versionId, draftId, userId, createdAt, origin, label, summary';

/** Version summaries for one draft, newest first (payloads excluded). */
export async function listDraftVersions(
  userId: string,
  draftId: string
): Promise<APlusDraftVersionSummary[]> {
  const result = await executeQuery<APlusDraftVersionSummary>(
    SCOPE,
    `SELECT ${VERSION_SUMMARY_FIELDS}
     FROM \`${DRAFT_VERSIONS_COLLECTION}\`
     WHERE userId = $userId AND draftId = $draftId
     ORDER BY createdAt DESC`,
    { parameters: { userId, draftId } }
  );
  return result.rows;
}

export async function getDraftVersion(params: {
  userId: string;
  draftId: string;
  versionId: string;
}): Promise<APlusDraftVersion | null> {
  const version = await getDocument<APlusDraftVersion>(
    SCOPE,
    DRAFT_VERSIONS_COLLECTION,
    versionDocKey(params.userId, params.draftId, params.versionId)
  );
  if (
    !version ||
    version.userId !== params.userId ||
    version.draftId !== params.draftId
  ) {
    return null;
  }
  return version;
}

/**
 * Stores a snapshot and prunes the draft down to DRAFT_VERSION_RETENTION.
 * Returns the pruned FULL docs so the caller can GC their now-orphaned
 * generated images.
 */
export async function createDraftVersion(
  version: Omit<APlusDraftVersion, 'versionId' | 'createdAt'>
): Promise<{ version: APlusDraftVersion; pruned: APlusDraftVersion[] }> {
  const document: APlusDraftVersion = {
    ...version,
    versionId: createVersionId(),
    createdAt: Date.now(),
  };
  await upsertDocument(
    SCOPE,
    DRAFT_VERSIONS_COLLECTION,
    versionDocKey(document.userId, document.draftId, document.versionId),
    document
  );

  const all = await listDraftVersions(document.userId, document.draftId);
  const excess = all.slice(DRAFT_VERSION_RETENTION);
  const pruned: APlusDraftVersion[] = [];
  for (const summary of excess) {
    const full = await getDraftVersion({
      userId: document.userId,
      draftId: document.draftId,
      versionId: summary.versionId,
    });
    await deleteDocument(
      SCOPE,
      DRAFT_VERSIONS_COLLECTION,
      versionDocKey(document.userId, document.draftId, summary.versionId)
    );
    if (full) pruned.push(full);
  }
  return { version: document, pruned };
}

export async function deleteDraftVersion(params: {
  userId: string;
  draftId: string;
  versionId: string;
}): Promise<boolean> {
  return deleteDocument(
    SCOPE,
    DRAFT_VERSIONS_COLLECTION,
    versionDocKey(params.userId, params.draftId, params.versionId)
  );
}

/**
 * Full version docs across ALL the user's drafts — the asset GC scans these so
 * snapshotted images stay referenced (see a-plus-asset-cleanup INVARIANT).
 */
export async function listAllDraftVersionDocs(
  userId: string
): Promise<APlusDraftVersion[]> {
  const result = await executeQuery<APlusDraftVersion>(
    SCOPE,
    `SELECT RAW v
     FROM \`${DRAFT_VERSIONS_COLLECTION}\` v
     WHERE v.userId = $userId`,
    { parameters: { userId } }
  );
  return result.rows;
}

/** Deletes every version of a draft (draft-deletion cascade). Returns them. */
export async function deleteDraftVersionsForDraft(params: {
  userId: string;
  draftId: string;
}): Promise<APlusDraftVersion[]> {
  const summaries = await listDraftVersions(params.userId, params.draftId);
  const removed: APlusDraftVersion[] = [];
  for (const summary of summaries) {
    const full = await getDraftVersion({
      ...params,
      versionId: summary.versionId,
    });
    await deleteDocument(
      SCOPE,
      DRAFT_VERSIONS_COLLECTION,
      versionDocKey(params.userId, params.draftId, summary.versionId)
    );
    if (full) removed.push(full);
  }
  return removed;
}

export async function listBrandGuides(
  userId: string
): Promise<APlusBrandGuide[]> {
  const result = await executeQuery<APlusBrandGuide>(
    SCOPE,
    `SELECT brandGuideId, userId, name, brandName, colors, palette, fonts, voice, logoAsset, logoNotes, styleGuideFiles, styleGuideLinks, styleGuideNotes, createdAt, updatedAt
     FROM \`${BRAND_GUIDES_COLLECTION}\`
     WHERE userId = $userId
     AND \`deleted\` IS MISSING
     ORDER BY updatedAt DESC`,
    { parameters: { userId } }
  );
  return result.rows;
}

export async function getBrandGuide(params: {
  userId: string;
  brandGuideId: string;
}): Promise<APlusBrandGuide | null> {
  const guide = await getDocument<APlusBrandGuide>(
    SCOPE,
    BRAND_GUIDES_COLLECTION,
    brandGuideDocKey(params.userId, params.brandGuideId)
  );
  if (!guide || guide.deleted || guide.userId !== params.userId) return null;
  return guide;
}

export async function upsertBrandGuide(
  guide: Omit<APlusBrandGuide, 'createdAt' | 'updatedAt'> &
    Partial<Pick<APlusBrandGuide, 'createdAt' | 'updatedAt'>>
): Promise<APlusBrandGuide> {
  const now = Date.now();
  const document: APlusBrandGuide = {
    ...guide,
    createdAt: guide.createdAt ?? now,
    updatedAt: now,
  };
  await upsertDocument(
    SCOPE,
    BRAND_GUIDES_COLLECTION,
    brandGuideDocKey(document.userId, document.brandGuideId),
    document
  );
  return document;
}
