import { ingestReportBuffer, isIngestError } from '@amz-spapi/sp-cache';
import type { ReportKind } from '@amz-spapi/sp-cache';
import { auth0 } from '../../../../lib/auth0';
import { resolveAmazonConnection } from '../../../../lib/amazon-connections';
import { loggerFor } from '../../../../lib/logger';
const log = loggerFor('reports');

// Reports are decoded and parsed in-process; sharp-free but Node-only APIs.
export const runtime = 'nodejs';
// A year of ledger detail is a large file to parse.
export const maxDuration = 120;

/** Refuse absurd uploads before reading them into memory. */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Upload an Amazon report file.
 *
 * This is the path that does NOT require the SP-API role for the report — the
 * seller downloads it from Seller Central and uploads it here, which is the
 * whole point: reports behind roles we have not been granted are still usable.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: 'Send the report as multipart/form-data with a "file" field.' },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: `File is ${(file.size / 1024 / 1024).toFixed(
          0
        )}MB; the limit is ${MAX_BYTES / 1024 / 1024}MB. Split the date range.`,
      },
      { status: 413 }
    );
  }

  // Reports belong to a seller account, not to the logged-in user: two users on
  // one account must see the same ledger.
  let sellerId: string | undefined;
  try {
    const resolved = await resolveAmazonConnection({
      apiType: 'SP_API',
      userId: session.user.sub,
    });
    if (resolved.connected) sellerId = resolved.connection.profile.seller_id;
  } catch {
    // Fall through to the explicit error below.
  }
  if (!sellerId) {
    return Response.json(
      {
        error:
          'Connect an Amazon Seller account before importing reports — rows are ' +
          'stored against the seller they belong to.',
      },
      { status: 409 }
    );
  }

  const kindParam = form.get('kind');
  const kind =
    typeof kindParam === 'string' && kindParam
      ? (kindParam as ReportKind)
      : undefined;

  // Any throw below reaches the browser as an HTML error page, and the client's
  // response.json() then fails with "Unexpected end of JSON input" — hiding the
  // real cause. Always answer with JSON.
  let result;
  try {
    result = await ingestReportBuffer({
      sellerId,
      buffer: Buffer.from(await file.arrayBuffer()),
      source: 'upload',
      kind,
      fileName: file.name,
    });
  } catch (error) {
    log.error(
      {
        name: file.name,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'import failed'
    );
    return Response.json(
      {
        error:
          error instanceof Error
            ? `Import failed: ${error.message}`
            : 'Import failed.',
      },
      { status: 500 }
    );
  }

  if (isIngestError(result)) {
    return Response.json(result, { status: 422 });
  }
  log.info(
    `imported ${result.kind} for ${sellerId}: ` +
      `${result.rowsNew} new, ${result.rowsDuplicate} duplicate ` +
      `(${result.observedFrom ?? '?'}..${result.observedTo ?? '?'})`
  );
  return Response.json(result);
}
