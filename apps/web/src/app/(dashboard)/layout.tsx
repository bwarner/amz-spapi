import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth0 } from '../../lib/auth0';
import { DashboardNav } from '@/components/dashboard-nav';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <span className="text-xs font-bold text-primary-foreground">S</span>
            </div>
            <span className="hidden sm:inline text-lg font-semibold">Sellavant</span>
          </Link>
          <DashboardNav />
        </div>
        <span className="hidden sm:inline text-sm text-muted-foreground truncate max-w-[200px]">
          {session.user.name || session.user.email}
        </span>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
