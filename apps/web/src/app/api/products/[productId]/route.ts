import { auth0 } from '../../../../lib/auth0';
import {
  deleteProduct,
  getProduct,
  upsertProduct,
} from '../../../../lib/products';
import { deleteVariant, listVariants } from '../../../../lib/product-variants';
import { deleteListing, listListings } from '../../../../lib/product-listings';
import { unlinkAllForOwner } from '../../../../lib/asset-links';

async function requireUser() {
  const session = await auth0.getSession();
  return session?.user?.sub ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const userId = await requireUser();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { productId } = await params;
  const product = await getProduct({ userId, productId });
  if (!product) {
    return Response.json({ error: 'Product not found.' }, { status: 404 });
  }
  const [variants, listings] = await Promise.all([
    listVariants({ userId, productId }),
    listListings({ userId, productId }),
  ]);
  return Response.json({ product, variants, listings });
}

/** Update user-owned Product fields (never touches listing snapshots). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const userId = await requireUser();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { productId } = await params;
  const existing = await getProduct({ userId, productId });
  if (!existing) {
    return Response.json({ error: 'Product not found.' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const pickString = (k: string) =>
    typeof body[k] === 'string' ? (body[k] as string) : undefined;

  const product = await upsertProduct({
    ...existing,
    title: pickString('title') ?? existing.title,
    brandId: 'brandId' in body ? pickString('brandId') : existing.brandId,
    brandName:
      'brandName' in body ? pickString('brandName') : existing.brandName,
    description:
      'description' in body ? pickString('description') : existing.description,
    category: 'category' in body ? pickString('category') : existing.category,
    status:
      body['status'] === 'active' ||
      body['status'] === 'archived' ||
      body['status'] === 'draft'
        ? body['status']
        : existing.status,
    tags: Array.isArray(body['tags'])
      ? (body['tags'] as string[])
      : existing.tags,
  });
  return Response.json({ product });
}

/** Soft-delete the product and cascade to its variants, listings, asset links. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const userId = await requireUser();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { productId } = await params;
  const product = await getProduct({ userId, productId });
  if (!product) {
    return Response.json({ error: 'Product not found.' }, { status: 404 });
  }

  const [variants, listings] = await Promise.all([
    listVariants({ userId, productId }),
    listListings({ userId, productId }),
  ]);

  await Promise.all([
    deleteProduct({ userId, productId }),
    unlinkAllForOwner({ userId, ownerType: 'product', ownerId: productId }),
    ...variants.flatMap((v) => [
      deleteVariant({ userId, variantId: v.variantId }),
      unlinkAllForOwner({ userId, ownerType: 'variant', ownerId: v.variantId }),
    ]),
    ...listings.flatMap((l) => [
      deleteListing({ userId, listingId: l.listingId }),
      unlinkAllForOwner({ userId, ownerType: 'listing', ownerId: l.listingId }),
    ]),
  ]);

  return Response.json({ ok: true });
}
