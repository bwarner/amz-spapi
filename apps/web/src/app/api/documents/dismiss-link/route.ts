import { dismissSuggestedLink } from '@amz-spapi/sp-cache';
import { z } from 'zod';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { auth0 } from '../../../../lib/auth0';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** The document being reviewed. */
  assetId: z.string().min(1),
  /** The suggestion being rejected, as a document id. */
  dismissedDocumentId: z.string().min(1),
});

/**
 * "These are not related."
 *
 * The other half of confirming a link, and the half that is easy to leave out.
 * Without it a rejected suggestion comes back on every visit, and a panel that
 * keeps asking an answered question is one a reviewer stops reading — taking
 * the real joins with it.
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
      { error: 'Send the document and the suggestion to dismiss.' },
      { status: 400 }
    );
  }

  const userId = session.user.sub;

  try {
    const updated = await dismissSuggestedLink({
      userId,
      documentId: `${userId}::${parsed.data.assetId}`,
      dismissedDocumentId: parsed.data.dismissedDocumentId,
    });
    return Response.json({ dismissedLinks: updated.dismissedLinks ?? [] });
  } catch (error) {
    log.error(
      { assetId: parsed.data.assetId, error: String(error) },
      'could not dismiss suggestion'
    );
    return Response.json(
      { error: 'Could not dismiss that suggestion.' },
      { status: 400 }
    );
  }
}
