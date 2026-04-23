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

export type APlusDraftSummary = {
  draftId: string;
  userId: string;
  brandGuideId?: string;
  name: string;
  productName?: string;
  asin?: string;
  contentTier?: 'Basic A+' | 'Premium A+';
  createdAt: number;
  updatedAt: number;
};

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
  voice?: string;
  logoNotes?: string;
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
  const result = await executeQuery<APlusDraftSummary>(
    SCOPE,
    `SELECT draftId, userId, brandGuideId, name, productName, asin, contentTier, createdAt, updatedAt
     FROM \`${DRAFTS_COLLECTION}\`
     WHERE userId = $userId
     AND \`deleted\` IS MISSING
     ORDER BY updatedAt DESC`,
    { parameters: { userId } }
  );
  return result.rows;
}

export async function getAPlusDraft(params: {
  userId: string;
  draftId: string;
}): Promise<APlusDraft | null> {
  const draft = await getDocument<APlusDraft>(
    SCOPE,
    DRAFTS_COLLECTION,
    draftDocKey(params.userId, params.draftId)
  );
  if (!draft || draft.deleted || draft.userId !== params.userId) return null;
  return draft;
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

export async function listBrandGuides(
  userId: string
): Promise<APlusBrandGuide[]> {
  const result = await executeQuery<APlusBrandGuide>(
    SCOPE,
    `SELECT brandGuideId, userId, name, brandName, colors, voice, logoNotes, createdAt, updatedAt
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
