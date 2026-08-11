import {
  getStoredDocument,
  listDocuments,
  suggestLinks,
  type StoredDocument,
} from '@amz-spapi/sp-cache';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { auth0 } from '../../../../lib/auth0';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

/**
 * One document, and the documents that read as though they belong beside it.
 *
 * Keyed by ASSET id rather than document id. They differ by a prefix — a
 * document id is `${userId}::${assetId}` — and putting that in a URL would put
 * an Auth0 subject in the address bar, in browser history and in every log line
 * that records a path. The user is already known from the session, so the
 * prefix is re-derived server-side and nothing is lost.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const userId = session.user.sub;
  const { assetId } = await params;

  try {
    const document = await getStoredDocument(userId, `${userId}::${assetId}`);
    if (!document) {
      return Response.json(
        { error: 'No such document, or it is not yours.' },
        { status: 404 }
      );
    }

    return Response.json({
      document: forTheWire(document),
      suggestions: await suggestionsFor(userId, document),
    });
  } catch (error) {
    log.error(
      {
        assetId,
        error: error instanceof Error ? error.message : error,
      },
      'could not load document'
    );
    return Response.json(
      { error: 'Could not load that document.' },
      { status: 500 }
    );
  }
}

/**
 * The document without its vector.
 *
 * 1,536 floats is roughly 30KB of JSON that no screen renders, on a response a
 * reviewer waits for. `searchText` stays: it is what the vector was made from,
 * and seeing it is how someone works out why a search did or did not find this.
 */
function forTheWire(document: StoredDocument) {
  const { embedding, ...rest } = document;
  return { ...rest, embedded: Boolean(embedding?.length) };
}

/**
 * Documents that mean something similar, minus the ones already answered.
 *
 * Best-effort by design. Suggestions are an aid to a review, not the review, so
 * a Search index that is down or a document with no vector yields an empty
 * panel rather than an error page over an otherwise readable document.
 */
async function suggestionsFor(userId: string, document: StoredDocument) {
  if (!document.embedding?.length) return [];

  try {
    const dismissed = new Set(document.dismissedLinks ?? []);
    const hits = await suggestLinks({
      userId,
      documentId: document.documentId,
      vector: document.embedding,
      limit: 6,
      // Below this, "similar" means "also an invoice" — every document shares
      // that much, and a panel of near-noise is one nobody reads.
      minScore: 0.3,
    });

    // The stored figures rather than the index's copy: a role corrected after
    // the last index build would otherwise show its old value here.
    const byId = new Map(
      (await listDocuments({ userId, limit: 500 })).map((entry) => [
        entry.documentId,
        entry,
      ])
    );

    return hits
      .filter((hit) => !dismissed.has(hit.id))
      .map((hit) => {
        const stored = byId.get(hit.id);
        return {
          documentId: hit.id,
          assetId: stored?.assetId,
          score: hit.score,
          role: stored?.role ?? hit.role,
          fileName: stored?.fileName ?? hit.fileName,
          vendorName: stored?.extracted.vendorName ?? hit.vendorName,
          documentDate: stored?.extracted.documentDate ?? hit.documentDate,
          total: stored?.extracted.total ?? hit.total,
          currency: stored?.extracted.currency ?? hit.currency,
        };
      });
  } catch (error) {
    log.error(
      { documentId: document.documentId, error: String(error) },
      'suggested links unavailable'
    );
    return [];
  }
}
