import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth0 } from '../../lib/auth0';
import { resolveAccess } from '../../lib/access';
import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = {
  title: 'Create your workspace',
  robots: { index: false, follow: false },
};

/**
 * Where a new account lands.
 *
 * Outside the `(dashboard)` group on purpose: that layout redirects anyone
 * without a workspace here, so nesting this inside it would loop.
 *
 * It re-runs the access check rather than trusting the redirect. Someone who
 * already has a workspace and navigates here directly should not be offered a
 * second one — there is no natural key to collapse duplicates on afterwards,
 * and each carries its own Stripe customer.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  // Carried from `/start` when somebody picked a plan before signing up, so the
  // purchase can resume once the workspace exists.
  const { token } = await searchParams;
  const session = await auth0.getSession();
  if (!session?.user?.sub) redirect('/login');

  const access = await resolveAccess({
    userId: session.user.sub,
    email: session.user.email ?? undefined,
  });

  if (access.allowed) redirect('/chat');
  if (access.reason === 'lookup-failed') {
    // Not "you have no workspace" — we could not tell. Offering the form here
    // would hand an existing customer a second workspace during an outage.
    redirect('/no-access?reason=unavailable');
  }

  /**
   * A default drawn from the email's domain.
   *
   * `acme.com` becomes "Acme" — right often enough to be worth pre-filling, and
   * always editable. The alternative, an empty box labelled "workspace name",
   * asks somebody to make a decision about our data model before they have seen
   * the product.
   */
  const domain = session.user.email?.split('@')[1] ?? '';
  const brand = domain.split('.')[0] ?? '';
  const suggestion = /^[a-z0-9-]+$/i.test(brand)
    ? brand.charAt(0).toUpperCase() + brand.slice(1)
    : '';

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your workspace
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A workspace holds your Amazon connections, products and content. You
          can invite colleagues or a contractor to it later.
        </p>
        <OnboardingForm suggestion={suggestion} token={token} />
      </div>
    </div>
  );
}
