import {
  billingIntervalSchema,
  planIdSchema,
  type BillingInterval,
  type PlanId,
} from '@farvisionllc/models';
import { promoCodeSchema } from './promo';

/**
 * The choice a visitor made on the pricing page, carried through Auth0 signup.
 *
 * ## Why a token and not a cookie
 *
 * This is the intent of ONE click — "Pilot, yearly, with LAUNCH50" — and it
 * needs to survive exactly one redirect chain: pricing page → Auth0 signup →
 * back → `/start`. A URL parameter is the honest carrier for that: it is
 * visible, it is debuggable from a log line, and it expires by simply not being
 * clicked again.
 *
 * It is NOT a replacement for the promo cookie, which does a different job. The
 * token dies with the session; the cookie remembers for 90 days that this
 * person arrived from a campaign, which is what covers the far more common
 * "I'll think about it and come back tomorrow".
 *
 * ## Why it holds a plan id and not a Stripe price id
 *
 * The obvious shape is to encode the price and hand it to Stripe. Do not. The
 * token rides in a URL the user controls, and this Stripe account is shared
 * with two other products — an encoded price id that reaches
 * `checkout.sessions.create` unchecked lets somebody subscribe to whatever they
 * like, including another product's $5/week price, and the charge would look
 * entirely legitimate afterwards.
 *
 * Encoding the PLAN instead makes tampering uninteresting: the worst a forged
 * token can do is select a plan we already sell at the price we already
 * publish. The price id is resolved server-side from our own table. That is why
 * there is no signature here — there is nothing worth forging, so there is no
 * key to rotate and no verification step to get wrong.
 */

export type PricingSelection = {
  plan: PlanId;
  interval: BillingInterval;
  promo?: string;
};

/**
 * Compact and URL-safe. Not encryption and not obfuscation — just a tidy way to
 * keep three fields in one parameter. Anyone may read it; see the note above on
 * why that is fine.
 */
export function encodePricingSelection(selection: PricingSelection): string {
  // Annotated: inferred from the initializer it would be the narrow union of
  // plan and interval literals, which the promo is not a member of.
  const parts: string[] = [selection.plan, selection.interval];
  if (selection.promo) parts.push(selection.promo);
  return Buffer.from(parts.join('.'), 'utf8').toString('base64url');
}

/**
 * Decode a token, or null if it is anything other than a selection we sell.
 *
 * Every field is re-validated. A token is user input, and the only safe posture
 * for user input that selects what somebody is charged is to treat it as a
 * suggestion to be checked, never as an instruction.
 */
export function decodePricingSelection(
  token: string | null | undefined
): PricingSelection | null {
  if (!token) return null;

  let raw: string;
  try {
    raw = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const [planRaw, intervalRaw, promoRaw] = raw.split('.');

  const plan = planIdSchema.safeParse(planRaw);
  const interval = billingIntervalSchema.safeParse(intervalRaw);
  if (!plan.success || !interval.success) return null;

  const promo = promoRaw ? promoCodeSchema.safeParse(promoRaw) : null;

  return {
    plan: plan.data,
    interval: interval.data,
    // A malformed promo drops out rather than failing the whole token; the
    // plan choice is the valuable part and losing it over a bad discount code
    // would cost a sale.
    ...(promo?.success ? { promo: promo.data } : {}),
  };
}

/**
 * Where a plan's call-to-action should point.
 *
 * An authenticated visitor goes straight to `/start`; sending them through
 * Auth0 would re-prompt signup on top of a live session, which reads as being
 * logged out. Anonymous visitors get `screen_hint=signup` so they land on the
 * signup form rather than a login form they have no account for.
 */
export function ctaHref(
  selection: PricingSelection,
  isAuthenticated: boolean
): string {
  const start = `/start?token=${encodePricingSelection(selection)}`;
  if (isAuthenticated) return start;
  return `/auth/login?screen_hint=signup&returnTo=${encodeURIComponent(start)}`;
}
