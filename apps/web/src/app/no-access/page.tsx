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
  title: 'Access unavailable',
  robots: { index: false, follow: false },
};

/**
 * Shown when we could not determine what someone has access to.
 *
 * This page used to do two jobs, and only one of them survives. It was the dead
 * end for an uninvited account, back when signup was gated; signup is open now
 * and a new account goes to `/onboarding` to create a workspace instead. What
 * is left is the outage case: the membership lookup failed, so we genuinely do
 * not know whether this person has a workspace.
 *
 * That distinction is the reason this is not merged into the onboarding page.
 * Offering the create-a-workspace form during a Couchbase outage would hand an
 * existing customer a SECOND workspace, with its own Stripe customer and no key
 * to collapse them on afterwards.
 *
 * Outside the `(dashboard)` group, because that group's layout is what redirects
 * here; nesting it there would loop.
 */
export default function NoAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* A real `h1`, not `CardTitle`, which renders a plain div — this is a
              standalone page whose card title IS its main heading. */}
          <h1 className="text-2xl leading-none font-semibold">
            We could not verify your access
          </h1>
          <CardDescription>
            Something on our side is not responding, so we cannot tell which
            workspaces you belong to. Your account is fine, and nothing has been
            lost — please try again in a moment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/chat">Try again</Link>
          </Button>
          <Button variant="outline" asChild className="w-full">
            <a href="/auth/logout">Sign out</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
