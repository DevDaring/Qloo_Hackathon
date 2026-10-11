import { expect, test, type Page } from '@playwright/test';

/**
 * Visual how-to guidance in the chat (assistant replies are mocked — no model calls),
 * and every deep link used by the guides in backend/launchlens/services/howto.py
 * landing on its target with the pulsing highlight.
 */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ll-guide-done', '1');
      sessionStorage.setItem('ll-assistant-pulsed', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  return page.evaluate(async () => (await (await fetch('/api/v1/projects')).json()).items.find((p: { is_demo: boolean; country_code: string }) => p.is_demo && p.country_code === 'US').id as string);
}

test('chat how-to card: steps with screenshots, Show me highlights the control', async ({ page }) => {
  const us = await signIn(page);
  const base = `/projects/${us}`;
  const howto = {
    key: 'create_video',
    title: 'Make a video ad',
    needs: 'A creative brief. On a read-only sample, press “Duplicate to edit” first.',
    steps: [
      { n: 1, text: 'Open **Ad studio** from the left menu.', to: `${base}/studio` },
      { n: 2, text: 'In **Audience variants**, click the ad you want as a video.', to: `${base}/studio#variants` },
      { n: 3, text: 'Below the preview, open the **Video** tab.', to: `${base}/studio?tab=video#video-tab` },
      { n: 4, text: 'Click **Generate video…**. A cost review opens; nothing is spent yet.', to: `${base}/studio?tab=video#generate-video` },
      { n: 5, text: 'Choose **Full generated video** and press **Spend up to … & generate**.', to: null },
      { n: 6, text: 'Progress shows right there, scene by scene.', to: null },
    ].map((s) => ({ ...s, image: `/guide/create_video/${s.n}.webp` })),
  };
  await page.route('**/api/v1/assistant/chat', (r) =>
    r.fulfill({ json: { answer: 'Here is how to make a video ad:', used_qloo: false, qloo: [], links: [], suggestions: [], model: 'mock', howto } }),
  );
  await page.goto(base);
  await page.getByTestId('assistant-launcher').click();
  await page.getByLabel('Your question').fill('How can I create video on Ad studio page?');
  await page.keyboard.press('Enter');

  const card = page.getByTestId('howto-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Make a video ad');
  await expect(card.getByTestId('howto-needs')).toContainText('creative brief');
  await expect(card.getByTestId('howto-step')).toHaveCount(6);
  await expect(card.locator('b', { hasText: 'Generate video…' })).toBeVisible(); // **bold** rendered, no raw asterisks
  await expect(card).not.toContainText('**');
  // the annotated screenshots load
  const imgs = card.getByTestId('howto-image');
  await expect(imgs).toHaveCount(6);
  await expect.poll(() => imgs.first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);
  // click a screenshot to enlarge it
  await imgs.nth(3).click();
  await expect(page.getByRole('dialog', { name: /Step 4/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Step 4/ })).toHaveCount(0);

  // Show me: opens the Video tab and pulses a ring around "Generate video…"; the chat stays open
  await card.getByTestId('howto-show').nth(3).click();
  await expect(page).toHaveURL(/\/studio\?tab=video#generate-video$/);
  await expect(page.locator('#generate-video')).toHaveClass(/hash-target/, { timeout: 8000 });
  await expect(page.getByRole('tab', { name: /Video/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('assistant-panel')).toBeVisible();

  // step by step
  await card.getByTestId('howto-start').click();
  const walk = card.getByTestId('howto-walk');
  await expect(walk).toContainText('Step 1 of 6');
  await walk.getByTestId('howto-next').click();
  await expect(walk).toContainText('Step 2 of 6');
  await walk.getByTestId('howto-show').click();
  await expect(page.locator('#variants')).toHaveClass(/hash-target/, { timeout: 8000 });
});

test('every how-to deep link lands on its target', async ({ page }) => {
  test.setTimeout(180_000);
  const us = await signIn(page);
  const base = `/projects/${us}`;
  // mirrors the `to` values in backend/launchlens/services/howto.py
  const anchored: [string, string][] = [
    ['/studio#variants', 'variants'],
    ['/studio?tab=video#video-tab', 'video-tab'],
    ['/studio?tab=video#generate-video', 'generate-video'],
    ['/studio#generate-flyers', 'generate-flyers'],
    ['/studio#new-brief', 'new-brief'],
    ['/explorer#start', 'start'],
    ['/audiences#taste-story', 'taste-story'],
    ['/assets#build-package', 'build-package'],
    ['#duplicate', 'duplicate'],
  ];
  for (const [to, id] of anchored) {
    await page.goto(`${base}${to.startsWith('#') ? to : to}`);
    const el = page.locator(`#${id}`);
    await expect(el, to).toBeVisible({ timeout: 15_000 });
    await expect(el, to).toHaveClass(/hash-target/, { timeout: 8000 });
  }
  // plain pages
  for (const to of ['/studio', '/explorer', '/strategy', '/audiences', '/assets', '']) {
    const res = await page.goto(`${base}${to}`);
    expect(res?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings / status' })).toBeVisible();
  // #decision: opens the decision panel when a run waits; otherwise says so and points at the run console
  await page.goto(`${base}#decision`);
  const panel = page.getByRole('dialog').filter({ hasText: /decision|Choose/i });
  const note = page.getByTestId('toast').filter({ hasText: 'Nothing is waiting for your choice' });
  await expect(panel.or(note).first()).toBeVisible({ timeout: 10_000 });
});
