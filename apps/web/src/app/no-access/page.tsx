import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Access required',
  robots: { index: false, follow: false },
};

/**
 * Where a signed-in account with no workspace lands.
 *
 * Deliberately not an error page. The person reading it did nothing wrong —
 * they created an account for a product that is invite-only — so it explains
 * the situation and gives them the two ways forward rather than apologising.
 *
 * Outside the `(dashboard)` group, because that group's layout is what
 * redirects here; nesting it there would loop.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const unavailable = reason === 'unavailable';

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* A real `h1`, not `CardTitle`, which renders a plain div. This is a
              standalone page whose card title IS its main heading, so without
              this the page has no heading at all — invisible to a screen reader
              skimming structure, and to anything else that looks for one. */}
          <h1 className="text-2xl leading-none font-semibold">
            {unavailable ? 'We could not verify your access' : 'Invite only'}
          </h1>
          <CardDescription>
            {unavailable
              ? 'Something on our side is not responding, so we cannot tell ' +
                'which workspaces you belong to. Your account is fine — please ' +
                'try again in a moment.'
              : 'Sellavant is in a limited pilot. Your account exists, but it ' +
                'is not part of a workspace yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unavailable ? (
            <Button asChild className="w-full">
              <Link href="/chat">Try again</Link>
            </Button>
          ) : (
            <>
              <p className="text-sm leading-6 text-muted-foreground">
                If a colleague or client invited you, sign in with the exact
                email address the invitation was sent to — an invitation is tied
                to that address, not to the link.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild className="w-full">
                  <Link href="/contact">Request access</Link>
                </Button>
                <Button variant="outline" asChild className="w-full">
                  <a href="/auth/logout">Sign in as someone else</a>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
