import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import {
  DEFAULT_PLAN,
  TRIAL_DAYS,
  displayPlans,
  isPurchasable,
  monthlyEquivalentCents,
  priceCentsFor,
  yearlySavingPercent,
  type Plan,
} from '@farvisionllc/models';
import { findPromotionCode } from '@amz-spapi/billing';
import { auth0 } from '../../../lib/auth0';
import { ctaHref } from '../../../lib/pricing-token';
import { readPromoCookie } from '../../../lib/promo';
import { loggerFor } from '../../../lib/logger';
import {
  PricingPlans,
  type ActivePromo,
  type PricingRow,
} from './pricing-plans';

const log = loggerFor('pricing');

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Sellavant pricing for Amazon seller analytics, Brand Analytics workflows, and AI-assisted content operations.',
};

/**
 * Reads the session and the promo cookie, so it cannot be prerendered.
 */
export const dynamic = 'force-dynamic';

function usd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * What a plan actually gives you, in the order it matters.
 *
 * Derived from the plan table rather than written out per tier, so a change to
 * seats or allowance cannot leave the marketing copy claiming the old number —
 * the failure where a customer buys what the page promised and gets something
 * smaller.
 */
function featuresFor(plan: Plan): string[] {
  const accounts =
    plan.sellerAccounts === -1
      ? 'Unlimited Amazon seller accounts'
      : `${plan.sellerAccounts} Amazon seller account${
          plan.sellerAccounts === 1 ? '' : 's'
        }`;
  const seats =
    plan.seats === -1
      ? 'Unlimited team members'
      : `${plan.seats} team member${plan.seats === 1 ? '' : 's'}`;

  return [
    accounts,
    seats,
    `$${plan.includedSpendUsd}/month of included AI usage`,
    `$${plan.dailySpendUsd}/day spend ceiling`,
    'A+ content and brand guide workspace',
    'Brand Analytics and seller reporting',
    ...(plan.id === DEFAULT_PLAN
      ? []
      : [
          'Email support during onboarding',
          'Usage beyond the allowance billed at cost + 50%',
        ]),
  ];
}

export default async function PricingPage() {
  // Treat a session lookup failure as anonymous so the page still renders — a
  // marketing page that 500s because auth hiccuped is the worst trade here.
  let isAuthenticated = false;
  try {
    const session = await auth0.getSession();
    isAuthenticated = Boolean(session?.user);
  } catch (error) {
    log.warn({ error }, 'could not read session for pricing CTAs');
  }

  // Resolved server-side so the banner states the REAL discount rather than
  // echoing back whatever string was in the URL.
  let promo: ActivePromo | null = null;
  const code = readPromoCookie(await cookies());
  if (code) {
    const resolved = await findPromotionCode(code).catch(() => null);
    if (resolved) {
      promo = { code: resolved.code, description: resolved.description };
    }
  }

  const plans: PricingRow[] = displayPlans().map((plan) => {
    const purchasable = isPurchasable(plan);
    return {
      id: plan.id,
      label: plan.label,
      tagline: plan.tagline,
      monthly: usd(priceCentsFor(plan, 'month')),
      yearly: usd(priceCentsFor(plan, 'year')),
      yearlyPerMonth: usd(monthlyEquivalentCents(plan)),
      savingPercent: yearlySavingPercent(plan),
      features: featuresFor(plan),
      ...(purchasable
        ? {
            href: {
              month: ctaHref(
                {
                  plan: plan.id,
                  interval: 'month',
                  ...(code ? { promo: code } : {}),
                },
                isAuthenticated
              ),
              year: ctaHref(
                {
                  plan: plan.id,
                  interval: 'year',
                  ...(code ? { promo: code } : {}),
                },
                isAuthenticated
              ),
            },
          }
        : {}),
      ctaLabel: purchasable
        ? `Start ${TRIAL_DAYS}-day trial`
        : 'Get started free',
      // Pilot, not Scale. The recommended row should be the one most people
      // should actually buy, not the most expensive one.
      highlight: plan.id === 'pilot',
    };
  });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Choose your plan
        </h1>
        <p className="mt-3 text-muted-foreground">
          Start free on one seller account. Upgrade when you connect more or
          need a bigger AI allowance.
        </p>
      </div>

      <div className="mt-12">
        <PricingPlans plans={plans} promo={promo} trialDays={TRIAL_DAYS} />
      </div>
    </div>
  );
}
