import { test, expect } from '@playwright/test';
import { signIn } from './support/session.js';

/**
 * The billing page, rendered.
 *
 * This file exists because of a bug it would have caught immediately: the plan
 * cards rendered `$NaN/month`. Every check in place at the time — typecheck,
 * lint, unit tests, `next build`, and a `curl` that only ever saw the 307 to
 * login — passed, because none of them RENDER this page. It needs a session and
 * a workspace, so it sat in the one gap the suite had.
 *
 * The owner is a fixed subject with a workspace created out of band by
 * `admincli workspaces create`, rather than a random one per run: this page is
 * only reachable with a workspace, so a `strangerSub()` would redirect to
 * onboarding and assert nothing.
 */

const OWNER_SUB = 'auth0|e2e-billing-render';
const OWNER_EMAIL = 'e2e-billing-render@example.com';

test.beforeEach(async ({ context, page, baseURL }) => {
  await signIn(context, baseURL as string, {
    sub: OWNER_SUB,
    email: OWNER_EMAIL,
  });

  await page.goto('/billing');

  // Fail with the fix rather than with a confusing selector timeout. Without
  // the workspace this subject is an ordinary new account and gets sent to
  // onboarding, so every assertion below would report a missing heading.
  if (!page.url().includes('/billing')) {
    throw new Error(
      `Redirected to ${page.url()} — the fixture workspace is missing. Create ` +
        `it with:\n  ENV_FILE=apps/web/.env.local ./admincli.sh workspaces ` +
        `create --name "E2E Billing Render" --owner-sub "${OWNER_SUB}" ` +
        `--owner-email "${OWNER_EMAIL}"`
    );
  }
});

test.describe('billing page', () => {
  test('renders a real price on every upgrade card', async ({ page }) => {
    // The regression this file was written for. `$NaN` is what an undefined
    // amount formats to, and it reaches the customer looking like a price.
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('NaN');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('$0/month');

    // The advertised monthly prices, which must match the plan table.
    await expect(page.getByText('$99', { exact: true })).toBeVisible();
    await expect(page.getByText('$299', { exact: true })).toBeVisible();
  });

  test('labels the figures instead of leaving them to be guessed', async ({
    page,
  }) => {
    // A bare workspace name under "Billing" read as branding, and "Today"
    // named a time without naming what was being measured.
    await expect(page.getByText(/Workspace · /)).toBeVisible();
    await expect(page.getByText('Spend today')).toBeVisible();
  });

  test('marks the current plan and steers to exactly one upgrade', async ({
    page,
  }) => {
    // A new workspace is on the free tier.
    await expect(page.getByText('Current plan', { exact: true })).toBeVisible();

    // Exactly one "Recommended" badge, and it is on an UPGRADE — never on the
    // plan already held, and never on a cheaper one.
    const recommended = page.getByText('Recommended', { exact: true });
    await expect(recommended).toHaveCount(1);
  });

  test('offers the portal without requiring a subscription', async ({
    page,
  }) => {
    // The workspace has a Stripe customer but no subscription. Gating this on
    // the subscription hid a former customer's own invoices from them.
    await expect(
      page.getByRole('button', { name: /manage billing in stripe/i })
    ).toBeVisible();

    // Says what is behind it. `subscription_cancel` is enabled on our portal
    // configuration, so this control is also the cancel route — and a button
    // that hides that turns a cancellation into a support email.
    await expect(page.getByText(/invoices and payment method/i)).toBeVisible();
  });

  test('puts billing management ABOVE the upgrade section', async ({
    page,
  }) => {
    // It used to sit last, below the cards trying to sell an upgrade, so the
    // most important control for an existing customer was the hardest to find.
    const portal = await page
      .getByRole('button', { name: /manage billing in stripe/i })
      .boundingBox();
    const upgrade = await page
      .getByRole('heading', { name: /upgrade|change your plan/i })
      .boundingBox();

    expect(portal).not.toBeNull();
    expect(upgrade).not.toBeNull();
    expect(portal?.y ?? 0).toBeLessThan(upgrade?.y ?? 0);
  });
});

/**
 * Mobile, where the plan cards stack.
 *
 * On a phone the grid collapses to one column, so an eight-item feature list
 * turns each card into most of a viewport and the second tier lands entirely
 * below the fold. Somebody comparing plans cannot see that a second one exists
 * without scrolling — which, on a pricing decision, is the whole job.
 */
test.describe('billing page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('brings the second plan into view without scrolling', async ({
    page,
  }) => {
    const scale = await page
      .getByRole('heading', { name: 'Billing' })
      .page()
      .getByText('Scale', { exact: true })
      .first()
      .boundingBox();

    expect(scale).not.toBeNull();
    // Its top edge, not the whole card — seeing that a second tier exists is
    // what stops the comparison being missed entirely.
    expect(scale?.y ?? Infinity).toBeLessThan(844);
  });

  test('gives the features disclosure a thumb-sized target', async ({
    page,
  }) => {
    // WCAG 2.5.5 asks for 44px. It started as `text-xs` with `hover:underline`
    // — about 16px tall, and an affordance that never fires on a touch screen.
    const box = await page
      .getByRole('button', { name: /features included/i })
      .first()
      .boundingBox();

    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('actually reveals the features when tapped', async ({ page }) => {
    // The complaint that prompted this: it was not obvious the control did
    // anything. Proving it does is the part a screenshot cannot.
    const toggle = page
      .getByRole('button', { name: /features included/i })
      .first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    const feature = page.getByText('2 Amazon seller accounts').first();
    await expect(feature).toBeHidden();

    await toggle.click();

    await expect(feature).toBeVisible();
    await expect(
      page.getByRole('button', { name: /hide features/i }).first()
    ).toHaveAttribute('aria-expanded', 'true');
  });
});
