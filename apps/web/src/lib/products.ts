import crypto from 'node:crypto';
import {
  deleteDocument,
  executeQuery,
  getDocument,
  upsertDocument,
} from '@amz-spapi/couchbase-utils';
import { ProductSchema, type Product } from '@farvisionllc/models';

const SCOPE = 'catalog';
const COLLECTION = 'products';

function safeUserPart(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);
}

export function createProductId(): string {
  return `product_${crypto.randomUUID()}`;
}

function productDocKey(userId: string, productId: string): string {
  return `product::${safeUserPart(userId)}::${productId}`;
}

export async function listProducts(userId: string): Promise<Product[]> {
  const result = await executeQuery<Product>(
    SCOPE,
    `SELECT RAW p FROM \`${COLLECTION}\` p
     WHERE p.userId = $userId AND p.\`deleted\` IS MISSING
     ORDER BY p.updatedAt DESC`,
    { parameters: { userId } }
  );
  return result.rows;
}

export async function getProduct(params: {
  userId: string;
  productId: string;
}): Promise<Product | null> {
  const doc = await getDocument<Product>(
    SCOPE,
    COLLECTION,
    productDocKey(params.userId, params.productId)
  );
  if (!doc || doc.deleted || doc.userId !== params.userId) return null;
  return doc;
}

/**
 * Create or replace a product. `productId` is the identity (server-generated on
 * first create). Amazon sync uses this too but must guard user-owned fields
 * (see amazon-product-sync, later phase) — this plain upsert overwrites.
 */
export async function upsertProduct(
  product: Omit<Product, 'createdAt' | 'updatedAt'> &
    Partial<Pick<Product, 'createdAt' | 'updatedAt'>>
): Promise<Product> {
  const now = Date.now();
  const document = ProductSchema.parse({
    ...product,
    createdAt: product.createdAt ?? now,
    updatedAt: now,
  });
  await upsertDocument(
    SCOPE,
    COLLECTION,
    productDocKey(document.userId, document.productId),
    document
  );
  return document;
}

/** Soft-delete (preserves variants/listings/asset-links referencing it). */
export async function deleteProduct(params: {
  userId: string;
  productId: string;
}): Promise<boolean> {
  const existing = await getProduct(params);
  if (!existing) return false;
  await upsertDocument(
    SCOPE,
    COLLECTION,
    productDocKey(params.userId, params.productId),
    { ...existing, deleted: true, updatedAt: Date.now() }
  );
  return true;
}

/** Hard-delete — only for internal cleanup once dependents are gone. */
export async function hardDeleteProduct(params: {
  userId: string;
  productId: string;
}): Promise<boolean> {
  return deleteDocument(
    SCOPE,
    COLLECTION,
    productDocKey(params.userId, params.productId)
  );
}
