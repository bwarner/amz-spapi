import { auth0 } from '../../../../../lib/auth0';
import {
  deleteAPlusDraft,
  getAPlusDraft,
} from '../../../../../lib/a-plus-drafts';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { draftId } = await params;
  const draft = await getAPlusDraft({ userId: session.user.sub, draftId });
  if (!draft) {
    return Response.json({ error: 'Draft not found.' }, { status: 404 });
  }

  return Response.json({ draft });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { draftId } = await params;
  await deleteAPlusDraft({ userId: session.user.sub, draftId });
  return Response.json({ ok: true });
}
