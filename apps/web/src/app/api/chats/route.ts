import { auth0 } from '../../../lib/auth0';
import { listChats } from '../../../lib/chat-store';

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const chats = await listChats(session.user.sub);
    return Response.json({ chats });
  } catch (error) {
    // Same reason as the asset route: a 500 with no logged cause is a bug you
    // cannot act on from the dev terminal.
    console.error(
      '[chats] list failed',
      error instanceof Error ? `${error.name}: ${error.message}` : error
    );
    return Response.json(
      { error: 'Could not list conversations.' },
      { status: 500 }
    );
  }
}
