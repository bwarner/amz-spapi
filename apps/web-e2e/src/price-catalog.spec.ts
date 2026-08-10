import { test, expect } from '@playwright/test';
import { signIn, strangerSub } from './support/session.js';

/**
 * The purchase path, end to end: pricing page → `/start` → checkout.
 *
 * `catalog.spec.ts` covers the decisions in isolation. This covers the WIRING,
 * which fails differently: the catalogue can be perfectly correct and still
 * never be consulted, because a CTA points at the wrong interval, a token is
 * dropped across signup, or a route resolves its price from somewhere else. All
 * of those look fine in a unit test and in a code review.
 *
 * ## What this deliberately does not do
 *
 * It never completes a purchase. Every case stops at the last hop this
 * application controls — the redirect to Stripe, or the status code returned
 * instead of one. Driving Stripe Checkout would test Stripe.
 *
 * ## Amounts are written out, on purpose
 *
 * The prices below are literals rather than imports from the plan table. An
 * assertion derived from the same source it is checking cannot fail, and the
 * one question a pricing page must answer is "does this show what we believe we
 * charge". A deliberate re-price is expected to update this file — that is the
 * point of it, not a maintenance cost to design away.
 */

const PILOT_MONTHLY = '$99';
const SCALE_MONTHLY = '$299';
/** Yearly divided by twelve, which is the number the annual toggle shows. */
const PILOT_YEARLY_PER_MONTH = '$79';
const SCALE_YEARLY_PER_MONTH = '$239';

/**
 * The pricing token, built here rather than imported.
 *
 * It is a wire format that survives a redirect through Auth0, so a test that
 * constructs it independently is checking the contract; one that imports the
 * encoder would agree with it by construction even if both were wrong.
 */
function token(plan: string, interval: string, promo?: string): string {
  const parts = [plan, interval];
  if (promo) parts.push(promo);
  return Buffer.from(parts.join('.'), 'utf8').toString('base64url');
}

/** Every "start a trial" CTA's href, in DOM order. */
async function ctaHrefs(page: import('@playwright/test').Page) {
  // `locator.all()` rather than `evaluateAll`: the latter runs in the browser
  // and needs DOM lib types this project does not compile with.
  const links = await page
    .getByRole('link', { name: /start \d+-day trial/i })
    .all();
  return Promise.all(
    links.map(async (link) => (await link.getAttribute('href')) ?? '')
  );
}

test.describe('pricing page', () => {
  test('advertises the monthly prices we believe we charge', async ({
    page,
  }) => {
    await page.goto('/pricing');

    await expect(page.getByText(PILOT_MONTHLY, { exact: true })).toBeVisible();
    await expect(page.getByText(SCALE_MONTHLY, { exact: true })).toBeVisible();
    // The free tier is what you get without paying, so it must never carry a
    // price — a "$0" here would read as a plan somebody could be charged for.
    await expect(page.getByText('Free', { exact: true }).first()).toBeVisible();
  });

  test('shows the per-month equivalent when switched to annual', async ({
    page,
  }) => {
    // Nobody compares $948 to $99, so the annual view divides by twelve. If
    // this ever showed the full yearly figure against a monthly one, the page
    // would read as a 10x price rise.
    await page.goto('/pricing');

    await page.getByRole('radio', { name: /annually/i }).click();

    await expect(
      page.getByText(PILOT_YEARLY_PER_MONTH, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(SCALE_YEARLY_PER_MONTH, { exact: true })
    ).toBeVisible();
  });

  test('sends an anonymous visitor to SIGN UP, carrying the selection', async ({
    page,
  }) => {
    // The selection has to survive the signup detour or the visitor lands back
    // on a generic dashboard having forgotten what they clicked.
    await page.goto('/pricing');

    const hrefs = await ctaHrefs(page);

    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      expect(href).toContain('/auth/login?screen_hint=signup');
    }
    const returnTos = hrefs.map((href) =>
      decodeURIComponent(
        new URL(href, 'https://x').searchParams.get('returnTo') ?? ''
      )
    );
    expect(returnTos.sort()).toEqual(
      [
        `/start?token=${token('pilot', 'month')}`,
        `/start?token=${token('scale', 'month')}`,
      ].sort()
    );
  });

  test('sends a signed-in visitor STRAIGHT to /start', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/pricing');

    const hrefs = await ctaHrefs(page);

    expect(hrefs.sort()).toEqual(
      [
        `/start?token=${token('pilot', 'month')}`,
        `/start?token=${token('scale', 'month')}`,
      ].sort()
    );
  });

  test('re-points the CTA when the interval changes', async ({ page }) => {
    // The failure this catches is silent and expensive: the toggle updates the
    // displayed price but not the link, so somebody reads $79 and buys monthly.
    await page.goto('/pricing');

    await page.getByRole('radio', { name: /annually/i }).click();

    const returnTos = (await ctaHrefs(page)).map((href) =>
      decodeURIComponent(
        new URL(href, 'https://x').searchParams.get('returnTo') ?? ''
      )
    );
    expect(returnTos.sort()).toEqual(
      [
        `/start?token=${token('pilot', 'year')}`,
        `/start?token=${token('scale', 'year')}`,
      ].sort()
    );
  });
});

test.describe('the /start hand-off', () => {
  test('carries the selection through onboarding so the purchase resumes', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto(`/start?token=${token('pilot', 'year')}`);

    // A new account has no workspace to bill, so onboarding comes first — and
    // the token has to come with it, or the visitor finishes signup and lands
    // somewhere that has forgotten they were buying.
    await expect(page).toHaveURL(
      new RegExp(`/onboarding\\?token=${token('pilot', 'year')}`)
    );
  });

  test('sends a hand-edited token back to the pricing page', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/start?token=not-a-real-token');

    // The pricing page explains the plans better than an error page can.
    await expect(page).toHaveURL(/\/pricing/);
  });

  test('refuses to "buy" the free tier', async ({ context, page, baseURL }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto(`/start?token=${token('free', 'month')}`);

    // Bounced to the app rather than into a checkout — and a workspace-less
    // account continues to onboarding from there. The tell that this took the
    // "not for sale" branch, and not the ordinary purchase branch, is that NO
    // token follows: a real selection would arrive as `/onboarding?token=…`.
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('sends an anonymous buyer to sign up first', async ({ page }) => {
    await page.goto(`/start?token=${token('pilot', 'month')}`, {
      // The chain ends at Auth0, which is not reachable in a test run.
      waitUntil: 'commit',
    });

    await expect(page).toHaveURL(/\/auth\/login|auth0\.com/);
  });
});

test.describe('checkout API', () => {
  test('refuses an unauthenticated caller', async ({ request }) => {
    const response = await request.post('/api/billing/checkout', {
      data: { plan: 'pilot', interval: 'month' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(401);
  });

  test('refuses to sell the free tier', async ({ context, baseURL }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    const response = await context.request.post('/api/billing/checkout', {
      data: { plan: 'free', interval: 'month' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'That plan is not for sale.',
    });
  });

  test('refuses a plan or interval it does not sell', async ({
    context,
    baseURL,
  }) => {
    // Both fields reach this route from a URL the buyer controls.
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    for (const body of [
      { plan: 'enterprise', interval: 'month' },
      { plan: 'pilot', interval: 'week' },
    ]) {
      const response = await context.request.post('/api/billing/checkout', {
        data: body,
        failOnStatusCode: false,
      });
      expect(response.status(), JSON.stringify(body)).toBe(400);
    }
  });
});

/**
 * Is THIS environment's price catalogue actually populated?
 *
 * The catalogue made `admincli billing provision --apply` a required bootstrap
 * step rather than an optional one, and a missed step is invisible until
 * somebody tries to pay: the pricing page renders perfectly either way, because
 * it reads the plan table on purpose.
 *
 * The probe works because of the order of checks in the checkout route — the
 * price is resolved BEFORE the workspace is looked up. So an account with no
 * workspace gets 403 only if a price was found first; if the catalogue is empty
 * the same request answers 503 and never reaches the workspace check.
 */
test.describe('catalogue readiness', () => {
  test('resolves a price for every plan this environment sells', async ({
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    for (const plan of ['pilot', 'scale']) {
      for (const interval of ['month', 'year']) {
        const response = await context.request.post('/api/billing/checkout', {
          data: { plan, interval },
          failOnStatusCode: false,
        });

        expect(
          response.status(),
          `${plan}/${interval} answered ${response.status()}. A 503 means this ` +
            'environment has no billing_prices row for it — run ' +
            '`admincli billing provision --apply`, or `billing sync-prices`.'
        ).toBe(403);
      }
    }
  });
});
