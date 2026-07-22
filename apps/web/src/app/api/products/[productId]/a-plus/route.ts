import { auth0 } from '../../../../../lib/auth0';
import { getProduct } from '../../../../../lib/products';
import { listListings } from '../../../../../lib/product-listings';
import {
  createDraftId,
  upsertAPlusDraft,
} from '../../../../../lib/a-plus-drafts';

/**
 * Seed a new A+ draft from a product and its primary Amazon listing. Prefills
 * the brief (name, ASIN, bullets → key features, description → notes) so the
 * editor opens ready to go. If the product has a brand guide assigned
 * (`brandId`), it is linked so the editor auto-pulls the brand's colors/voice.
 * Deliberately omits price — price/promo claims are disallowed in A+.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.sub;
  const { productId } = await params;

  const product = await getProduct({ userId, productId });
  if (!product) {
    return Response.json({ error: 'Product not found.' }, { status: 404 });
  }

  const listings = await listListings({ userId, productId });
  // Prefer a listing that actually has catalog data, then an active one.
  const primary =
    listings.find((listing) => listing.snapshot?.title) ??
    listings.find((listing) => listing.status === 'active') ??
    listings[0];

  const productName = primary?.snapshot?.title || product.title;
  const asin = primary?.external?.asin;
  const keyFeatures = (primary?.snapshot?.bulletPoints ?? []).join('\n');

  const draftId = createDraftId();
  const draft = await upsertAPlusDraft({
    draftId,
    userId,
    brandGuideId: product.brandId || undefined,
    name: productName,
    productName,
    asin,
    contentTier: 'Basic A+',
    payload: {
      builderMode: 'simple',
      wizardStep: 'basics',
      productName,
      asin,
      contentTier: 'Basic A+',
      keyFeatures: keyFeatures || undefined,
      rawNotes: product.description || undefined,
    },
  });

  return Response.json({ draftId: draft.draftId }, { status: 201 });
}
