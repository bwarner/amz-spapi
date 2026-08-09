import { z } from 'zod';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Carrying a promotion code from an ad click to a Stripe checkout.
 *
 * ## The journey it has to survive
 *
 * An ad points at `sellavant.com/pricing?promo=LAUNCH50`. Between that click
 * and the moment the code can actually be applied there is an Auth0 signup, a
 * redirect to a hosted login page, a redirect back, and workspace onboarding.
 * The query string is gone after the first navigation, so something has to hold
 * the code across all of it. That is what this cookie is for.
 *
 * ## Where it deliberately gives up
 *
 * A cookie is per browser. Someone who clicks the ad on a laptop, receives an
 * email confirmation, and finishes signup on their phone has no cookie on the
 * phone, and no amount of cookie engineering fixes that — the two devices share
 * nothing. Auth0 `appState` is no better: it rides the same browser's redirect
 * chain.
 *
 * So this is deliberately BEST EFFORT, and the design compensates elsewhere
 * rather than pretending otherwise:
 *
 *   - the pricing page shows the code itself, not just "discount applied", so a
 *     customer who lost it can read it;
 *   - checkout falls back to `allow_promotion_codes`, which puts an input on
 *     Stripe's own page.
 *
 * The discount is therefore never unreachable. Losing the cookie costs one
 * paste, not the sale.
 */

/** First-party, and `Lax` so it survives the top-level Auth0 redirect back. */
export const PROMO_COOKIE = 'sellavant_promo';

/** Long enough to outlast a campaign and a customer who thinks it over. */
const PROMO_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/**
 * Codes are attacker-controlled — they arrive in a URL anyone can edit — so the
 * shape is constrained before the value is ever stored or sent to Stripe.
 * Stripe's own codes are alphanumeric; this also refuses the punctuation that
 * makes a cookie value or a log line ambiguous.
 */
export const promoCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** The code from a URL, if it is plausibly one. */
export function readPromoParam(url: URL): string | null {
  const raw = url.searchParams.get('promo');
  if (!raw) return null;
  const parsed = promoCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Record `?promo=` on the response, so it outlives the query string.
 *
 * Called from middleware rather than a page, because a Server Component cannot
 * set cookies and because doing it centrally means EVERY landing page carries
 * the code without each one remembering to.
 *
 * First write wins. A visitor who arrives on a campaign link and later browses
 * to a page with a different code keeps the one that brought them, which is
 * both the fairer attribution and the one they were promised.
 */
export function capturePromo(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  const code = readPromoParam(new URL(request.url));
  if (!code) return response;
  if (request.cookies.get(PROMO_COOKIE)?.value) return response;

  response.cookies.set(PROMO_COOKIE, code, {
    maxAge: PROMO_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    // Readable by the client is fine and useful — the pricing page shows the
    // code — and there is nothing secret in a value printed on an advert.
    httpOnly: false,
    secure: true,
  });
  return response;
}

/** The stored code, validated again on the way out. */
export function readPromoCookie(
  cookies: { get(name: string): { value: string } | undefined } | undefined
): string | null {
  const raw = cookies?.get(PROMO_COOKIE)?.value;
  if (!raw) return null;
  const parsed = promoCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
