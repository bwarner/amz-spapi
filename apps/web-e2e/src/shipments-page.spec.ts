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

    test('attaching does not move the card the seller is looking at', async ({
      page,
      context,
    }) => {
      // The recorded failure this pins: the list sorts least-complete first,
      // so a successful attach re-sorted the acted-on card below every
      // less-complete one — off the screen — and read as "didn't attach".
      // The sort applies on arrival; positions must hold while the page is
      // in use, so this drives the REAL UI attach rather than the API.
      const documents = await (
        await context.request.get('/api/documents')
      ).json();
      const invoices = (
        documents.files as Array<{
          assetId?: string;
          produced: Array<{ kind: string; role?: string }>;
        }>
      ).filter((file) =>
        file.produced.some(
          (item) =>
            item.kind === 'purchase-document' &&
            item.role === 'commercial-invoice'
        )
      );
      const center = await (await context.request.get('/api/shipments')).json();
      const po = (center.orders ?? [])[0];
      test.skip(
        invoices.length < 2 || !po,
        'Needs two invoices and an issued order.'
      );

      const A = 'FBA-E2E-STAY-A';
      const B = 'FBA-E2E-STAY-B';
      const link = (data: Record<string, unknown>): Promise<unknown> =>
        context.request.post('/api/shipments/link', { data });

      await link({
        assetId: invoices[0].assetId,
        shipmentId: A,
        attached: true,
      });
      await link({
        assetId: invoices[1].assetId,
        shipmentId: B,
        attached: true,
      });
      try {
        await page.goto('/shipments');
        await expect(page.getByText(A, { exact: true })).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByText(B, { exact: true })).toBeVisible();

        const order = async () => {
          const text = await page.locator('body').innerText();
          return [A, B].sort((x, y) => text.indexOf(x) - text.indexOf(y));
        };
        const before = await order();

        // Attach through the dialog on the FIRST of the two SEEDED cards —
        // the one whose completeness change used to re-sort it past the
        // other. Scoped to that card rather than "the first empty PO slot on
        // the page": this suite runs against the shared dev scope, and the
        // owner's own shipments can have empty PO slots too — an unscoped
        // .first() would attach the test PO to their real data.
        const firstCard = page
          .locator('div')
          .filter({ has: page.getByText(before[0], { exact: true }) })
          .filter({ has: page.getByTitle(/Missing purchase order/) })
          .last();
        await expect(async () => {
          await firstCard.getByTitle(/Missing purchase order/).click();
          await expect(page.getByRole('dialog')).toBeVisible({
            timeout: 2_000,
          });
        }).toPass({ timeout: 20_000 });
        // Click-until-closed as one retried unit: the dialog re-renders as
        // candidates load, a click into a replaced row dies silently, and an
        // open dialog's title ("Attach a purchase order to FBA-…") collides
        // with any non-exact match on the shipment id.
        await expect(async () => {
          await page.getByRole('dialog').getByText(po.poNumber).first().click();
          await expect(page.getByRole('dialog')).toBeHidden({
            timeout: 2_000,
          });
        }).toPass({ timeout: 20_000 });

        // The in-page reload has landed once the acted-on card reads 2 of 6.
        await expect(page.getByText('2 of 6').first()).toBeVisible({
          timeout: 20_000,
        });

        // Both cards still on screen, in the same order.
        await expect(page.getByText(A, { exact: true })).toBeVisible();
        await expect(page.getByText(B, { exact: true })).toBeVisible();
        expect(await order()).toEqual(before);
      } finally {
        await link({
          assetId: invoices[0].assetId,
          shipmentId: A,
          attached: false,
        });
        await link({
          assetId: invoices[1].assetId,
          shipmentId: B,
          attached: false,
        });
        await link({ poNumber: po?.poNumber, shipmentId: A, attached: false });
        await link({ poNumber: po?.poNumber, shipmentId: B, attached: false });
      }
    });

    test('an order the app issued fills the PO slot, until detached', async ({
      page,
      context,
    }) => {
      const center = await (await context.request.get('/api/shipments')).json();
      const po = (center.orders ?? [])[0];
      test.skip(!po, 'No issued orders in this environment.');

      const SHIPMENT = 'FBA-E2E-PO-CYCLE';
      const link = (attached: boolean) =>
        context.request.post('/api/shipments/link', {
          data: { poNumber: po.poNumber, shipmentId: SHIPMENT, attached },
        });

      await link(true);
      try {
        await page.goto('/shipments');
        await expect(page.getByText(SHIPMENT)).toBeVisible({ timeout: 15_000 });
        // What the page VISIBLY says when a native order answers the PO slot:
        // the vendor, and a value marked as the PO's. The PO number itself
        // lives in the chip's tooltip, so asserting it would pass on a hover
        // style and fail on the rendered page. (Filtering divs by text and
        // taking .last() lands on the innermost matching div — the card
        // header — which is how the first version of this test missed a
        // correctly rendered vendor.)
        await expect(page.getByText(po.vendorName).first()).toBeVisible();
        await expect(page.getByText('(PO)').first()).toBeVisible();
      } finally {
        await link(false);
      }
    });

    test('refuses to plan a packet while seller data is unreadable', async ({
      context,
    }) => {
      // The packet's whole value is honesty about what evidence exists. Under
      // a forged session the credential service is unreachable, and a packet
      // built then would name the ledger and labels as MISSING when they are
      // merely unreadable — so the route must refuse, and say why, rather
      // than emit a PDF that misstates the gaps.
      const response = await context.request.get(
        '/api/shipments/FBA-E2E-ANY/packet?plan=1'
      );
      expect(response.status()).toBe(503);
      const payload = await response.json();
      expect(payload.error).toMatch(/could not be read/i);
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
