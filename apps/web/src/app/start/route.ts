import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { PLANS, TRIAL_DAYS, priceEnvVarFor } from '@farvisionllc/models';
import {
  createCheckoutSession,
  findPromotionCode,
  priceIdFor,
} from '@amz-spapi/billing';
import { auth0 } from '../../lib/auth0';
import { currentWorkspace } from '../../lib/workspace-context';
import { appBaseUrl } from '../../lib/config';
import { loggerFor } from '../../lib/logger';
import { captureServerException } from '../../lib/posthog-server';
import { decodePricingSelection } from '../../lib/pricing-token';
import { PROMO_COOKIE, readPromoCookie } from '../../lib/promo';

const log = loggerFor('billing-start');

/**
 * Turn "I clicked Buy on the pricing page" into a Stripe checkout.
 *
 * ## Re-entrant on purpose
 *
 * The journey has gaps in it — an anonymous visitor has to sign up, and a new
 * account has no workspace to bill. Rather than a state machine, this route
 * bounces back to itself with the same token after each gap is filled:
 *
 *   /start ──no session──► Auth0 ──► /start ──no workspace──► /onboarding
 *          ──► /start ──► Stripe
 *
 * Every hop carries the token, so arriving here is always enough information to
 * decide what happens next, and refreshing at any point is harmless.
 *
 * ## Why not do this in the checkout API route
 *
 * That route answers a `fetch` from a button with a URL, which is right for a
 * signed-in customer on the billing page. This is a plain navigation from an
 * advert, and it has to survive a signup in the middle. Different journeys.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const selection = decodePricingSelection(token);

  if (!selection) {
    // A truncated or hand-edited link. The pricing page can explain the plans
    // again far better than an error page can.
    redirect('/pricing');
  }

  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    const returnTo = `/start?token=${token}`;
    redirect(
      `/auth/login?screen_hint=signup&returnTo=${encodeURIComponent(returnTo)}`
    );
  }

  // The free tier is not something you buy; it is what an account already has.
  if (!priceEnvVarFor(PLANS[selection.plan], selection.interval)) {
    redirect('/chat');
  }

  const context = await currentWorkspace(session.user.sub);
  if (!context) {
    // Onboarding hands the token straight back so the purchase resumes.
    redirect(`/onboarding?token=${token}`);
  }

  if (context.membership.role !== 'owner') {
    redirect('/billing?error=owner-only');
  }

  const priceEnvVar = priceEnvVarFor(PLANS[selection.plan], selection.interval);
  const priceId = priceEnvVar ? priceIdFor(priceEnvVar) : undefined;
  if (!priceId) {
    log.error({ priceEnvVar }, 'plan has no configured price');
    redirect('/billing?error=unconfigured');
  }

  try {
    // The token's promo wins — it is the campaign they clicked just now. The
    // cookie is the fallback for somebody who arrived weeks ago and came back
    // through a plain link.
    const code = selection.promo ?? readPromoCookie(request.cookies);
    const promotion = code ? await findPromotionCode(code) : null;

    const base = appBaseUrl();
    const { url } = await createCheckoutSession({
      customerId: context.workspace.stripeCustomerId,
      priceId,
      workspaceId: context.workspace.workspaceId,
      successUrl: `${base}/billing?subscribed=1`,
      cancelUrl: `${base}/pricing`,
      trialDays: context.workspace.stripeSubscriptionId ? 0 : TRIAL_DAYS,
      ...(promotion ? { promotionCodeId: promotion.promotionCodeId } : {}),
    });

    const response = NextResponse.redirect(url);
    // Remember the campaign even if they abandon checkout, so returning later
    // through any route still gets the discount they were promised.
    if (selection.promo) {
      response.cookies.set(PROMO_COOKIE, selection.promo, {
        maxAge: 90 * 24 * 60 * 60,
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
        secure: true,
      });
    }
    return response;
  } catch (error) {
    log.error(
      {
        workspaceId: context.workspace.workspaceId,
        plan: selection.plan,
        error:
          error instanceof Error ? `${error.name}: ${error.message}` : error,
      },
      'could not start checkout from a pricing link'
    );
    await captureServerException(error, {
      distinctId: session.user.sub,
      properties: { feature: 'billing', phase: 'start' },
    });
    redirect('/billing?error=checkout');
  }
}
