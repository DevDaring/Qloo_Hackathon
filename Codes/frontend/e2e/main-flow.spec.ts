import { expect, test } from '@playwright/test';

test('jury main flow: landing → login → sample project pages', async ({ page }) => {
  // Landing
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find where your');
  await expect(page.getByText('Recommendations are planning aids, not guarantees.')).toBeVisible();

  // Login with the visible jury credentials
  await page.getByRole('link', { name: /^Sign in/ }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Jury access' })).toBeVisible();
  await expect(page.getByText('TestUser11')).toBeVisible();
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // Open the seeded sample project
  await page.getByRole('link', { name: /IoT wheelchair launch/ }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('IoT wheelchair launch');

  // Market explorer: map (or the table fallback) and consistent counts
  await page.getByRole('link', { name: 'Market explorer' }).first().click();
  await expect(page.getByRole('heading', { name: 'Market explorer' })).toBeVisible();
  await expect(page.locator('.maplibregl-canvas, [data-testid="places-table"]').first()).toBeVisible();
  const listed = page.getByTestId('places-total');
  const charted = page.getByTestId('analytics-total');
  await expect(listed).toHaveText(/^\d+$/);
  await expect(charted).toHaveText(/^\d+$/);
  expect(Number(await listed.textContent())).toBeGreaterThan(0);
  expect(await listed.textContent()).toBe(await charted.textContent());
  // same filter applied to both: pick a role filter and re-check agreement
  await page.getByRole('button', { name: 'Institution', exact: true }).click();
  await expect(page.getByText('Map, list and charts use the same filtered set')).toBeVisible();
  await expect.poll(async () => (await listed.textContent()) === (await charted.textContent())).toBe(true);

  // Location comparison on the latest research run (the page's default selection — no hard-coded run id):
  // Chennai stays excluded for service coverage; Kolkata is the top-ranked, fully evidenced location.
  await page.goto(`${projectUrl}/compare`);
  const chennai = page.getByTestId('location-Chennai');
  await expect(chennai).toBeVisible();
  await expect(chennai).toContainText('Excluded');
  await expect(chennai).toContainText('Service coverage');
  await expect(chennai).toContainText(/fail/i);
  await expect(chennai).toContainText('Outside every service region');
  const kolkata = page.getByTestId('location-Kolkata');
  await expect(kolkata).toContainText('Eligible');
  await expect(kolkata).toContainText('Complete — all weighted components have evidence');
  await expect(kolkata).toContainText('Rank #1');
  await expect(page.getByText('Cultural fit (Qloo)').first()).toBeVisible();

  // Campaign strategy renders (strategies or an honest empty state)
  await page.goto(`${projectUrl}/strategy`);
  await expect(page.getByRole('heading', { name: 'Campaign strategy' })).toBeVisible();
  await expect(page.getByText(/Positioning|No strategies yet/).first()).toBeVisible();

  // Ad studio renders
  await page.goto(`${projectUrl}/studio`);
  await expect(page.getByRole('heading', { name: 'Ad studio' })).toBeVisible();
  await expect(page.getByText(/Audience variants|No creative briefs yet/).first()).toBeVisible();

  // Settings / status: Qloo is live — configured, reachable and authorized, with operations listed
  await page.goto(`${projectUrl}/settings`);
  const qloo = page.getByTestId('provider-qloo');
  await expect(qloo).toBeVisible();
  await expect(qloo).toContainText('Configured: yes');
  await expect(qloo).toContainText('Authorized: yes');
  await expect(qloo).toContainText(/Search: supported/i);
});
