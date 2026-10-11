import { expect, test } from '@playwright/test';

/**
 * Never an idle screen: a generation job in progress shows per-format progress
 * in the Ad studio, finished work raises a notification whose "View" action
 * navigates, and the header activity indicator opens the live console.
 * Jobs and events are mocked with page.route — nothing is generated.
 */
test('generation progress, notifications and the activity indicator', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ll-guide-done', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use jury login' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const us = await page.evaluate(async () => (await (await fetch('/api/v1/projects')).json()).items.find((p: { is_demo: boolean; country_code: string }) => p.is_demo && p.country_code === 'US').id as string);

  const JOB = '00000000-0000-4000-8000-0000000000aa';
  const started = new Date(Date.now() - 20_000).toISOString();
  await page.route('**/api/v1/creative-briefs/*', async (route) => {
    if (route.request().method() !== 'GET' || /estimate|trace/.test(route.request().url())) return route.continue().catch(() => undefined);
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    const body = await res.json();
    body.jobs = [{ id: JOB, kind: 'images', status: 'running', attempts: 1, max_attempts: 2, progress: { stage: 'image:square' }, result: {}, error: null, project_id: us, run_id: null, cost_cap_usd: 1, created_at: started, updated_at: started, finished_at: null, heartbeat_at: started }, ...body.jobs];
    await route.fulfill({ response: res, json: body });
  });
  await page.route(`**/api/v1/projects/${us}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue().catch(() => undefined);
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    const body = await res.json();
    body.active_jobs = 1;
    await route.fulfill({ response: res, json: body });
  });
  // the live stream falls back to polling, which delivers the mocked events
  await page.route('**/api/v1/projects/*/event-stream*', (r) => r.abort());
  let calls = 0;
  await page.route('**/api/v1/projects/*/events*', async (route) => {
    const res = await route.fetch().catch(() => null);
    if (!res) return; // the test already ended
    const body = await res.json();
    calls++;
    const ev = (id: number, type: string, message: string, data: Record<string, unknown> = {}) => ({ id, type, stage: 'image', message, data, run_id: null, job_id: JOB, created_at: new Date().toISOString() });
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? 0);
    if (after < 9_000_001) body.items.push(ev(9_000_001, 'job.progress', 'Generating square background with xAI'));
    if (calls >= 4 && after < 9_000_002) body.items.push(ev(9_000_002, 'job.completed', 'images completed', { kind: 'images' }));
    body.last_id = Math.max(body.last_id ?? 0, ...body.items.map((e: { id: number }) => e.id));
    await route.fulfill({ response: res, json: body }).catch(() => undefined);
  });

  await page.goto(`/projects/${us}/studio`);
  const gp = page.getByTestId('generation-progress');
  await expect(gp).toBeVisible();
  await expect(gp).toContainText('Generating flyers');
  await expect(gp.locator('[data-state="generating"]')).toHaveCount(1);
  await expect(gp.getByRole('button', { name: 'Cancel' })).toBeDisabled(); // read-only sample: explained, not clickable

  // the header indicator opens the live console
  const indicator = page.getByTestId('activity-indicator').filter({ visible: true });
  await expect(indicator).toContainText('Generating');
  await indicator.click();
  await expect(page.getByRole('button', { name: 'Collapse run console' })).toBeVisible();

  // finished work raises a notification; "View" navigates
  // leave the page in-app (the event stream keeps running across project pages)
  await page.getByRole('link', { name: 'Assets & exports' }).first().click();
  await expect(page).toHaveURL(/\/assets$/);
  const toast = page.getByTestId('toast').filter({ hasText: 'Flyers ready' });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await toast.getByTestId('toast-action').click();
  await expect(page).toHaveURL(/\/studio$/);
});
