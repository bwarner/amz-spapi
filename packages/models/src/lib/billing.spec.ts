import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN,
  PLANS,
  TRIAL_DAILY_SPEND_USD,
  dailySpendCeilingUsd,
  displayPlans,
  effectivePlan,
  isPurchasable,
  isSubscriptionEntitled,
  monthlyEquivalentCents,
  priceCentsFor,
  purchasablePlans,
  seatLimitReached,
  yearlySavingPercent,
} from './billing.js';

/**
 * Plans, and the allowance they carry.
 *
 * Signup is open, so this file is what stands between a signup form and an
 * unbounded AI Gateway bill. Every case below is a way that could quietly stop
 * being true — and all of them fail silently, because an over-generous
 * allowance looks exactly like a working product until the invoice arrives.
 */

describe('effectivePlan', () => {
  it('gives an unsubscribed workspace the default plan', () => {
    expect(effectivePlan({}).id).toBe(DEFAULT_PLAN);
  });

  /**
   * The one that would cost real money.
   */
  it('drops a CANCELLED workspace back to the default allowance', () => {
    // `plan` records what they once bought; it is not permission to keep
    // spending. Reading it without the status is how an unpaid account keeps
    // full access indefinitely.
    const plan = effectivePlan({
      plan: 'scale',
      subscriptionStatus: 'canceled',
    });

    expect(plan.id).toBe(DEFAULT_PLAN);
    expect(plan.dailySpendUsd).toBe(PLANS[DEFAULT_PLAN].dailySpendUsd);
  });

  it.each(['active', 'trialing'] as const)(
    'honours the paid plan while %s',
    (status) => {
      expect(
        effectivePlan({ plan: 'scale', subscriptionStatus: status }).id
      ).toBe('scale');
    }
  );

  it('keeps the paid plan while past_due', () => {
    // A failed renewal is usually an expired card. Cutting a paying customer
    // off the moment Stripe first reports it turns a billing hiccup into an
    // outage they experience as our fault; Stripe retries for days before
    // moving them to unpaid or canceled, which do drop.
    expect(
      effectivePlan({ plan: 'pilot', subscriptionStatus: 'past_due' }).id
    ).toBe('pilot');
  });

  it.each(['unpaid', 'canceled', 'incomplete_expired', 'paused'] as const)(
    'drops the allowance once %s',
    (status) => {
      expect(
        effectivePlan({ plan: 'scale', subscriptionStatus: status }).id
      ).toBe(DEFAULT_PLAN);
    }
  );

  it('ignores a status with no plan behind it', () => {
    // Reachable if a webhook lands before the plan is recorded. Trusting the
    // status alone would grant an allowance nobody bought.
    expect(effectivePlan({ subscriptionStatus: 'active' }).id).toBe(
      DEFAULT_PLAN
    );
  });
});

describe('dailySpendCeilingUsd', () => {
  it('returns the plan allowance by default', () => {
    expect(dailySpendCeilingUsd({ env: {} })).toBe(
      PLANS[DEFAULT_PLAN].dailySpendUsd
    );
  });

  it('lets a deployment raise a tier without a code change', () => {
    // The pilot customer who needs headroom today, when the deploy is tomorrow.
    expect(
      dailySpendCeilingUsd({
        plan: 'pilot',
        subscriptionStatus: 'active',
        env: { SELLAVANT_DAILY_SPEND_PILOT: '60' },
      })
    ).toBe(60);
  });

  it('accepts an override of zero, which stops spending entirely', () => {
    // Zero is a legitimate instruction — freeze this tier — and a truthiness
    // check would silently discard it and hand back the default allowance.
    expect(
      dailySpendCeilingUsd({ env: { SELLAVANT_DAILY_SPEND_FREE: '0' } })
    ).toBe(0);
  });

  it.each(['', 'lots', '-5'])('ignores the nonsensical override %p', (raw) => {
    // A typo must fall back to the plan, never to NaN — `spent + NaN > cap` is
    // false, so a bad value would disable the cap rather than tighten it.
    expect(
      dailySpendCeilingUsd({ env: { SELLAVANT_DAILY_SPEND_FREE: raw } })
    ).toBe(PLANS[DEFAULT_PLAN].dailySpendUsd);
  });

  it('applies the DEFAULT tier override to an unsubscribed workspace', () => {
    expect(
      dailySpendCeilingUsd({
        plan: 'scale',
        subscriptionStatus: 'canceled',
        env: { SELLAVANT_DAILY_SPEND_FREE: '1' },
      })
    ).toBe(1);
  });

  /**
   * The trial ceiling. Without it a 7-day Scale trial is $105 of gateway spend
   * per signup, collected from nobody and reversible by chargeback.
   */
  it('caps a TRIALING workspace below its tier allowance', () => {
    const scale = PLANS.scale.dailySpendUsd;
    const ceiling = dailySpendCeilingUsd({
      plan: 'scale',
      subscriptionStatus: 'trialing',
      env: {},
    });

    expect(ceiling).toBe(TRIAL_DAILY_SPEND_USD);
    expect(ceiling).toBeLessThan(scale);
  });

  it('never lets the trial ceiling EXCEED the tier being tried', () => {
    // Pilot allows less per day than the trial ceiling, so a pilot trial must
    // get pilot's number — otherwise trialing would be better than subscribing.
    const ceiling = dailySpendCeilingUsd({
      plan: 'pilot',
      subscriptionStatus: 'trialing',
      env: {},
    });

    expect(ceiling).toBe(
      Math.min(TRIAL_DAILY_SPEND_USD, PLANS.pilot.dailySpendUsd)
    );
    expect(ceiling).toBeLessThanOrEqual(PLANS.pilot.dailySpendUsd);
  });

  it('lets the trial ceiling be overridden on its own', () => {
    expect(
      dailySpendCeilingUsd({
        plan: 'scale',
        subscriptionStatus: 'trialing',
        env: { SELLAVANT_DAILY_SPEND_TRIAL: '3' },
      })
    ).toBe(3);
  });

  it('does not let the PLAN override leak into a trial', () => {
    // Raising a paying customer's tier must not simultaneously raise what every
    // trialing workspace on that tier may spend.
    expect(
      dailySpendCeilingUsd({
        plan: 'scale',
        subscriptionStatus: 'trialing',
        env: { SELLAVANT_DAILY_SPEND_SCALE: '500' },
      })
    ).toBe(TRIAL_DAILY_SPEND_USD);
  });
});

describe('plan table', () => {
  it('gives the unsubscribed tier a small, FINITE allowance', () => {
    // The shape that must survive editing. "Free and unlimited" is the exact
    // failure open signup creates, so a zero or absent ceiling here is a bug
    // however the tiers are renamed or repriced.
    const free = PLANS[DEFAULT_PLAN];

    expect(free.dailySpendUsd).toBeGreaterThan(0);
    expect(free.dailySpendUsd).toBeLessThan(10);
    expect(Number.isFinite(free.dailySpendUsd)).toBe(true);
  });

  it('never offers the default tier for sale', () => {
    // It is what you get without paying; listing it on a pricing page would be
    // a checkout that charges for nothing.
    expect(purchasablePlans().map((p) => p.id)).not.toContain(DEFAULT_PLAN);
    expect(isPurchasable(PLANS[DEFAULT_PLAN])).toBe(false);
  });

  it('gives every purchasable plan a price for BOTH intervals', () => {
    for (const plan of purchasablePlans()) {
      expect(isPurchasable(plan), `${plan.id} purchasable`).toBe(true);
      expect(priceCentsFor(plan, 'month')).toBeGreaterThan(0);
      expect(priceCentsFor(plan, 'year')).toBeGreaterThan(0);
    }
  });

  it('agrees with purchasablePlans about what is for sale', () => {
    // Two independent statements of the same fact — the pricing page reads the
    // predicate, `provision` and the catalogue read the list. Letting them drift
    // would advertise a Buy button for a plan nothing ever mints a price for.
    const sellable = displayPlans()
      .filter(isPurchasable)
      .map((p) => p.id);
    expect(sellable).toEqual(purchasablePlans().map((p) => p.id));
  });

  it('never lets a paid tier allow less than the free one', () => {
    for (const plan of purchasablePlans()) {
      expect(plan.dailySpendUsd).toBeGreaterThan(
        PLANS[DEFAULT_PLAN].dailySpendUsd
      );
      expect(plan.includedSpendUsd).toBeGreaterThan(
        PLANS[DEFAULT_PLAN].includedSpendUsd
      );
    }
  });

  /**
   * The margin guard.
   *
   * Included AI spend is the one entitlement that costs real money per unit, so
   * it must stay a minority of the price. A tier that includes more AI than it
   * charges for is a loss per customer that grows with usage — and it would be
   * introduced by editing one number in a table that otherwise looks harmless.
   */
  it('never includes more AI spend than about a third of the price', () => {
    for (const plan of purchasablePlans()) {
      const monthlyUsd = plan.monthlyCents / 100;
      expect(
        plan.includedSpendUsd / monthlyUsd,
        `${plan.id} COGS ratio`
      ).toBeLessThanOrEqual(0.35);
    }
  });

  it('cannot spend its monthly inclusion faster than the month', () => {
    // A daily ceiling far above included/30 means a customer can burn the whole
    // month in days and sit refused for weeks — technically within the sale,
    // and a support ticket every time.
    for (const plan of purchasablePlans()) {
      expect(plan.dailySpendUsd, `${plan.id}`).toBeLessThanOrEqual(
        plan.includedSpendUsd
      );
    }
  });

  it('makes each step up cheaper per dollar of AI, not just bigger', () => {
    // Without this the only reason to upgrade is hitting a wall, which means
    // the upgrade is bought resentfully. Each tier should buy AI more cheaply.
    const [pilot, scale] = purchasablePlans();
    const rate = (p: (typeof PLANS)[keyof typeof PLANS]) =>
      p.monthlyCents / 100 / p.includedSpendUsd;

    expect(rate(scale!)).toBeLessThan(rate(pilot!));
  });

  it('differentiates tiers on the levers that cost us nothing', () => {
    const [pilot, scale] = purchasablePlans();
    expect(scale!.sellerAccounts).toBeGreaterThan(pilot!.sellerAccounts);
    expect(scale!.seats).toBeGreaterThan(pilot!.seats);
  });

  it('shows the free tier on the pricing page, first', () => {
    // It is the anchor. Hiding it makes the ladder read as expensive and
    // more-expensive rather than free, cheap, serious.
    expect(displayPlans()[0]?.id).toBe(DEFAULT_PLAN);
    expect(displayPlans()).toHaveLength(3);
  });
});

describe('yearly pricing', () => {
  it('discounts the year against twelve months', () => {
    for (const plan of purchasablePlans()) {
      expect(plan.yearlyCents).toBeLessThan(plan.monthlyCents * 12);
      expect(yearlySavingPercent(plan)).toBeGreaterThanOrEqual(15);
    }
  });

  it('reports a monthly equivalent, which is what the page shows', () => {
    // Nobody compares $948 to $99; they compare $79 to $99.
    expect(monthlyEquivalentCents(PLANS.pilot)).toBe(
      Math.round(PLANS.pilot.yearlyCents / 12)
    );
    expect(monthlyEquivalentCents(PLANS.pilot)).toBeLessThan(
      PLANS.pilot.monthlyCents
    );
  });

  it('reports no saving for a plan with no price', () => {
    expect(yearlySavingPercent(PLANS.free)).toBe(0);
  });
});

describe('seatLimitReached', () => {
  it('allows a workspace under its limit', () => {
    expect(seatLimitReached(PLANS.pilot, PLANS.pilot.seats - 1)).toBe(false);
  });

  it('refuses once the seats are committed', () => {
    expect(seatLimitReached(PLANS.pilot, PLANS.pilot.seats)).toBe(true);
    expect(seatLimitReached(PLANS.pilot, PLANS.pilot.seats + 5)).toBe(true);
  });

  it('treats -1 as unlimited, not as zero', () => {
    // A plain `committed >= seats` would read -1 as "no seats" and lock
    // everybody out of the most expensive tier.
    const unlimited = { ...PLANS.scale, seats: -1 };
    expect(seatLimitReached(unlimited, 0)).toBe(false);
    expect(seatLimitReached(unlimited, 10_000)).toBe(false);
  });

  it('leaves the free tier with exactly one seat', () => {
    expect(seatLimitReached(PLANS.free, 1)).toBe(true);
    expect(seatLimitReached(PLANS.free, 0)).toBe(false);
  });
});

describe('isSubscriptionEntitled', () => {
  it('is false when there is no subscription at all', () => {
    expect(isSubscriptionEntitled(undefined)).toBe(false);
  });
});
