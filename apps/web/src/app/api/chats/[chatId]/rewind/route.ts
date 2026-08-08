import { auth0 } from '../../../../../lib/auth0';
import { isValidChatId, rewindChat } from '../../../../../lib/chat-store';

/**
 * Cut a conversation back to just before `messageId`, so it can be continued
 * from there instead of being abandoned.
 *
 * A message that is not stored is not an error: the turn may never have been
 * saved, and the caller has already dropped it from the view. Reported as
 * `deleted: 0` rather than a 404, because the caller's next move is the same
 * either way.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { chatId } = await context.params;
  if (!isValidChatId(chatId)) {
    return Response.json({ error: 'Invalid chat id.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    messageId?: unknown;
  } | null;
  const messageId = body?.messageId;
  if (typeof messageId !== 'string' || !messageId) {
    return Response.json(
      { error: 'A messageId is required.' },
      { status: 400 }
    );
  }

  const result = await rewindChat({
    userId: session.user.sub,
    chatId,
    messageId,
  });

  return Response.json(result ?? { deleted: 0, fromSeq: null });
}
