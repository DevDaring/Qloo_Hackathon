import { expect, test } from '@playwright/test';

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
 * The US sample (Pulse Go portable speaker): a different product category with its own
 * venues, English and Spanish creative, and a valid with/without-Qloo comparison.
 * Read-only: nothing is written or generated.
 */
test('US speaker sample: ranking, taste story, Spanish creative and Qloo impact', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (!['GET', 'HEAD'].includes(r.method()) && !/auth\/login|locations\/compare|revisions\/preview/.test(r.url())) writes.push(`${r.method()} ${r.url()}`);
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // the tour offers the US sample first
  await expect(page.getByRole('radio', { name: 'United States sample' })).toHaveAttribute('aria-checked', 'true');
  const card = page.getByTestId('sample-card').filter({ hasText: 'Portable speaker launch' });
  await card.getByRole('button', { name: /^Open sample/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Portable speaker launch');

  // Houston is outside launch-partner coverage; New York and Phoenix are complete and ranked
  await page.goto(`${projectUrl}/compare`);
  await expect(page.getByTestId('location-New York')).toBeVisible();
  await expect(page.getByTestId('location-Houston')).toContainText(/Excluded|excluded/);

  // taste story for the hosts audience in the top city
  await page.goto(`${projectUrl}/audiences`);
  const story = page.getByTestId('taste-story');
  await expect(story).toHaveAttribute('data-state', /complete|partial/);
  await expect(story.getByTestId('city-signal')).toContainText(/Taste lift in .+: \d+(\.\d+)?×/);

  // Ad studio: a Spanish variant exists alongside English
  await page.goto(`${projectUrl}/studio`);
  await expect(page.getByText(/Español|Spanish/).first()).toBeVisible();

  // Qloo impact: valid comparison with venue discovery
  await page.goto(`${projectUrl}/compare?view=impact`);
  await expect(page.getByTestId('impact-verdict')).toContainText(/City order (un)?changed|No material change/);
  await expect(page.getByTestId('impact-discovery')).toBeVisible();

  expect(writes).toEqual([]);
});
