import { setDocumentRole } from '@amz-spapi/sp-cache';
import { DocumentRoleSchema } from '@farvisionllc/models';
import { z } from 'zod';
import { denyIfWithoutAccess } from '../../../../lib/access';
import { auth0 } from '../../../../lib/auth0';
import { loggerFor } from '../../../../lib/logger';

const log = loggerFor('documents');

export const runtime = 'nodejs';

const bodySchema = z.object({
  documentId: z.string().min(1),
  role: DocumentRoleSchema,
});

/**
 * Re-file a document under a different role.
 *
 * The role decides which document is authoritative for which question, so this
 * is the difference between freight counting as cost and not. Recorded as a
 * human's decision, which is what makes it survive re-importing the same file.
 */
export async function PATCH(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Authenticated is not authorised. Without this, an account Auth0 created
  // quite happily reaches the document store — and an unauthorised read that
  // answers "you have no documents" is indistinguishable from a working one.
  const denied = await denyIfWithoutAccess(session);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Send a documentId and a valid role.' },
      { status: 400 }
    );
  }

  try {
    // setDocumentRole checks ownership itself and throws when the document is
    // not this user's, so a guessed id cannot re-file someone else's evidence.
    const updated = await setDocumentRole({
      userId: session.user.sub,
      documentId: parsed.data.documentId,
      role: parsed.data.role,
    });
    return Response.json({
      documentId: updated.documentId,
      role: updated.role,
      roleSource: updated.roleSource,
    });
  } catch (error) {
    log.error(
      {
        documentId: parsed.data.documentId,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'role change failed'
    );
    return Response.json(
      { error: 'Could not change that document’s role.' },
      { status: 400 }
    );
  }
}
