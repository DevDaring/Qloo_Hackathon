import { expect, test } from '@playwright/test';

/**
 * The project guide: opens by itself after sign-in, walks every feature of the US
 * sample (each step spotlights its target or shows the centred fallback), can be
 * skipped, stays closed after a reload, and the header button starts it again.
 * Plus the global hover tips and the image hover treatment. Read-only throughout.
 */
test('project guide, hover tips and image hover', async ({ page }) => {
  test.setTimeout(240_000);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (!['GET', 'HEAD'].includes(r.method()) && !/auth\/login|locations\/compare|revisions\/preview/.test(r.url())) writes.push(`${r.method()} ${r.url()}`);
  });
  await page.goto('/login');
  await page.evaluate(() => localStorage.removeItem('ll-guide-done'));
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // auto-starts on the Projects page
  const guide = page.getByTestId('guide');
  const card = page.getByTestId('guide-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('guide-progress')).toHaveText(/^1 of (\d+)$/);
  const total = Number((await page.getByTestId('guide-progress').textContent())!.split(' of ')[1]);
  expect(total).toBeGreaterThanOrEqual(12);

  for (let i = 1; i <= total; i++) {
    await expect(page.getByTestId('guide-progress')).toHaveText(`${i} of ${total}`);
    // each step either spotlights its target or shows the centred fallback
    await expect(guide).not.toHaveAttribute('data-status', 'searching', { timeout: 15_000 });
    const target = await guide.getAttribute('data-target');
    if ((await guide.getAttribute('data-status')) === 'found') {
      await expect(page.locator(`[data-tour="${target}"]`).first()).toBeVisible();
      await expect(page.getByTestId('guide-spotlight')).toBeVisible();
    } else {
      await expect(page.getByTestId('guide-fallback')).toBeVisible();
    }
    if (i === 2) {
      // Back returns to the previous step, Next moves on again
      await card.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByTestId('guide-progress')).toHaveText(`1 of ${total}`);
      await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('guide-progress')).toHaveText(`2 of ${total}`);
    }
    if (i < total) await card.getByRole('button', { name: /^Next/ }).click();
  }
  await expect(card.getByRole('button', { name: 'Finish' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Duplicate to edit' })).toBeVisible();
  await card.getByRole('button', { name: 'Finish' }).click();
  await expect(guide).toHaveCount(0);

  // restart from the header button, then skip
  await page.goto('/projects');
  await page.getByTestId('guide-button').filter({ visible: true }).click();
  await expect(card).toBeVisible();
  await expect(page.getByTestId('guide-progress')).toHaveText(`1 of ${total}`);
  await card.getByRole('button', { name: 'Skip tour' }).click();
  await expect(guide).toHaveCount(0);

  // it doesn't come back by itself
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(guide).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ll-guide-done'))).toBe('1');

  // Escape also ends it
  await page.getByTestId('guide-button').filter({ visible: true }).click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);

  // hover tip: "Start research" explains itself (and why it is disabled) without being clicked
  const sample = page.getByTestId('sample-card').first();
  await sample.getByRole('button', { name: /^Open sample/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.getByRole('button', { name: 'Start research', exact: true }).first().hover({ force: true });
  const tip = page.getByTestId('tip-card');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Start research');
  expect(page.url()).toBe(url); // hovering never navigates
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);

  // image hover: content images grow (transform changes) on hover
  await page.goto(`${url}/studio`);
  const img = page.locator('#main img').first();
  await expect(img).toBeVisible();
  const before = await img.evaluate((e) => getComputedStyle(e).transform);
  await img.hover();
  await expect.poll(() => img.evaluate((e) => getComputedStyle(e).transform)).not.toBe(before);

  expect(writes, writes.join('\n')).toEqual([]);
});
