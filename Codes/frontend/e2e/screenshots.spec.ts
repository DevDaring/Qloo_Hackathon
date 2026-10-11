import { test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ll-guide-done', '1');
    } catch {
      /* ignore */
    }
  });
});

/** Scroll to the bottom step by step and back, so scroll-triggered content has revealed. */
async function scrollThrough(page: Page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = page.viewportSize()?.height ?? 800;
  for (let y = 0; y < h; y += Math.round(vh * 0.8)) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

/** Visual review helper: `npm run shots` writes desktop + phone screenshots of every page. */
const OUT = process.env.SHOTS_DIR ?? 'test-results/ui-shots';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

test('screenshots of every page', async ({ browser }) => {
  test.setTimeout(600_000);
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForTimeout(2500);
    await scrollThrough(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-landing.png`, fullPage: true });
    await page.goto('/login');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${vp.name}-login.png` });
    await page.getByRole('button', { name: 'Use jury login' }).click();
    await page.waitForURL(/\/projects$/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${vp.name}-projects.png`, fullPage: true });
    await page.getByRole('link', { name: /IoT wheelchair launch/ }).first().click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    const base = page.url();
    for (const p of ['', 'brief', 'brief?tab=constraints', 'explorer', 'compare', 'audiences', 'strategy', 'studio', 'assets', 'results', 'settings']) {
      await page.goto(p ? `${base}/${p}` : base);
      await page.waitForTimeout(3500);
      await scrollThrough(page);
      await page.screenshot({ path: `${OUT}/${vp.name}-${(p || 'overview').replace(/[?=]/g, '-')}.png`, fullPage: true });
    }
    await ctx.close();
  }
});
