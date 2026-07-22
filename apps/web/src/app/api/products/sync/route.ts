import { auth0 } from '../../../../lib/auth0';
import { syncAmazonProducts } from '../../../../lib/product-sync';

/**
 * Pull the connected Amazon (SP-API) account's FBA inventory into the Product
 * spine. Idempotent — safe to re-run; matches listings by seller SKU and only
 * refreshes catalog snapshots, never user-edited Product fields.
 */
export async function POST() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await syncAmazonProducts(session.user.sub);

  if (!summary.connected) {
    // Not an error the user caused — surface as 409 so the UI can prompt them
    // to connect Amazon rather than showing a generic failure.
    return Response.json(summary, { status: 409 });
  }

  return Response.json(summary);
}
