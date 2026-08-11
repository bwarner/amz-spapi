import { setDocumentShipment } from '@amz-spapi/sp-cache';
import { z } from 'zod';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { auth0 } from '../../../../lib/auth0';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('shipments');

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** Asset id of the document, as everywhere else the client speaks. */
  assetId: z.string().min(1),
  shipmentId: z.string().trim().min(1),
  attached: z.boolean(),
});

/**
 * "This document belongs to that shipment" — or does not.
 *
 * The four confirmed slots of the shipment checklist are filled and emptied
 * here. A human's answer, recorded so it survives re-import; the derived slots
 * (box labels, ledger) never pass through this route because nothing a human
 * says should be able to contradict what a label prints on its face.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Send a document, a shipment id, and attached true or false.' },
      { status: 400 }
    );
  }

  const userId = session.user.sub;

  try {
    const updated = await setDocumentShipment({
      userId,
      documentId: `${userId}::${parsed.data.assetId}`,
      shipmentId: parsed.data.shipmentId,
      attached: parsed.data.attached,
    });
    return Response.json({
      documentId: updated.documentId,
      shipmentIds: updated.shipmentIds ?? [],
    });
  } catch (error) {
    log.error(
      {
        assetId: parsed.data.assetId,
        shipmentId: parsed.data.shipmentId,
        error: error instanceof Error ? error.message : error,
      },
      'shipment link failed'
    );
    return Response.json(
      { error: 'Could not update that link.' },
      { status: 400 }
    );
  }
}
