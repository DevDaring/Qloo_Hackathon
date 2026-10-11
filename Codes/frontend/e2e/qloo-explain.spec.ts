import { expect, test, type Page } from '@playwright/test';

// the project guide opens automatically after sign-in; these flows test pages, not the guide
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ll-guide-done', '1');
    } catch {
      /* ignore */
    }
  });
});

/**
 * The demo journey on the seeded, read-only sample: locked banner → taste story
 * (provider evidence, generated hypotheses) → "See what Qloo changed" → "Why this
 * message?" → duplicate to an editable copy. Nothing here generates media or
 * spends money; the only write is the duplicate, which is archived afterwards.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

test('Qloo explanation journey on the locked sample', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (!['GET', 'HEAD'].includes(r.method()) && !/auth\/login|locations\/compare|revisions\/preview|\/duplicate$|\/projects\/[0-9a-f-]{36}$/.test(r.url())) writes.push(`${r.method()} ${r.url()}`);
  });
  await login(page);

  // Projects: the sample card offers "Open sample" and "Duplicate to edit"
  const card = page.getByTestId('sample-card').filter({ hasText: 'IoT wheelchair launch' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: /Duplicate to edit/ })).toBeVisible();
  await card.getByRole('button', { name: /^Open sample/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const sampleId = projectUrl.split('/').pop()!;

  // Locked banner, and edit actions explain why they are off
  const banner = page.getByTestId('locked-banner');
  await expect(banner).toContainText('Read-only sample');
  await expect(banner).toContainText('Duplicate to edit');
  await expect(page.getByRole('button', { name: 'Start research', exact: true })).toBeDisabled();
  await expect(page.getByText('Read-only sample — everyone sees the same results. Duplicate to edit.').first()).toBeVisible();

  // Audience insights → taste story (product users: Qloo attributed each place to an input)
  await page.goto(`${projectUrl}/audiences`);
  const story = page.getByTestId('taste-story');
  await expect(story).toHaveAttribute('data-state', 'complete');
  await expect(story.getByTestId('city-signal')).toContainText(/Taste lift in .+: \d+(\.\d)?×/);
  await expect(page.getByTestId('taste-diagram')).toBeVisible();
  const providerEdge = page.locator('[data-edge-kind="qloo_explainability"], [data-testid="combined-edge"]').first();
  await expect(providerEdge).toBeVisible();
  await providerEdge.click();
  const drawer = page.getByRole('dialog').filter({ has: page.locator('article') });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('article').first()).toContainText(/Qloo/);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // generated nodes are labelled as hypotheses, never as Qloo facts
  const generated = story.locator('[data-generated="true"]');
  expect(await generated.count()).toBeGreaterThanOrEqual(2);
  for (const node of await generated.all()) await expect(node).toContainText('Generated hypothesis');

  // a tag-only audience: one bracket for the combined interest set, no per-input attribution
  await page.getByRole('radio', { name: /Family members/ }).click();
  await expect(story).toHaveAttribute('data-attribution', 'combined_set');
  await expect(page.getByTestId('combined-bracket')).toBeAttached();
  await expect(page.getByTestId('combined-edge')).toContainText('recommended for this combined interest set');

  // "See what Qloo changed" from the overview
  await page.goto(projectUrl);
  await page.getByRole('link', { name: /See what Qloo changed/ }).first().click();
  await expect(page).toHaveURL(/compare\?view=impact/);
  const verdict = page.getByTestId('impact-verdict');
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText(/City order (un)?changed|No material change/);
  await expect(page.getByTestId('held-constant')).toContainText('Varied');
  await expect(page.getByTestId('impact-discovery')).toBeVisible();
  await expect(page.getByTestId('impact-dates')).toContainText('run');

  // Ad studio: "Why this message?" and the pilot hypothesis card
  await page.goto(`${projectUrl}/studio`);
  const why = page.getByTestId('why-this-message');
  await expect(why).toBeVisible();
  await expect(why).toContainText('Creative decisions');
  await expect(why).toContainText('Product fact');
  await expect(page.getByTestId('pilot-card')).toContainText('planned, not a result');

  // nothing above wrote anything
  expect(writes, writes.join('\n')).toEqual([]);

  // Duplicate to edit → land on the editable copy
  await page.goto(projectUrl);
  await page.getByTestId('locked-banner').getByRole('button', { name: /Duplicate to edit/ }).click();
  await expect(page).not.toHaveURL(new RegExp(sampleId));
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(my copy)');
  await expect(page.getByTestId('locked-banner')).toHaveCount(0);
  const copyId = page.url().split('/').pop()!;

  // keep the workspace tidy: archive the copy
  const status = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    return r.status;
  }, copyId);
  expect(status).toBe(200);
});
