import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth0 } from '../../lib/auth0';
import { resolveAccess } from '../../lib/access';
import { listPendingInvitationsForEmail } from '@amz-spapi/identity';
import { DashboardNav } from '@/components/dashboard-nav';
import { PostHogProvider } from '@/components/posthog-provider';
import { selectInvitationsToShow } from './team/pending-invitations';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect('/login');
  }

  /**
   * Invite-only. Signing in is not the same as being allowed in: Auth0 will
   * create an account for anyone, and this is where that account stops unless
   * somebody invited it. Also the provisioning point — a platform owner or an
   * invitee gets their workspace and membership created here, on first landing.
   */
  const access = await resolveAccess({
    userId: session.user.sub,
    email: session.user.email ?? undefined,
  });
  if (!access.allowed) {
    redirect(
      access.reason === 'lookup-failed'
        ? '/no-access?reason=unavailable'
        : '/no-access'
    );
  }

  /**
   * Invitations waiting for this person, counted for the nav badge.
   *
   * The gap this closes: `resolveAccess` returns as soon as it finds ONE
   * membership, so somebody who already belongs to a workspace never has a
   * second invitation looked at. That is the right call for a gate — joining an
   * organisation should not be a silent side effect of signing in — but it left
   * the invitation with nowhere to appear. A contractor invited by a new client
   * would see nothing, and it would expire after seven days.
   *
   * Deliberately NOT folded into `resolveAccess`. That function is on the path
   * of every authenticated request and its single-query shape is worth keeping;
   * this is a separate concern that happens to need the same email. Awaited
   * separately, but only after the gate has already decided — a badge must
   * never be the thing that delays a redirect.
   *
   * Failure is silent by design. A missing badge is a missed notification; an
   * error page because the badge query failed would be a worse outcome than the
   * problem it reports.
   */
  const pendingInvitations = selectInvitationsToShow({
    pending: session.user.email
      ? await listPendingInvitationsForEmail(session.user.email).catch(() => [])
      : [],
    // The SAME filter the Team page applies, over the memberships `resolveAccess`
    // already returned. Counting raw pending invitations here made the badge say
    // two while the page listed one, because a re-invitation to a workspace they
    // had already joined is hidden there. A badge that disagrees with the page it
    // points at is worse than no badge — it teaches people to ignore it.
    memberOf: access.memberships.map((membership) => membership.workspaceId),
  });

  return (
    <PostHogProvider
      distinctId={session.user.sub}
      email={session.user.email ?? undefined}
    >
      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-3 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/" className="flex items-center">
              {/* Icon only on mobile */}
              <Image
                src="/brand/sellavant-icon.svg"
                alt="Sellavant"
                width={32}
                height={32}
                className="h-8 w-8 sm:hidden"
              />
              {/* Full horizontal logo on desktop */}
              <Image
                src="/brand/sellavant-logo-horizontal.svg"
                alt="Sellavant"
                width={160}
                height={36}
                className="hidden sm:block h-9 w-auto"
              />
            </Link>
            <DashboardNav pendingInvitations={pendingInvitations.length} />
          </div>
          <span className="hidden sm:inline text-sm text-muted-foreground truncate max-w-[200px]">
            {session.user.name || session.user.email}
          </span>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </PostHogProvider>
  );
}
