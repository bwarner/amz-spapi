import { confirmPurchase } from '@amz-spapi/sp-cache';
import { z } from 'zod';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { auth0 } from '../../../../lib/auth0';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

const bodySchema = z.object({
  documentIds: z.array(z.string().min(1)).min(2),
});

/**
 * Confirm that several documents are one purchase.
 *
 * The grouping joins only on identifiers strong enough to be sure — an invoice
 * number, a tracking number — and offers everything else as a suggestion rather
 * than guessing. This is the answer to such a suggestion, and it is stored so it
 * never has to be given twice.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authenticated is not authorised. Without this, an account Auth0 created
  // quite happily reaches the document store — and an unauthorised read that
  // answers "you have no documents" is indistinguishable from a working one.
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'A purchase needs at least two documents.' },
      { status: 400 }
    );
  }

  try {
    // Each document is fetched with an ownership check before it is written,
    // so a mixed list cannot pull another account's document into a purchase.
    const updated = await confirmPurchase({
      userId: session.user.sub,
      documentIds: parsed.data.documentIds,
    });
    return Response.json({
      purchaseId: updated[0]?.confirmedPurchaseId,
      documentIds: updated.map((document) => document.documentId),
    });
  } catch (error) {
    log.error(
      {
        documentIds: parsed.data.documentIds,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'purchase confirmation failed'
    );
    return Response.json(
      { error: 'Could not group those documents.' },
      { status: 400 }
    );
  }
}
