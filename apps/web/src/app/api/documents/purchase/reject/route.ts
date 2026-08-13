import { dismissSuggestedLink } from '@amz-spapi/sp-cache';
import { z } from 'zod';
import { denyIfWithoutAccess } from '../../../../../lib/access';
import { auth0 } from '../../../../../lib/auth0';
import { loggerFor } from '../../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** The documents a suggestion proposed grouping. */
  documentIds: z.array(z.string().min(1)).min(2).max(12),
});

/**
 * "These are separate" — the other answer to a purchase suggestion.
 *
 * Stored pairwise on the documents themselves (the same `dismissedLinks` the
 * detail page's suggested-links use), in BOTH directions, so the grouping
 * stops proposing this combination no matter which document it starts from.
 * Seen live: two invoices from one supplier, same day, sequential numbers —
 * two separate orders, and the only button on offer was the one that would
 * have made one invoice the cost basis for both.
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
      { error: 'Send the documentIds the suggestion covered.' },
      { status: 400 }
    );
  }

  const { documentIds } = parsed.data;
  try {
    for (const documentId of documentIds) {
      for (const other of documentIds) {
        if (other === documentId) continue;
        await dismissSuggestedLink({
          userId: session.user.sub,
          documentId,
          dismissedDocumentId: other,
        });
      }
    }
    return Response.json({ separated: documentIds.length });
  } catch (error) {
    log.error(
      {
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'separate failed'
    );
    return Response.json(
      { error: 'Could not record that these are separate.' },
      { status: 500 }
    );
  }
}
