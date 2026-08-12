import { auth0 } from '../../../lib/auth0';
import { loadAssetsView } from '../../../lib/assets-view';
import { loggerFor } from '../../../lib/logger';

const log = loggerFor('assets');

export const runtime = 'nodejs';

/** The creative library, with references resolved per asset. */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return Response.json({ view: await loadAssetsView(session.user.sub) });
  } catch (error) {
    log.error(
      {
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'assets view failed'
    );
    return Response.json(
      { error: 'Could not load your assets.' },
      { status: 500 }
    );
  }
}
