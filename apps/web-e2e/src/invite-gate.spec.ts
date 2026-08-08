import { test, expect } from '@playwright/test';
import { signIn, strangerSub } from './support/session.js';

/**
 * The invite gate, end to end.
 *
 * `access.spec.ts` covers the decisions; this covers the wiring, which is a
 * different failure. A gate can decide correctly and still let people through
 * because a layout forgot to call it, a route was added after the sweep, or a
 * redirect points somewhere that redirects back. None of those are visible to a
 * unit test, and all of them look fine in a code review.
 *
 * Sessions are forged rather than obtained from Auth0 — see `support/session`
 * for why that beats a bypass hook in production code. Every signed-in case
 * uses a randomised subject that has never been granted anything, so the specs
 * are deterministic against the shared dev scope with no seeding and no
 * cleanup.
 */

test.describe('invite gate', () => {
  test('sends an anonymous visitor to sign in', async ({ page }) => {
    await page.goto('/chat');

    await expect(page).toHaveURL(/\/login/);
  });

  test('sends a signed-in stranger to the dead end, not the product', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/chat');

    // The specific failure this catches: an account that Auth0 created quite
    // happily, reaching an authenticated chat that spends money on its first
    // message.
    await expect(page).toHaveURL(/\/no-access/);
    await expect(
      page.getByRole('heading', { name: /invite only/i })
    ).toBeVisible();
  });

  test('refuses the chat API for a signed-in stranger', async ({
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    // Hitting the route directly, because the UI dead end is only half the
    // gate — the half that a curl command walks straight around.
    const response = await context.request.post('/api/chat', {
      data: {
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('invite-only'),
    });
  });

  test('still serves the marketing pages to a stranger', async ({
    context,
    page,
    baseURL,
  }) => {
    // A negative control. A gate that also blocked the public site would be
    // caught here rather than by somebody noticing the pricing page 404s.
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/pricing');

    await expect(page).toHaveURL(/\/pricing/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('invitation links', () => {
  test('tells a signed-in visitor when the invitation does not exist', async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL as string, {
      sub: strangerSub(),
      email: 'stranger@example.com',
    });

    await page.goto('/invite/inv_doesnotexistdoesnotexi');

    await expect(
      page.getByRole('heading', { name: /invitation not found/i })
    ).toBeVisible();
    // Specifically NOT a redirect to the dashboard: a bad link must not be a
    // way in, and must not look like one either.
    await expect(page).not.toHaveURL(/\/chat/);
  });

  test('sends an anonymous invitee to sign up first', async ({ page }) => {
    await page.goto('/invite/inv_doesnotexistdoesnotexi', {
      // The redirect chain ends at Auth0, which is not reachable in a test
      // run. Stopping at `commit` means the assertion is about where we were
      // SENT, which is the part this app controls.
      waitUntil: 'commit',
    });

    // Either the auth route or Auth0 itself — both prove the invite page
    // handed an anonymous visitor to sign-in rather than rendering.
    await expect(page).toHaveURL(/\/auth\/login|auth0\.com/);
  });
});
