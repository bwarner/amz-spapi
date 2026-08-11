import { test, expect } from '@playwright/test';
import { signIn, strangerSub } from './support/session.js';

/**
 * The shipments checklist, exercised as a full attach → verify → detach cycle.
 *
 * A cycle rather than fixtures, because this suite runs against the shared dev
 * scope: the test creates the link it asserts on and removes it afterwards, so
 * the data reads the same before and after and the test can run twice.
 */

const memberSub = process.env['E2E_MEMBER_SUB'];
const SHIPMENT = 'FBA-E2E-CYCLE';

test.describe('shipments page', () => {
  test('is behind the gate', async ({ page }) => {
    await page.goto('/shipments');
    await expect(page).toHaveURL(/\/login/);
  });

  test('refuses the API to an account with no workspace', async ({
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });
    const response = await context.request.get('/api/shipments');
    expect(response.status()).not.toBe(200);
  });

  test.describe('with a member account', () => {
    test.skip(!memberSub, 'Set E2E_MEMBER_SUB to a member with documents.');

    test.beforeEach(async ({ context, baseURL }) => {
      await signIn(context, baseURL as string, {
        sub: memberSub as string,
        email: 'member@example.com',
      });
    });

    test('a document attached to a shipment fills its slot, until detached', async ({
      page,
      context,
    }) => {
      // Find any extracted document to use as the invoice.
      const documents = await (
        await context.request.get('/api/documents')
      ).json();
      const file = (
        documents.files as Array<{
          assetId?: string;
          produced: Array<{ kind: string; role?: string }>;
        }>
      ).find((entry) =>
        entry.produced.some(
          (item) =>
            item.kind === 'purchase-document' &&
            item.role === 'commercial-invoice'
        )
      );
      test.skip(!file?.assetId, 'No extracted invoice in this environment.');

      const link = (attached: boolean) =>
        context.request.post('/api/shipments/link', {
          data: { assetId: file!.assetId, shipmentId: SHIPMENT, attached },
        });

      await link(true);
      try {
        await page.goto('/shipments');
        // The shipment exists ONLY because of the link — union enumeration.
        const card = page.locator('div', { hasText: SHIPMENT }).last();
        await expect(page.getByText(SHIPMENT)).toBeVisible({
          timeout: 15_000,
        });
        await expect(card.getByText('1 of 6')).toBeVisible();
      } finally {
        // Always detach: a leaked link would render a phantom shipment for the
        // owner of this dev account on every visit.
        await link(false);
      }

      await page.goto('/shipments');
      await expect(
        page.getByRole('heading', { name: 'Shipments' })
      ).toBeVisible();
      await expect(page.getByText(SHIPMENT)).toBeHidden();
    });
  });
});
