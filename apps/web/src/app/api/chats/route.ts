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
  } catch {
    return Response.json(
      { error: 'Could not list conversations.' },
      { status: 500 }
    );
  }
}
