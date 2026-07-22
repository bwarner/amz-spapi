import { auth0 } from '../../../lib/auth0';
import {
  createProductId,
  listProducts,
  upsertProduct,
} from '../../../lib/products';
import {
  createVariantId,
  listAllVariants,
  upsertVariant,
} from '../../../lib/product-variants';
import { listVariantThumbnails } from '../../../lib/product-listings';

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.sub;

  // Products with their variants nested, so the list can show families inline.
  const [products, variants, thumbnails] = await Promise.all([
    listProducts(userId),
    listAllVariants(userId),
    listVariantThumbnails(userId),
  ]);

  const variantsByProduct = new Map<
    string,
    Array<{
      variantId: string;
      title?: string;
      options: { name: string; value: string }[];
      asin?: string;
      imageUrl?: string;
    }>
  >();
  for (const variant of variants) {
    const entry = {
      variantId: variant.variantId,
      title: variant.title,
      options: variant.options ?? [],
      asin: variant.identifiers?.asin,
      imageUrl: thumbnails[variant.variantId],
    };
    const bucket = variantsByProduct.get(variant.productId);
    if (bucket) bucket.push(entry);
    else variantsByProduct.set(variant.productId, [entry]);
  }

  const withVariants = products.map((product) => ({
    ...product,
    variants: variantsByProduct.get(product.productId) ?? [],
  }));

  return Response.json({ products: withVariants });
}

/**
 * Create a product manually (no Amazon required). Always seeds one default
 * variant so downstream is uniformly Product → [Variant] → [Listing].
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.sub;

  let body: {
    title?: unknown;
    brandId?: unknown;
    brandName?: unknown;
    description?: unknown;
    category?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return Response.json(
      { error: 'A product title is required.' },
      { status: 400 }
    );
  }

  const productId = createProductId();
  const product = await upsertProduct({
    productId,
    userId,
    title: body.title.trim(),
    brandId: typeof body.brandId === 'string' ? body.brandId : undefined,
    brandName: typeof body.brandName === 'string' ? body.brandName : undefined,
    description:
      typeof body.description === 'string' ? body.description : undefined,
    category: typeof body.category === 'string' ? body.category : undefined,
    status: 'active',
  });

  const variant = await upsertVariant({
    variantId: createVariantId(),
    productId,
    userId,
    isDefault: true,
    options: [],
  });

  return Response.json({ product, variant }, { status: 201 });
}
