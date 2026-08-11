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

  test('is not reachable by an account with no workspace', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/documents');

    // Onboarding rather than the old invite-only dead end — self-serve
    // workspaces changed where an account with nothing lands. What has NOT
    // changed, and is the point of this test, is that it does not land on
    // somebody's document library.
    await expect(page).not.toHaveURL(/\/documents/);
    await expect(page).toHaveURL(/\/onboarding|\/no-access/);
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

    test('opens the palette on \u2318K and finds a supplier', async ({
      page,
    }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      await page.keyboard.press('ControlOrMeta+k');

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // A supplier name, which lives on the extracted document rather than in
      // any file name — so a hit proves the search reached the server, not the
      // in-memory name filter.
      await page.getByPlaceholder(/Search by file name/i).fill('Wuhan');
      await expect(dialog.getByText(/Wuhan/i).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    test('marks exactly one result, and the arrows move it', async ({
      page,
    }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      await page.keyboard.press('ControlOrMeta+k');
      await page.getByPlaceholder(/Search by file name/i).fill('supplier');
      // Server round trip, then a moment for the list to settle.
      await expect
        .poll(async () => page.locator('[cmdk-item]').count(), {
          timeout: 15_000,
        })
        .toBeGreaterThan(1);

      // The regression this pins: the two search paths disagreed about whether
      // a hit is keyed `id` or `documentId`, so every row rendered with the
      // same undefined value. cmdk treated them as ONE item — the whole list
      // highlighted and the arrow keys did nothing, with no error anywhere.
      const selected = page.locator('[cmdk-item][aria-selected="true"]');
      await expect(selected).toHaveCount(1);

      const first = await selected.textContent();
      await page.keyboard.press('ArrowDown');
      await expect(selected).toHaveCount(1);
      expect(await selected.textContent()).not.toBe(first);
    });

    test('jumping from the palette highlights the file', async ({ page }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      await page.keyboard.press('ControlOrMeta+k');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByRole('option').first().click();

      // The dialog closes and the chosen row is marked, rather than the seller
      // being dropped back into an unchanged list.
      await expect(dialog).toBeHidden();
      await expect(page.locator('.border-primary').first()).toBeVisible();
    });

    test('every facet states how many files it holds', async ({ page }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      // The count is the point: a facet that would show nothing says so
      // before it is clicked, rather than after, when an empty list reads as
      // a fault. An empty facet is disabled for the same reason.
      const all = page.getByRole('button', { name: /^All ?\d+$/ });
      await expect(all).toBeVisible();

      const empty = page
        .getByRole('button', {
          name: /(Reports|Box labels|Everything else) ?0$/,
        })
        .first();
      if (await empty.count()) await expect(empty).toBeDisabled();
    });

    test('a facet with files narrows the list without emptying it', async ({
      page,
    }) => {
      await page.goto('/documents');
      await expect(
        page.getByRole('heading', { name: /^Files \(/ })
      ).toBeVisible({ timeout: 15_000 });

      const facet = page
        .getByRole('button', { name: /Invoices & receipts ?\d+/ })
        .first();
      await facet.click();

      await expect(page.getByText('Nothing matches that.')).toBeHidden();
    });
  });
});
