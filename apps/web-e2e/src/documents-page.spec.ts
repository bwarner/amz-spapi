import { test, expect } from '@playwright/test';
import { signIn, strangerSub } from './support/session.js';

/**
 * The Documents screen, rendered.
 *
 * This exists because of a specific failure: a page can build, typecheck and
 * lint cleanly and still render `$NaN` or an empty list, and none of the checks
 * that run before a commit open a browser. Every assertion here is about
 * something only a render can show — that the list is populated, that a file
 * says what it became, and that delete asks before it acts.
 *
 * The signed-in half needs an account that is actually a member and actually
 * has files, which is a property of the environment rather than of the code, so
 * it runs only when `E2E_MEMBER_SUB` names one. Skipping loudly beats either
 * hardcoding somebody's Auth0 subject into the repository or asserting against
 * a seeded account whose emptiness would prove nothing.
 */

const memberSub = process.env['E2E_MEMBER_SUB'];

test.describe('documents page', () => {
  test('is behind the gate', async ({ page }) => {
    await page.goto('/documents');
    await expect(page).toHaveURL(/\/login/);
  });

  test('is not reachable by a signed-in stranger', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/documents');

    await expect(page).toHaveURL(/\/no-access/);
  });

  test('refuses the listing API to a stranger', async ({
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    const response = await context.request.get('/api/documents');

    // Not 200-with-an-empty-list: an unauthorised read that answers "you have
    // no documents" is indistinguishable on screen from a working one.
    expect(response.status()).not.toBe(200);
  });

  test.describe('with a member account', () => {
    test.skip(
      !memberSub,
      'Set E2E_MEMBER_SUB to a workspace member with imported files.'
    );

    test.beforeEach(async ({ context, baseURL }) => {
      await signIn(context, baseURL as string, {
        sub: memberSub as string,
        email: 'member@example.com',
      });
    });

    test('lists imported files and what each one became', async ({ page }) => {
      await page.goto('/documents');

      await expect(
        page.getByRole('heading', { name: 'Documents' })
      ).toBeVisible();

      // The listing is a client fetch, so the heading arrives before the data.
      const files = page.getByRole('heading', { name: /^Files \(/ });
      await expect(files).toBeVisible({ timeout: 15_000 });

      const body = await page.locator('body').innerText();

      // The bug this whole screen was built on top of: a file that produced
      // nothing visible. At least one row must state an outcome.
      expect(body).toMatch(/rows|Shipment|invoice|Stored, but nothing/i);

      // Names, not identifiers. `generated-asset_…` on screen means the upload
      // path stopped passing the file name through again.
      expect(body).not.toMatch(/generated-asset_/);
    });

    test('asks before deleting, and names what goes', async ({ page }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: 'Delete' }).first().click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/Delete /);

      // Nothing is destroyed by opening the dialog.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
    });

    test('filters without emptying the page', async ({ page }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: 'Reports' }).click();
      await expect(page.getByText(/rows/).first()).toBeVisible();
    });
  });
});
