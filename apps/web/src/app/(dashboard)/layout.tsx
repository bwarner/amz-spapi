import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth0 } from '../../lib/auth0';
import { resolveAccess } from '../../lib/access';
import { DashboardNav } from '@/components/dashboard-nav';
import { PostHogProvider } from '@/components/posthog-provider';

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
    // `needs-onboarding` is the ordinary state of a new account, not a
    // refusal — it goes to the form that creates a workspace. Only a failed
    // lookup is a dead end, and it is a temporary one.
    redirect(
      access.reason === 'lookup-failed'
        ? '/no-access?reason=unavailable'
        : '/onboarding'
    );
  }

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
            <DashboardNav />
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
