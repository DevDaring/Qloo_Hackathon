import { expect, test, type Page } from '@playwright/test';

/**
 * Button audit: every button, link and tab on every page must *do* something
 * observable within 1.5 s — URL/hash change, a dialog/drawer/popover/menu,
 * an aria-expanded/pressed/selected/checked change, a toast, a meaningful change
 * of the page, a download, or focus/scroll moving to a target.
 *
 * Safety: write/spend actions (generate, approve, apply, delete, archive, logout,
 * start research on the samples, model calls, …) are never clicked. They are only
 * checked for a visible label and, when disabled, an explanation.
 *
 * Projects: the US sample, the India sample (both locked) and a fresh copy
 * (unlocked) that is duplicated at the start and archived at the end.
 */

const PAGES = [
  '',
  'brief',
  'brief?tab=claims',
  'brief?tab=uploads',
  'brief?tab=constraints',
  'brief?tab=versions',
  'explorer',
  'compare',
  'compare?view=impact',
  'audiences',
  'audiences?view=compare',
  'strategy',
  'studio',
  'assets',
  'results',
  'settings',
];

// clicking these writes, spends or signs out — verify only
const DANGER =
  /\b(generate|regenerate|approve|reject|apply|delete|remove|archive|restore|sign out|log ?out|duplicate|start research|new research run|research again|build package|import|upload|save|cancel run|cancel generation|retry|reconcile|record proxy|mark as not found|use selected candidate|run the comparison|new experiment|shortlist|shortlisted|spend|confirm|create|new brief|new project|new audience|cancel$|i fixed them|continue the run|choose these)\b/i;

interface Desc {
  id: string;
  label: string;
  role: string;
  tag: string;
  group: string;
  disabled: boolean;
  reason: boolean;
  verifyOnly: string | null;
  href: string | null;
  /** already the current page / selected tab / checked option: clicking it again is rightly a no-op */
  current: boolean;
}

interface Finding {
  page: string;
  label: string;
  problem: string;
}

async function collect(page: Page, scope: string, exclude: string[]): Promise<Desc[]> {
  return page.evaluate(
    ({ scope, exclude, danger }) => {
      const root = document.querySelector(scope);
      if (!root) return [];
      const re = new RegExp(danger, 'i');
      const sel = 'button, a[href], [role="tab"], [role="radio"], [role="switch"], summary';
      const out: Desc[] = [];
      let n = 0;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
        if (exclude.some((x) => el.closest(x))) continue;
        if (el.closest('[aria-hidden="true"], .sr-only, [data-testid="tip-card"], .maplibregl-ctrl, .maplibregl-map')) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        const labelledby = (el.getAttribute('aria-labelledby') ?? '').split(' ').map((i) => (i ? document.getElementById(i)?.textContent ?? '' : '')).join(' ');
        const label = (el.getAttribute('aria-label') || labelledby.trim() || el.textContent || (el as HTMLButtonElement).labels?.[0]?.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 70);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || tag;
        const disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
        const reason = !!(
          el.closest('fieldset[disabled]') || // a page-level read-only note explains the whole form
          el.closest('[data-tip-ref],[data-tip],[data-locked]') ||
          el.getAttribute('title') ||
          el.getAttribute('aria-describedby') ||
          el.parentElement?.parentElement?.querySelector('[role="note"]')
        );
        const href = el.getAttribute('href');
        let verifyOnly: string | null = null;
        if (el.closest('[data-cost]') || el.hasAttribute('data-cost')) verifyOnly = 'model call';
        else if (tag !== 'a' && re.test(label)) verifyOnly = 'writes or spends';
        else if (href && /\/download/.test(href)) verifyOnly = 'download link';
        else if (href && /^https?:/.test(href) && !href.startsWith(location.origin)) verifyOnly = 'external link';
        const current =
          ['page', 'step', 'true', 'location'].includes(el.getAttribute('aria-current') ?? '') ||
          (['radio', 'tab'].includes(role) && (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true')) ||
          el.getAttribute('aria-pressed') === 'true'; // the selected option of a segmented filter
        const id = `a${n++}`;
        el.setAttribute('data-audit-id', id);
        const group = `${tag}|${role}|${String(el.className).slice(0, 140)}|${el.parentElement?.tagName}`;
        out.push({ id, label, role, tag, group, disabled, reason, verifyOnly, href, current });
      }
      return out;
    },
    { scope, exclude, danger: DANGER.source },
  );
}

/** Click one control and wait for an observable effect. */
async function probe(page: Page, id: string): Promise<{ effect: string | null; navigated: boolean; download: boolean }> {
  const urlBefore = page.url();
  let download = false;
  const onDl = () => (download = true);
  page.once('download', onDl);
  page.once('filechooser', onDl); // e.g. a drop zone opens the file picker
  await page.evaluate((id) => {
    const w = window as unknown as { __audit: { muts: number; before: Record<string, unknown> } };
    const el = document.querySelector<HTMLElement>(`[data-audit-id="${id}"]`)!;
    const snap = () => ({
      dialogs: document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [data-testid="guide"]').length,
      toasts: document.querySelectorAll('[data-testid="toast"]').length,
      aria: ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-current'].map((a) => el.getAttribute(a)).join('|'),
      scroll: Math.round(window.scrollY),
      innerScroll: Array.from(document.querySelectorAll('#main .scroll-thin, #main [class*="overflow"]')).reduce((s, x) => s + (x as HTMLElement).scrollTop + (x as HTMLElement).scrollLeft, 0),
    });
    w.__audit = { muts: 0, before: snap() };
    const main = document.querySelector('#main') ?? document.body;
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        const t = m.target as Element;
        if (t.closest?.('[data-testid="tip-card"], [role="tooltip"]')) continue;
        if (m.type === 'characterData') w.__audit.muts++;
        else if (m.type === 'childList' && [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)].some((x) => x.nodeType === 1 && !(x as Element).closest?.('[role="tooltip"]'))) w.__audit.muts++;
      }
    });
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    (window as unknown as { __auditMo: MutationObserver }).__auditMo = mo;
    (window as unknown as { __auditSnap: typeof snap }).__auditSnap = snap;
    (window as unknown as { __auditEl: HTMLElement }).__auditEl = el;
  }, id);
  const loc = page.locator(`[data-audit-id="${id}"]`);
  try {
    await loc.click({ timeout: 2500 });
  } catch {
    await loc.evaluate((e: HTMLElement) => e.click(), undefined, { timeout: 1000 }).catch(() => undefined);
  }
  let effect: string | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 1500 && !effect) {
    await page.waitForTimeout(100);
    if (page.url() !== urlBefore) effect = 'url';
    else if (download) effect = 'download';
    else {
      effect = await page
        .evaluate(() => {
          const w = window as unknown as { __audit: { muts: number; before: Record<string, unknown> }; __auditSnap: () => Record<string, unknown>; __auditEl: HTMLElement };
          if (!w.__audit) return 'reload';
          const a = w.__audit.before;
          const b = w.__auditSnap();
          if (b.dialogs !== a.dialogs) return 'dialog';
          if (b.toasts !== a.toasts) return 'toast';
          if (w.__auditEl.isConnected && b.aria !== a.aria) return 'aria';
          if (b.scroll !== a.scroll || b.innerScroll !== a.innerScroll) return 'scroll';
          if (w.__audit.muts > 0) return 'dom';
          const ae = document.activeElement;
          if (ae && ae !== document.body && ae !== w.__auditEl && !w.__auditEl.contains(ae)) return 'focus';
          return null;
        })
        .catch(() => 'navigated');
    }
  }
  page.off('download', onDl);
  page.off('filechooser', onDl);
  await page.evaluate(() => (window as unknown as { __auditMo?: MutationObserver }).__auditMo?.disconnect()).catch(() => undefined);
  return { effect, navigated: page.url() !== urlBefore, download };
}

async function closeOverlays(page: Page) {
  for (let i = 0; i < 3; i++) {
    const open = await page.locator('[role="dialog"]:visible, [data-testid="guide"]').count();
    if (!open) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  // a dialog that ignores Escape: use its close button
  const close = page.locator('[role="dialog"]:visible').getByRole('button', { name: /^(Close|Cancel|Keep things as they are|Close panel|Close dialog|Close chat|Close preview)/ }).first();
  if (await close.count()) await close.click().catch(() => undefined);
}

async function auditPage(
  page: Page,
  url: string,
  name: string,
  opts: { scope?: string; exclude?: string[]; perGroup?: number; seen?: Set<string>; prepare?: (p: Page) => Promise<void> },
  findings: Finding[],
): Promise<number> {
  const scope = opts.scope ?? '#main';
  const exclude = opts.exclude ?? ['[data-testid="journey"]', '[data-testid="context-bar"]', '[data-testid="locked-banner"]', '[data-run-console]', '[data-testid="assistant-panel"]'];
  const perGroup = opts.perGroup ?? 3;
  const seen = opts.seen ?? new Set<string>();
  const groups = new Map<string, number>();
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1200);
  await opts.prepare?.(page);
  let tested = 0;
  for (let guard = 0; guard < 400; guard++) {
    const list = await collect(page, scope, exclude);
    const next = list.find((d) => {
      const key = `${d.role}|${d.label}|${d.href ?? ''}`;
      if (seen.has(key)) return false;
      if ((groups.get(d.group) ?? 0) >= perGroup) {
        seen.add(key);
        return false;
      }
      return true;
    });
    if (!next) break;
    const key = `${next.role}|${next.label}|${next.href ?? ''}`;
    seen.add(key);
    groups.set(next.group, (groups.get(next.group) ?? 0) + 1);
    tested++;
    if (!next.label) findings.push({ page: name, label: `(${next.tag} without a label)`, problem: 'no accessible name' });
    if (next.disabled) {
      if (!next.reason) findings.push({ page: name, label: next.label, problem: 'disabled without a visible reason or tip' });
      continue;
    }
    if (next.verifyOnly || next.current) continue;
    if (process.env.AUDIT_VERBOSE) console.log(`  · ${name}: ${next.label}`);
    const r = await probe(page, next.id);
    if (!r.effect) findings.push({ page: name, label: next.label, problem: 'no observable effect within 1.5 s' });
    if (r.navigated) {
      await page.goto(url);
      await page.waitForTimeout(900);
      await opts.prepare?.(page);
    } else {
      await closeOverlays(page);
      await opts.prepare?.(page);
    }
  }
  return tested;
}

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
}

function watch(page: Page, allow409: boolean) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|EventSource|net::ERR_ABORTED/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const u = r.url();
    if (!u.includes('/api/') || r.status() < 400) return;
    if (allow409 && r.status() === 409) return;
    problems.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
  });
  return problems;
}

async function samples(page: Page) {
  return page.evaluate(async () => {
    const items = (await (await fetch('/api/v1/projects')).json()).items as { id: string; is_demo: boolean; country_code: string }[];
    return { us: items.find((p) => p.is_demo && p.country_code === 'US')!.id, india: items.find((p) => p.is_demo && p.country_code === 'IN')!.id };
  });
}

function report(name: string, counts: Record<string, number>, findings: Finding[], problems: string[]) {
  const lines = Object.entries(counts).map(([p, n]) => `  ${p.padEnd(32)} ${n}`);
  console.log(`\n[${name}] controls tested per page:\n${lines.join('\n')}`);
  if (findings.length) console.log(`[${name}] findings:\n${findings.map((f) => `  ${f.page} — “${f.label}”: ${f.problem}`).join('\n')}`);
  if (problems.length) console.log(`[${name}] errors:\n  ${Array.from(new Set(problems)).join('\n  ')}`);
}

test.describe('button audit', () => {
  test.describe.configure({ timeout: 30 * 60_000 });

  test('app chrome: header, sidebar, journey, context bar, console, chat', async ({ page }) => {
    const problems = watch(page, true);
    await signIn(page);
    const { us } = await samples(page);
    const findings: Finding[] = [];
    const counts: Record<string, number> = {};
    const base = `/projects/${us}`;
    counts['projects page'] = await auditPage(page, '/projects', 'projects', { exclude: ['[data-testid="assistant-panel"]'] }, findings);
    counts['global settings'] = await auditPage(page, '/settings', 'settings', {}, findings);
    counts['header'] = await auditPage(page, base, 'header', { scope: '[data-testid="app-header"]', exclude: [] }, findings);
    counts['sidebar'] = await auditPage(page, base, 'sidebar', { scope: 'aside', exclude: [], perGroup: 20 }, findings);
    counts['journey + context bar'] = await auditPage(page, base, 'journey', { scope: '[data-testid="journey"]', exclude: [], perGroup: 10 }, findings);
    counts['read-only banner'] = await auditPage(page, base, 'banner', { scope: '[data-testid="locked-banner"]', exclude: [] }, findings);
    counts['run console'] = await auditPage(page, base, 'console', { scope: '[data-run-console]', exclude: [] }, findings);
    // chat launcher + panel (no messages are sent)
    const openChat = async (p: Page) => {
      if (!(await p.getByTestId('assistant-panel').count())) await p.getByTestId('assistant-launcher').click();
      await p.getByTestId('assistant-panel').waitFor();
    };
    counts['chat panel'] = await auditPage(page, base, 'chat', { scope: '[data-testid="assistant-panel"]', exclude: [], prepare: openChat }, findings);
    // phone: the menu button opens the navigation drawer
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    counts['phone header'] = 1;
    report('chrome', counts, findings, problems);
    expect(findings, findings.map((f) => `${f.page}: ${f.label} — ${f.problem}`).join('\n')).toEqual([]);
    expect(Array.from(new Set(problems))).toEqual([]);
  });

  for (const which of ['us', 'india'] as const) {
    test(`locked sample (${which}): every page`, async ({ page }) => {
      const problems = watch(page, true);
      await signIn(page);
      const ids = await samples(page);
      const base = `/projects/${ids[which]}`;
      const findings: Finding[] = [];
      const counts: Record<string, number> = {};
      for (const p of PAGES) counts[p || 'overview'] = await auditPage(page, `${base}/${p}`, p || 'overview', {}, findings);
      report(which, counts, findings, problems);
      expect(findings, findings.map((f) => `${f.page}: ${f.label} — ${f.problem}`).join('\n')).toEqual([]);
      expect(Array.from(new Set(problems))).toEqual([]);
    });
  }

  test('editable copy: every page, then one research run', async ({ page }) => {
    const problems = watch(page, false);
    await signIn(page);
    const { us } = await samples(page);
    const copy = await page.evaluate(async (id) => {
      const r = await fetch(`/api/v1/projects/${id}/duplicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return (await r.json()).id as string;
    }, us);
    const base = `/projects/${copy}`;
    const findings: Finding[] = [];
    const counts: Record<string, number> = {};
    try {
      for (const p of PAGES) counts[p || 'overview'] = await auditPage(page, `${base}/${p}`, p || 'overview', {}, findings);
      report('copy', counts, findings, problems);
      // one cheap research run: the progress panel must appear within 2 s, then cancel it
      await page.goto(base);
      await page.getByTestId('start-research').click();
      await expect(page.getByTestId('research-progress')).toBeVisible({ timeout: 2000 });
      await page.getByTestId('research-progress-console').click({ timeout: 5000 }).catch(() => undefined);
      const runId = await page.evaluate(async (pid) => (await (await fetch(`/api/v1/projects/${pid}/research-runs`)).json()).items[0]?.id as string, copy);
      await page.evaluate(async (rid) => fetch(`/api/v1/runs/${rid}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), runId);
    } finally {
      await page.evaluate(async (id) => fetch(`/api/v1/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) }), copy);
    }
    expect(findings, findings.map((f) => `${f.page}: ${f.label} — ${f.problem}`).join('\n')).toEqual([]);
    expect(Array.from(new Set(problems))).toEqual([]);
  });
});
