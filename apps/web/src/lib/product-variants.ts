import crypto from 'node:crypto';
import {
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import {
  ProductVariantSchema,
  type ProductVariant,
} from '@farvisionllc/models';

const SCOPE = 'catalog';
const COLLECTION = 'variants';

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

export function createVariantId(): string {
  return `variant_${crypto.randomUUID()}`;
}

function variantDocKey(userId: string, variantId: string): string {
  return `variant::${safeUserPart(userId)}::${variantId}`;
}

/** Variants of a product (default first). */
export async function listVariants(params: {
  userId: string;
  productId: string;
}): Promise<ProductVariant[]> {
  const result = await executeQuery<ProductVariant>(
    SCOPE,
    `SELECT RAW v FROM \`${COLLECTION}\` v
     WHERE v.userId = $userId AND v.productId = $productId
       AND v.\`deleted\` IS MISSING
     ORDER BY v.isDefault DESC, v.title`,
    { parameters: { userId: params.userId, productId: params.productId } }
  );
  return result.rows;
}

/** Every variant for a user, for nesting under products in list views. */
export async function listAllVariants(
  userId: string
): Promise<ProductVariant[]> {
  const result = await executeQuery<ProductVariant>(
    SCOPE,
    `SELECT RAW v FROM \`${COLLECTION}\` v
     WHERE v.userId = $userId AND v.\`deleted\` IS MISSING
     ORDER BY v.isDefault DESC, v.title`,
    { parameters: { userId } }
  );
  return result.rows;
}

export async function getVariant(params: {
  userId: string;
  variantId: string;
}): Promise<ProductVariant | null> {
  const doc = await getDocument<ProductVariant>(
    SCOPE,
    COLLECTION,
    variantDocKey(params.userId, params.variantId)
  );
  if (!doc || doc.deleted || doc.userId !== params.userId) return null;
  return doc;
}

export async function upsertVariant(
  variant: Omit<ProductVariant, 'createdAt' | 'updatedAt'> &
    Partial<Pick<ProductVariant, 'createdAt' | 'updatedAt'>>
): Promise<ProductVariant> {
  const now = Date.now();
  const document = ProductVariantSchema.parse({
    ...variant,
    createdAt: variant.createdAt ?? now,
    updatedAt: now,
  });
  await upsertDocument(
    SCOPE,
    COLLECTION,
    variantDocKey(document.userId, document.variantId),
    document
  );
  return document;
}

export async function deleteVariant(params: {
  userId: string;
  variantId: string;
}): Promise<boolean> {
  const existing = await getVariant(params);
  if (!existing) return false;
  await upsertDocument(
    SCOPE,
    COLLECTION,
    variantDocKey(params.userId, params.variantId),
    { ...existing, deleted: true, updatedAt: Date.now() }
  );
  return true;
}
