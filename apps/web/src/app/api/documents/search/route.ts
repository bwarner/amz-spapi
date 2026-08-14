import { listDocuments, searchDocuments } from '@amz-spapi/sp-cache';
import { z } from 'zod';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { auth0 } from '../../../../lib/auth0';
import { embedQuery } from '../../../../lib/document-embedding';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

/**
 * Search one seller's documents.
 *
 * Hybrid when the Search index is reachable: keyword for the exact tokens a
 * seller actually types — invoice numbers, tracking ids, SKUs — and vector for
 * "the packaging supplier in Guangzhou", which no keyword matches.
 *
 * ## Why there is a fallback, and why it announces itself
 *
 * The Search index is provisioned separately from the collections
 * (`couchbase-search-ddl.ts`) and needs a permission the app's database user
 * may not have been granted. Until it exists, `searchDocuments` fails — and a
 * search box that errors is a search box nobody uses.
 *
 * So an unreachable index degrades to a substring scan over the seller's own
 * documents, which is honest work: it finds "Weilong" in a vendor name and an
 * invoice number in a reference, over tens or hundreds of documents. What it
 * cannot do is find by meaning, or scale.
 *
 * The response therefore states which one answered. A fallback presented as a
 * search is the failure this whole feature is built to avoid — a seller
 * concluding a document is not there, when the truth is that nothing looked
 * properly.
 */

const querySchema = z.object({
  q: z.string().trim().max(500).optional(),
  roles: z.array(z.string()).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type SearchMode = 'hybrid' | 'keyword' | 'fallback';

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const parsed = querySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'Bad search.' }, { status: 400 });
  }

  const userId = session.user.sub;
  const { q, roles, from, to, limit } = parsed.data;
  const text = q?.trim();

  if (!text) {
    return Response.json({ hits: [], total: 0, mode: 'keyword' });
  }

  // The vector half is best-effort. A seller searching an invoice number is
  // served perfectly well by the keyword half alone, so a gateway problem
  // narrows the search rather than failing it.
  const embedded = await embedQuery(text);

  try {
    const result = await searchDocuments({
      userId,
      text,
      vector: embedded?.vector,
      roles,
      from,
      to,
      limit: limit ?? 25,
    });

    return Response.json({
      // Renamed from the index's `id` so BOTH answers below have one shape.
      // They did not: the index calls it `id` and the fallback built
      // `documentId`, so every consumer worked against whichever path it
      // happened to be tested on. The palette read `documentId`, which made it
      // correct while search was unavailable and broken the moment it came up —
      // rendering `doc-undefined` for every row, which cmdk then treated as one
      // item, so the whole list highlighted and arrow keys did nothing.
      hits: result.hits.map(({ id, ...rest }) => ({
        documentId: id,
        ...rest,
      })),
      total: result.total,
      mode: embedded ? 'hybrid' : 'keyword',
      // Counts over the WHOLE match set, for filter chips — "8 shown of 41"
      // can still say what the other 33 are. Absent on the fallback path.
      facets: result.facets,
      // A partitioned index can answer 200 with partitions failed — a SUBSET
      // presented as if complete. Passed through rather than folded away.
      partial: result.partial,
    });
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : error,
      },
      'search index unavailable; answering from a substring scan'
    );

    const documents = await listDocuments({ userId, from, to, limit: 500 });
    const needle = text.toLowerCase();
    const roleFilter = roles?.length ? new Set(roles) : undefined;

    const hits = documents
      .filter((document) => !roleFilter || roleFilter.has(document.role))
      .filter((document) =>
        [
          document.fileName,
          document.extracted.vendorName,
          document.extracted.invoiceNumber,
          document.extracted.trackingNumber,
          document.searchText,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, limit ?? 25)
      .map((document) => ({
        documentId: document.documentId,
        // Shaped like a Search hit so one renderer serves both answers.
        score: 0,
        role: document.role,
        fileName: document.fileName,
        vendorName: document.extracted.vendorName,
        documentDate: document.extracted.documentDate,
        total: document.extracted.total,
        currency: document.extracted.currency,
      }));

    return Response.json({
      hits,
      total: hits.length,
      mode: 'fallback',
      // Said out loud so the UI can say it too.
      reason:
        'The search index is not available, so this is a plain text match ' +
        'over your documents rather than a search by meaning.',
    });
  }
}
