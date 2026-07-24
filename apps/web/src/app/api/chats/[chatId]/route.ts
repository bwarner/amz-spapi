import { auth0 } from '../../../../lib/auth0';
import {
  deleteChat,
  getChatMeta,
  isValidChatId,
  loadMessages,
} from '../../../../lib/chat-store';

export async function GET(
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

  const userId = session.user.sub;
  const meta = await getChatMeta({ userId, chatId });
  if (!meta) {
    return Response.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  // Optional paging: ?beforeSeq=N loads the window before that position.
  const { searchParams } = new URL(request.url);
  const beforeSeqRaw = searchParams.get('beforeSeq');
  const beforeSeq = beforeSeqRaw ? Number.parseInt(beforeSeqRaw, 10) : NaN;

  const messages = await loadMessages({
    userId,
    chatId,
    ...(Number.isFinite(beforeSeq) ? { beforeSeq } : {}),
  });
  return Response.json({
    chat: {
      chatId: meta.chatId,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      messageCount: meta.messageCount,
      messages,
    },
  });
}

export async function DELETE(
  _request: Request,
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

  const deleted = await deleteChat({ userId: session.user.sub, chatId });
  if (!deleted) {
    return Response.json({ error: 'Conversation not found.' }, { status: 404 });
  }
  return Response.json({ deleted: true });
}
