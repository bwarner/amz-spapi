import {
  listBoxLabels,
  queryLedgerRows,
  reconcileShipments,
  type ShippedLine,
} from '@amz-spapi/sp-cache';
import { summariseBoxLabels } from '@farvisionllc/models';
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
    const [rows, labels] = await Promise.all([
      queryLedgerRows({ sellerId, view: 'ledger-detail' }),
      listBoxLabels({ sellerId }),
    ]);

    // Rolling the labels up here rather than in the store keeps the dedup and
    // completeness rules in one place — the same ones the import panel shows.
    const shipped: ShippedLine[] = summariseBoxLabels(labels).flatMap(
      (summary) =>
        summary.units.map((unit) => ({
          shipmentId: summary.shipmentId,
          sku: unit.sku,
          quantity: unit.quantity,
          complete: summary.complete,
          boxesSeen: summary.boxesSeen,
          boxesDeclared: summary.boxesDeclared,
        }))
    );

    return Response.json({
      shipments: reconcileShipments({ rows, shipped }),
      rowsConsidered: rows.length,
      boxLabelsHeld: labels.length,
      // False only when nothing is held at all: a partial set still gives a
      // real comparison, and the floor marker says where it is partial.
      shippedSideAvailable: shipped.length > 0,
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
