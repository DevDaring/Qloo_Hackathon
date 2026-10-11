import { expect, test, type Page } from '@playwright/test';

/**
 * Floating assistant. /assistant/chat is mocked with page.route, so no model or
 * Qloo calls are made by the tests. An optional live smoke test runs only with E2E_LIVE=1.
 */
const REPLY = {
  answer: 'Bad Bunny fans also gravitate to streetwear and sneaker brands, according to Qloo.\n\n- Lead with music-led creative\n- Test partnerships with the brands below',
  used_qloo: true,
  qloo: [
    {
      interest: 'Bad Bunny',
      target_type: 'brand',
      city: null,
      signal: { name: 'Bad Bunny', type: 'artist', id: 'Q-BB' },
      results: [
        { name: 'Jordan Brand', affinity: 0.92, popularity: 0.97, address: null },
        { name: 'Crocs', affinity: 0.81, popularity: 0.88, address: null },
      ],
      note: 'Affinity is relative to this list.',
    },
  ],
  links: [{ label: 'Open settings', to: '/settings' }],
  suggestions: ['Where in Phoenix would they hang out?'],
  model: 'mock-model',
  qloo_calls: { logical_requests: 2 },
};

async function signIn(page: Page) {
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
}

test('assistant: launcher, chips, Qloo card, links, Escape', async ({ page }) => {
  const bodies: { messages: { role: string; content: string }[]; project_id?: string; page?: { name: string; path: string } }[] = [];
  await page.route('**/api/v1/assistant/chat', async (route) => {
    bodies.push(route.request().postDataJSON());
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPLY) });
  });
  await signIn(page);

  const launcher = page.getByTestId('assistant-launcher');
  await expect(launcher).toBeVisible();
  await launcher.click();
  const panel = page.getByRole('dialog', { name: 'Ask LaunchLens' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Powered by Qloo + AI');

  // a suggestion chip sends its question
  await panel.getByRole('button', { name: 'Which brands do Bad Bunny fans like?' }).click();
  await expect(panel.getByTestId('assistant-user-msg').last()).toHaveText('Which brands do Bad Bunny fans like?');
  await expect(panel.getByTestId('assistant-typing')).toBeVisible();
  await expect(panel.getByTestId('assistant-answer')).toContainText('streetwear');
  expect(bodies[0].messages.at(-1)).toEqual({ role: 'user', content: 'Which brands do Bad Bunny fans like?' });

  // the Qloo card renders with its own badge; the answer is labeled AI-written
  const card = panel.getByTestId('assistant-qloo-card');
  await expect(card).toContainText('Fans of Bad Bunny (artist) also like — brands');
  await expect(card).toContainText('Qloo data');
  await expect(card).toContainText('Jordan Brand');
  await expect(panel.getByTestId('assistant-answer')).toContainText('AI-written');

  // a link navigates within the app
  await panel.getByTestId('assistant-link').first().click();
  await expect(page).toHaveURL(/\/settings$/);

  // the conversation survives navigation
  await expect(panel.getByTestId('assistant-user-msg')).toHaveCount(1);

  // Enter sends a typed question, inside a project the project id goes along
  await page.goto('/projects');
  const sample = page.getByTestId('sample-card').first();
  await sample.getByRole('button', { name: /^Open sample/ }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const pid = page.url().split('/').pop();
  await page.getByTestId('assistant-launcher').click();
  await page.getByLabel('Your question').fill('What should my pilot measure?');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('assistant-user-msg').last()).toHaveText('What should my pilot measure?');
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].project_id).toBe(pid);
  // the page on screen goes along, and the panel says which product "this product" means
  expect(bodies[1].page?.name).toBe('Overview');
  await expect(page.getByTestId('assistant-context')).toContainText('Talking about:');

  // Escape closes it and focus returns to the launcher
  await page.getByLabel('Your question').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Ask LaunchLens' })).toHaveCount(0);
  await expect(page.getByTestId('assistant-launcher')).toBeFocused();
});

test('assistant: unavailable shows Retry', async ({ page }) => {
  let n = 0;
  await page.route('**/api/v1/assistant/chat', async (route) => {
    n++;
    if (n === 1)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'assistant_unavailable', message: 'The assistant is unavailable right now.', retryable: true } }) });
    else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...REPLY, qloo: [], used_qloo: false }) });
  });
  await signIn(page);
  await page.getByTestId('assistant-launcher').click();
  await page.getByRole('button', { name: 'What can LaunchLens do?' }).click();
  await expect(page.getByTestId('assistant-error')).toContainText('The assistant is unavailable right now');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('assistant-answer')).toBeVisible();
});

test('assistant: live smoke test', async ({ page }) => {
  test.skip(process.env.E2E_LIVE !== '1', 'live model and Qloo calls run only with E2E_LIVE=1');
  test.setTimeout(90_000);
  await signIn(page);
  await page.getByTestId('assistant-launcher').click();
  await page.getByRole('button', { name: 'What can LaunchLens do?' }).click();
  await expect(page.getByTestId('assistant-answer')).toBeVisible({ timeout: 60_000 });
});
