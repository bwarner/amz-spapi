import { auth0 } from '../../../../../lib/auth0';
import { resyncProductSnapshots } from '../../../../../lib/product-sync';

/**
 * Refresh one product's Amazon catalog snapshots (no full inventory walk).
 * Idempotent; leaves user-edited Product fields untouched.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { productId } = await params;
  const summary = await resyncProductSnapshots(session.user.sub, productId);

  if (!summary.connected) {
    return Response.json(summary, { status: 409 });
  }

  return Response.json(summary);
}
