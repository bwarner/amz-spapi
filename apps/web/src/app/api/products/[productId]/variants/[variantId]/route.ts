import { auth0 } from '../../../../../../lib/auth0';
import { getProduct } from '../../../../../../lib/products';
import { getVariant } from '../../../../../../lib/product-variants';
import { listListings } from '../../../../../../lib/product-listings';

async function requireUser() {
  const session = await auth0.getSession();
  return session?.user?.sub ?? null;
}

/** A single variant plus its parent product and the variant's listings. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string; variantId: string }> }
) {
  const userId = await requireUser();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { productId, variantId } = await params;
  const [product, variant] = await Promise.all([
    getProduct({ userId, productId }),
    getVariant({ userId, variantId }),
  ]);

  if (!product || !variant || variant.productId !== productId) {
    return Response.json({ error: 'Variant not found.' }, { status: 404 });
  }

  const listings = await listListings({ userId, productId, variantId });
  return Response.json({ product, variant, listings });
}
