import { denyIfWithoutAccess } from '../../../../../lib/access';
import { auth0 } from '../../../../../lib/auth0';
import {
  buildPacketPdf,
  loadPacketInput,
  planPacket,
} from '../../../../../lib/evidence-packet';
import { loggerFor } from '../../../../../lib/logger';

const log = loggerFor('shipments');

export const runtime = 'nodejs';
// Loading, page-counting and re-stitching a stack of stored PDFs is the same
// order of work as a large report import.
export const maxDuration = 120;

/**
 * The evidence packet for one shipment.
 *
 * `?plan=1` returns the JSON plan — what will go in, what is missing, what is
 * claimed — for the page that shows it before anyone downloads anything.
 * Without it, the response is the assembled PDF itself.
 *
 * Refuses when the seller context is UNREADABLE, same rule as delete: the
 * packet's whole value is honesty about what evidence exists, and one built
 * while the ledger and labels were merely unreachable would name them as gaps
 * they are not. "Not connected" is different — then there genuinely is no
 * seller data, and the gaps say so truthfully.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const { shipmentId } = await params;
  const userId = session.user.sub;

  try {
    const input = await loadPacketInput({ userId, shipmentId });

    if (input.sellerStatus === 'unavailable') {
      return Response.json(
        {
          error:
            'Your Amazon connection could not be read just now. A packet ' +
            'built without the ledger and box labels would name them as ' +
            'missing when they are not — try again in a moment.',
        },
        { status: 503 }
      );
    }

    const plan = planPacket(input);

    const url = new URL(request.url);
    if (url.searchParams.get('plan')) {
      return Response.json({ plan, sellerStatus: input.sellerStatus });
    }

    if (!plan.items.length) {
      return Response.json(
        {
          error:
            'Nothing is attached to this shipment yet, so there is no ' +
            'evidence to assemble. Attach documents on the Shipments page.',
        },
        { status: 409 }
      );
    }

    const preparedOn = new Date().toISOString().slice(0, 10);
    const bytes = await buildPacketPdf({ userId, plan, preparedOn });

    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="evidence-${shipmentId}-${preparedOn}.pdf"`,
      },
    });
  } catch (error) {
    log.error(
      {
        shipmentId,
        error: error instanceof Error ? error.message : error,
      },
      'packet build failed'
    );
    return Response.json(
      { error: 'Could not build the packet.' },
      { status: 500 }
    );
  }
}
