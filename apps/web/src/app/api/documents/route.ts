import { denyIfWithoutAccess } from '../../../lib/access';
import { auth0 } from '../../../lib/auth0';
import { loadDocumentCenter } from '../../../lib/document-center';
import { loggerFor } from '../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

/**
 * Everything this seller has imported, and what each file became.
 *
 * Assembled across four collections — see `document-center.ts` for why it
 * cannot simply be read from one.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authenticated is not authorised. Without this, an account Auth0 created
  // quite happily reaches the document store — and an unauthorised read that
  // answers "you have no documents" is indistinguishable from a working one.
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  try {
    const view = await loadDocumentCenter({ userId: session.user.sub });
    return Response.json(view);
  } catch (error) {
    log.error(
      {
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'document center load failed'
    );
    return Response.json(
      { error: 'Could not load your documents.' },
      { status: 500 }
    );
  }
}
