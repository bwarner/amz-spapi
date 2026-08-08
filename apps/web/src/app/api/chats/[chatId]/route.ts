import { auth0 } from '../../../../lib/auth0';
import {
  deleteChat,
  getChatMeta,
  isValidChatId,
  loadMessages,
  normalizeChatTitle,
  renameChat,
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

/** Rename a conversation: `{ title }` → `{ chat: { chatId, title } }`. */
export async function PATCH(
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
    title?: unknown;
  } | null;
  // Validate before touching the store so an empty or whitespace-only title
  // comes back as a 400 rather than an indistinguishable "not found".
  const title = normalizeChatTitle(body?.title);
  if (!title) {
    return Response.json({ error: 'A title is required.' }, { status: 400 });
  }

  const saved = await renameChat({ userId: session.user.sub, chatId, title });
  if (!saved) {
    return Response.json({ error: 'Conversation not found.' }, { status: 404 });
  }
  return Response.json({ chat: { chatId, title: saved } });
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
