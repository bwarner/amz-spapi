import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN,
  PLANS,
  dailySpendCeilingUsd,
  effectivePlan,
  isSubscriptionEntitled,
  purchasablePlans,
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
      dailySpendCeilingUsd({ env: { SELLAVANT_DAILY_SPEND_TRIAL: '0' } })
    ).toBe(0);
  });

  it.each(['', 'lots', '-5'])('ignores the nonsensical override %p', (raw) => {
    // A typo must fall back to the plan, never to NaN — `spent + NaN > cap` is
    // false, so a bad value would disable the cap rather than tighten it.
    expect(
      dailySpendCeilingUsd({ env: { SELLAVANT_DAILY_SPEND_TRIAL: raw } })
    ).toBe(PLANS[DEFAULT_PLAN].dailySpendUsd);
  });

  it('applies the DEFAULT tier override to an unsubscribed workspace', () => {
    expect(
      dailySpendCeilingUsd({
        plan: 'scale',
        subscriptionStatus: 'canceled',
        env: { SELLAVANT_DAILY_SPEND_TRIAL: '1' },
      })
    ).toBe(1);
  });
});

describe('plan table', () => {
  it('gives the unsubscribed tier a small, FINITE allowance', () => {
    // The shape that must survive editing. "Free and unlimited" is the exact
    // failure open signup creates, so a zero or absent ceiling here is a bug
    // however the tiers are renamed or repriced.
    const trial = PLANS[DEFAULT_PLAN];

    expect(trial.dailySpendUsd).toBeGreaterThan(0);
    expect(trial.dailySpendUsd).toBeLessThan(10);
    expect(Number.isFinite(trial.dailySpendUsd)).toBe(true);
  });

  it('never offers the default tier for sale', () => {
    // It is what you get without paying; listing it on a pricing page would be
    // a checkout that charges for nothing.
    expect(purchasablePlans().map((p) => p.id)).not.toContain(DEFAULT_PLAN);
  });

  it('gives every purchasable plan a price to look up', () => {
    for (const plan of purchasablePlans()) {
      expect(plan.priceEnvVar, `${plan.id} has no price`).toBeTruthy();
    }
  });

  it('never lets a paid tier allow less than the free one', () => {
    for (const plan of purchasablePlans()) {
      expect(plan.dailySpendUsd).toBeGreaterThan(
        PLANS[DEFAULT_PLAN].dailySpendUsd
      );
    }
  });
});

describe('isSubscriptionEntitled', () => {
  it('is false when there is no subscription at all', () => {
    expect(isSubscriptionEntitled(undefined)).toBe(false);
  });
});
