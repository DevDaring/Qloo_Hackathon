import { expect, test } from '@playwright/test';

/**
 * A long-open tab notices a new release: the app shell `/` names a different main
 * bundle, so the update bar appears, and the next in-app navigation reloads.
 * The dev server has no hashed bundle, so the test gives the tab one (an empty
 * module) and stubs the background fetch of `/` with a newer bundle name.
 */
test('update watcher: bar appears and the next navigation reloads', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ll-guide-done', '1');
    } catch {
      /* ignore */
    }
    // pretend this tab runs bundle index-OLD (inserted as soon as <head> exists)
    const add = () => {
      if (!document.head || document.querySelector('script[data-fake-bundle]')) return false;
      const s = document.createElement('script');
      s.type = 'module';
      s.src = '/assets/index-OLD111.js';
      s.dataset.fakeBundle = '1';
      document.head.appendChild(s);
      return true;
    };
    if (!add()) {
      const mo = new MutationObserver(() => add() && mo.disconnect());
      mo.observe(document, { childList: true, subtree: true });
    }
  });
  await page.route('**/assets/index-OLD111.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export {};' }));
  // background checks of the app shell see a newer release; real navigations pass through
  await page.route(
    (url) => url.pathname === '/',
    (r) =>
      r.request().resourceType() === 'fetch'
        ? r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><script type="module" src="/assets/index-NEW222.js"></script>' })
        : r.continue().catch(() => undefined),
  );

  await page.goto('/login');
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const bar = page.getByTestId('update-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('LaunchLens has been updated');

  // no reload while the user stays on the page
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);

  // the next in-app navigation loads the new release (a full page load)
  const loaded = page.waitForEvent('load');
  await page.getByRole('link', { name: 'Settings / status' }).first().click();
  await loaded;
  await expect(page).toHaveURL(/\/settings$/);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
});
