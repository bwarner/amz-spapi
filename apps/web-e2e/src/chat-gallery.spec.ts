import { test, expect } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * A PNG per chat message state, from the fixtures at /dev/chat-gallery.
 *
 * Written because every UI change in this app has been verified by a green
 * build and unit tests over pure functions, and neither can tell you that a
 * sticky header sits behind the bubble, that a collapsed table fades in the
 * wrong direction, or that a stalled tool call looks exactly like a running
 * one. Those are the bugs this catches, and it catches them by handing a person
 * an image.
 *
 * It asserts almost nothing on purpose. Committed screenshot baselines are
 * flaky across platforms unless everything runs in one pinned container, and a
 * team that has learned to re-run with `--update-snapshots` on every red build
 * is worse off than one with no baselines at all. What this guarantees is that
 * every state still RENDERS, and that a human can see what it looks like. Add
 * `toHaveScreenshot()` later if the diffing earns its place.
 */

const OUT_DIR = join(here, '../../../tools/render-out/chat-states');

test.describe('chat state gallery', () => {
  test.beforeAll(async () => {
    // Cleared each run so a renamed or deleted case cannot leave a stale image
    // lying around looking current.
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });
  });

  test('renders every state and writes an image of each', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));

    await page.goto('/dev/chat-gallery');

    const cases = page.locator('[data-gallery-case]');
    await expect(cases.first()).toBeVisible();

    const count = await cases.count();
    expect(count, 'the gallery should hold cases').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const entry = cases.nth(index);
      const id = await entry.getAttribute('data-gallery-case');
      // Remote listing images will not load in CI; waiting for them would hang
      // the run for nothing, and their absence is visible in the image anyway.
      await entry.screenshot({
        path: join(OUT_DIR, `${id}.png`),
        animations: 'disabled',
      });
    }

    // A state that throws renders as an empty box, which is easy to miss in a
    // contact sheet and impossible to miss here.
    expect(failures, 'no case should throw while rendering').toEqual([]);
  });

  test('the whole sheet, for a single glance', async ({ page }) => {
    await page.goto('/dev/chat-gallery');
    await expect(page.locator('[data-gallery-case]').first()).toBeVisible();
    await page.screenshot({
      path: join(OUT_DIR, '_all.png'),
      fullPage: true,
      animations: 'disabled',
    });
  });
});
