import { denyIfWithoutAccess } from '../../../lib/access';
import { auth0 } from '../../../lib/auth0';
import { loadShipmentCenter } from '../../../lib/shipment-center';
import { loggerFor } from '../../../lib/logger';

const log = loggerFor('shipments');

export const runtime = 'nodejs';

/**
 * Every inbound shipment and which of its six documents exist.
 *
 * Assembled from box labels, ledger receipts and human-confirmed document
 * links — see `shipment-center.ts` for why two slots derive themselves and
 * four require a person.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  try {
    return Response.json(
      await loadShipmentCenter({ userId: session.user.sub })
    );
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : error },
      'shipment center load failed'
    );
    return Response.json(
      { error: 'Could not load your shipments.' },
      { status: 500 }
    );
  }
}
