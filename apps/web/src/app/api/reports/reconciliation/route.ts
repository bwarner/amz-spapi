import { queryLedgerRows, reconcileShipments } from '@amz-spapi/sp-cache';
import { auth0 } from '../../../../lib/auth0';
import { resolveAmazonConnection } from '../../../../lib/amazon-connections';

export const runtime = 'nodejs';

/**
 * Reconcile inbound shipments from stored ledger rows.
 *
 * Reads the DETAIL view only. The summary view carries no reference id, so it
 * cannot be joined to a shipment, and mixing the two would double count the
 * same movements.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let sellerId: string | undefined;
  try {
    const resolved = await resolveAmazonConnection({
      apiType: 'SP_API',
      userId: session.user.sub,
    });
    if (resolved.connected) sellerId = resolved.connection.profile.seller_id;
  } catch {
    // Reported as the explicit 409 below.
  }
  if (!sellerId) {
    return Response.json(
      { error: 'Connect an Amazon Seller account to reconcile shipments.' },
      { status: 409 }
    );
  }

  try {
    const rows = await queryLedgerRows({ sellerId, view: 'ledger-detail' });
    // The shipped side needs box labels persisted as structured records; until
    // then this reports what Amazon received and how it churned, and says so
    // rather than implying every shipment balanced.
    const shipments = reconcileShipments({ rows });
    return Response.json({
      shipments,
      rowsConsidered: rows.length,
      shippedSideAvailable: false,
    });
  } catch (error) {
    console.error(
      '[reconciliation] failed',
      error instanceof Error ? `${error.name}: ${error.message}` : error
    );
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Could not reconcile: ${error.message}`
            : 'Could not reconcile.',
      },
      { status: 500 }
    );
  }
}
