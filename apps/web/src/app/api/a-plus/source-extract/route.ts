import { auth0 } from '../../../../lib/auth0';
import { readSourcePage } from '../../../../lib/source-reader';

export const maxDuration = 60;

/**
 * Read a product/supplier URL down to facts for the A+ source panel. The
 * extraction engine lives in lib/source-reader so the chat agent's read-page
 * tool shares it (and its cache).
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== 'string') throw new Error('URL is required');
    url = body.url;
  } catch {
    return Response.json(
      { error: 'Enter a valid source URL.' },
      { status: 400 }
    );
  }

  const result = await readSourcePage({ url, userId: session.user.sub });
  if (result.facts) {
    return Response.json({ facts: result.facts, cacheHit: result.cacheHit });
  }
  return Response.json(
    {
      error: result.error,
      httpStatus: result.httpStatus,
      finalUrl: result.finalUrl,
      apifyConfigured: result.apifyConfigured,
    },
    // A page we cannot read is a normal outcome for the panel, not a 4xx.
    { status: 200 }
  );
}
