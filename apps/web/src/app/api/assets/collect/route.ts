import { auth0 } from '../../../../lib/auth0';
import { collectUnreferencedGeneratedAssets } from '../../../../lib/assets-view';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('assets');

export const runtime = 'nodejs';

/**
 * Collect unreferenced generated assets.
 *
 * Takes no body on purpose: the set of deletable assets is recomputed
 * server-side at this moment, so the client cannot nominate an asset for
 * deletion — it can only ask for the sweep the rules define. Uploads are
 * structurally out of reach.
 */
export async function POST() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const outcome = await collectUnreferencedGeneratedAssets(session.user.sub);
    log.info(outcome, 'collected');
    return Response.json(outcome);
  } catch (error) {
    log.error(
      {
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'collect failed'
    );
    return Response.json({ error: 'Collection failed.' }, { status: 500 });
  }
}
