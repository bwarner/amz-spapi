import { auth0 } from '../../../../../lib/auth0';
import { loadPacketInput } from '../../../../../lib/evidence-packet';
import { buildDeepView } from '../../../../../lib/reconcile-deep';
import { loggerFor } from '../../../../../lib/logger';

const log = loggerFor('shipments');

export const runtime = 'nodejs';

/**
 * The reconcile deep view for one shipment — ordered, invoiced, shipped,
 * received, and what each mismatch means.
 *
 * Unlike the packet route this never refuses on an unreadable seller store:
 * a VIEW can honestly render what it has (the unreadable sides are named in
 * `notes`), where a downloadable claim document could not.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { shipmentId } = await params;

  try {
    const input = await loadPacketInput({
      userId: session.user.sub,
      shipmentId,
    });
    return Response.json({ view: buildDeepView(input) });
  } catch (error) {
    log.error(
      {
        shipmentId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'deep view failed'
    );
    return Response.json(
      { error: 'Could not build the reconcile view.' },
      { status: 500 }
    );
  }
}
