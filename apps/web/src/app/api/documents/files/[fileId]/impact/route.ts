import { countRowsForImport } from '@amz-spapi/sp-cache';
import { denyIfWithoutAccess } from '../../../../../../lib/access';
import { auth0 } from '../../../../../../lib/auth0';
import { resolveSellerContext } from '../../../../../../lib/document-center';
import { loggerFor } from '../../../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

/**
 * What deleting this file would actually remove.
 *
 * Asked because the listing cannot answer it honestly. An import record states
 * what THAT import contributed, and a row keeps the id of the import that first
 * stored it — so re-importing a settlement produces a record reading
 * `rowsNew: 0` while the file's 1,043 rows sit there under the earlier import's
 * id. Both numbers are true and neither is the answer to "what am I about to
 * lose", which is only ever the count of rows carrying this import's id.
 *
 * A separate request rather than a field on the listing: it is one count per
 * import, and paying for thirty of them to render a screen nobody may click
 * delete on is the wrong trade.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authenticated is not authorised. Without this, an account Auth0 created
  // quite happily reaches the document store — and an unauthorised read that
  // answers "you have no documents" is indistinguishable from a working one.
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const { fileId } = await params;
  const importId = fileId.startsWith('import:')
    ? fileId.slice('import:'.length)
    : undefined;

  try {
    const { sellerId } = await resolveSellerContext(session.user.sub);

    // A stored file may also have been ingested; the caller passes the import
    // id it was shown, so there is nothing to re-derive here.
    const url = new URL(_request.url);
    const forImport = importId ?? url.searchParams.get('importId') ?? undefined;

    const reportRows =
      forImport && sellerId
        ? await countRowsForImport({ sellerId, importId: forImport })
        : 0;

    return Response.json({ reportRows });
  } catch (error) {
    log.error(
      {
        fileId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'impact lookup failed'
    );
    // The dialog must still open. It falls back to describing the file without
    // a row count rather than blocking a delete on a count.
    return Response.json({ reportRows: null });
  }
}
