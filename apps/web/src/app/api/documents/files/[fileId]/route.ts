import { denyIfWithoutAccess } from '../../../../../lib/access';
import { auth0 } from '../../../../../lib/auth0';
import {
  deleteFileEntry,
  resolveSellerContext,
} from '../../../../../lib/document-center';
import { loggerFor } from '../../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

/**
 * Delete one imported file and everything it produced.
 *
 * The id is the one the listing gave out: an asset id for a file whose bytes
 * were kept, or `import:<importId>` for a report that was ingested without
 * being stored. One endpoint rather than two, because from the screen they are
 * the same act — and a caller that had to know which kind it held would be a
 * caller that could get it wrong.
 */
export async function DELETE(
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
  if (!fileId) {
    return Response.json({ error: 'No file given.' }, { status: 400 });
  }

  const isImport = fileId.startsWith('import:');
  const assetId = isImport ? undefined : fileId;
  const importId = isImport ? fileId.slice('import:'.length) : undefined;

  try {
    // Rows and box labels belong to a seller account rather than to the user.
    const { sellerId, status } = await resolveSellerContext(session.user.sub);

    // Refuse rather than half-delete. The promise this screen makes is that a
    // file and everything it produced go together; without the seller we cannot
    // read the rows or labels, so proceeding would remove the file and silently
    // strand the data it is the evidence for. A seller with no connection at
    // all is a different case — there can be no rows without a seller — and is
    // allowed through.
    if (status === 'unavailable') {
      return Response.json(
        {
          error:
            'Your Amazon connection could not be read just now, so what this ' +
            'file contributed cannot be determined. Nothing was deleted — try ' +
            'again in a moment.',
        },
        { status: 503 }
      );
    }

    const outcome = await deleteFileEntry({
      userId: session.user.sub,
      sellerId,
      assetId,
      importId,
    });

    if (
      !outcome.fileDeleted &&
      !outcome.documentDeleted &&
      !outcome.reportImportDeleted &&
      !outcome.boxLabelsDeleted &&
      !outcome.reportRowsDeleted
    ) {
      // Nothing matched. Said as 404 rather than a cheerful 200: the file the
      // seller was looking at is either already gone or not theirs, and both
      // deserve a redraw of the list.
      return Response.json(
        { error: 'No such file, or it is not yours.' },
        { status: 404 }
      );
    }

    log.info(
      {
        assetId,
        importId,
        rows: outcome.reportRowsDeleted,
        labels: outcome.boxLabelsDeleted,
      },
      'file deleted'
    );
    return Response.json(outcome);
  } catch (error) {
    log.error(
      {
        fileId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'file delete failed'
    );
    return Response.json(
      { error: 'Could not delete that file.' },
      { status: 500 }
    );
  }
}
