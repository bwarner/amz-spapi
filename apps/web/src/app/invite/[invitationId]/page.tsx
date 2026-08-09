import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth0 } from '../../../lib/auth0';
import {
  acceptInvitation,
  getInvitation,
  getWorkspace,
  InvitationError,
} from '@amz-spapi/identity';
import { isInvitationOpen } from '@farvisionllc/models';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Accept invitation',
  robots: { index: false, follow: false },
};

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* See `no-access/page.tsx`: `CardTitle` is a div, and this is the
              page's only title, so it has to be a real heading. */}
          <h1 className="text-2xl leading-none font-semibold">{title}</h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
    </div>
  );
}

/**
 * The invitation link.
 *
 * Acceptance happens on GET, which is unusual enough to justify. The
 * alternative — render a page, have the invitee press Accept — buys nothing
 * here: arriving at this URL *with a matching signed-in session* is already the
 * deliberate act, since the link alone cannot do anything without one. The
 * check that matters is that the session's email matches the invitation, and
 * that is enforced in `acceptInvitation` either way.
 *
 * Anyone not signed in is sent to Auth0 first and returned here, so the
 * common path — click the link in the email, sign up, land in the workspace —
 * is one continuous flow.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  const session = await auth0.getSession();

  if (!session?.user?.sub) {
    // screen_hint=signup because the overwhelmingly common case is a person who
    // has no account yet — that is what an invitation is for.
    redirect(
      `/auth/login?screen_hint=signup&returnTo=${encodeURIComponent(
        `/invite/${invitationId}`
      )}`
    );
  }

  const invitation = await getInvitation(invitationId);
  if (!invitation) {
    return (
      <Shell
        title="Invitation not found"
        description="This link does not match any invitation. It may have been mistyped, or the invitation may have been deleted."
      />
    );
  }

  if (invitation.status === 'accepted') {
    // Already in — most likely a second click on the same email. Send them to
    // the product rather than telling them off.
    redirect('/chat');
  }

  if (invitation.status === 'revoked') {
    return (
      <Shell
        title="Invitation withdrawn"
        description="This invitation was revoked by the workspace. Ask whoever invited you to send a new one."
      />
    );
  }

  if (!isInvitationOpen(invitation)) {
    return (
      <Shell
        title="Invitation expired"
        description="Invitations are valid for seven days. Ask whoever invited you to send a new one."
      />
    );
  }

  const email = session.user.email ?? '';
  const workspace = await getWorkspace(invitation.workspaceId);

  try {
    await acceptInvitation({
      invitationId,
      userId: session.user.sub,
      sessionEmail: email,
    });
  } catch (error) {
    if (error instanceof InvitationError && error.code === 'EMAIL_MISMATCH') {
      return (
        <Shell
          title="Wrong account"
          description={`This invitation was sent to ${
            invitation.email
          }, but you are signed in as ${
            email || 'another account'
          }. An invitation is tied to its email address.`}
        >
          <Button variant="outline" asChild className="w-full">
            <a href="/auth/logout">Sign in as {invitation.email}</a>
          </Button>
        </Shell>
      );
    }
    throw error;
  }

  redirect(
    `/chat?joined=${encodeURIComponent(workspace?.name ?? 'your workspace')}`
  );
}
