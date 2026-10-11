#!/usr/bin/env node
/**
 * Captures the annotated screenshots for the chat how-to guides
 * (backend/launchlens/services/howto.py) into public/guide/<key>/<n>.webp.
 *
 * Run manually against a running app (dev server + API), never in the tests:
 *   cd frontend && node scripts/capture-guides.mjs            # all guides
 *   GUIDES=create_video,export_package node scripts/capture-guides.mjs
 *
 * Safety: nothing that writes or spends is clicked — dialogs are opened, never
 * confirmed. The US sample is unlocked only for the capture (so buttons render
 * enabled) and locked again in `finally`. Research steps use a fresh duplicate
 * of the US sample with no research run (runs are mocked in the browser), which
 * is archived afterwards.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const PY = path.resolve(here, '../../backend/.venv/bin/python');
const TOOLS = path.resolve(here, 'guide_tools.py');
const OUT = path.resolve(here, '../public/guide');
const PNG = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-png-'));
const ONLY = process.env.GUIDES ? new Set(process.env.GUIDES.split(',')) : null;
const VW = 1440;
const VH = 900;
const CW = 900;
const CH = 560;

const py = (...args) => execFileSync(PY, [TOOLS, ...args], { stdio: 'inherit' });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, colorScheme: 'dark', deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('ll-theme', 'dark');
    localStorage.setItem('ll-guide-done', '1');
    sessionStorage.setItem('ll-assistant-pulsed', '1');
  } catch {
    /* ignore */
  }
});
const boot = await ctx.newPage();
await boot.goto(`${BASE}/login`);
await boot.getByRole('button', { name: 'Use jury login' }).click();
await boot.waitForURL(/\/projects$/);
const api = (p, init) => boot.evaluate(async ([p, init]) => (await fetch(`/api/v1${p}`, init)).json(), [p, init ?? null]);
const projects = (await api('/projects')).items;
const S = projects.find((p) => p.is_demo && p.country_code === 'US').id;
const I = projects.find((p) => p.is_demo && p.country_code === 'IN').id;
let C = null; // the editable copy used for the research steps
const failures = [];

/* ------------------------------------------------------------------ helpers */
const side = (pid, sub) => `aside a[href="/projects/${pid}${sub ? `/${sub}` : ''}"]`;

async function freshPage() {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const css = '[data-testid="assistant-launcher"],[data-testid="toast"],[data-testid="tip-card"],[data-testid="update-bar"]{display:none!important}';
    const add = () => {
      if (!document.head) return false;
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
      return true;
    };
    if (!add()) document.addEventListener('DOMContentLoaded', add);
  });
  return page;
}

async function open(page, url) {
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1500);
}

/** Ring + numbered badge around the target, then a 900×560 crop around it. */
async function shoot(page, target, key, n) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  let box = await loc.boundingBox();
  if (box.y < 70 || box.y + box.height > VH - 60) {
    await loc.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    box = await loc.boundingBox();
  }
  await page.evaluate(
    ([b, n]) => {
      document.querySelectorAll('[data-guide-annot]').forEach((x) => x.remove());
      const pad = 6;
      const ring = document.createElement('div');
      ring.dataset.guideAnnot = '1';
      Object.assign(ring.style, {
        position: 'fixed',
        left: `${b.x - pad}px`,
        top: `${b.y - pad}px`,
        width: `${b.width + pad * 2}px`,
        height: `${b.height + pad * 2}px`,
        border: '3px solid #FF7A45',
        borderRadius: '14px',
        boxShadow: '0 0 0 4px rgba(255,122,69,.28), 0 0 34px 6px rgba(255,122,69,.45)',
        zIndex: '2147483646',
        pointerEvents: 'none',
      });
      const badge = document.createElement('div');
      badge.dataset.guideAnnot = '1';
      badge.textContent = String(n);
      Object.assign(badge.style, {
        position: 'fixed',
        left: `${Math.max(4, b.x - pad - 16)}px`,
        top: `${Math.max(4, b.y - pad - 16)}px`,
        width: '32px',
        height: '32px',
        borderRadius: '999px',
        background: 'linear-gradient(135deg,#FF7A45,#1F6FEB)',
        color: '#fff',
        font: '700 16px/32px Inter, system-ui, sans-serif',
        textAlign: 'center',
        boxShadow: '0 4px 14px rgba(0,0,0,.45)',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      document.body.append(ring, badge);
    },
    [box, n],
  );
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // wide targets: keep their left edge (with the numbered badge) in view
  const x = Math.round(box.width > CW - 60 ? Math.min(Math.max(box.x - 40, 0), VW - CW) : Math.min(Math.max(cx - CW / 2, 0), VW - CW));
  // tall targets: keep their top (with the badge) in view
  const y = Math.round(box.height > CH - 60 ? Math.min(Math.max(box.y - 40, 0), VH - CH) : Math.min(Math.max(cy - CH / 2, 0), VH - CH));
  const file = path.join(PNG, key, `${n}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, clip: { x, y, width: CW, height: CH } });
  console.log(`captured ${key}/${n}`);
}

/** The newest completed Qloo run of the US sample, shown as running / waiting on the copy (browser-side mock only). */
async function mockRun(page, status) {
  const runs = (await api(`/projects/${S}/research-runs`)).items;
  const base = runs.find((r) => r.qloo_enabled && ['completed', 'partially_completed'].includes(r.status));
  const detail = await api(`/runs/${base.id}`);
  const audiences = (await api(`/projects/${S}`)).audiences;
  const eligible = detail.assessments.filter((a) => a.eligible);
  const options = eligible.flatMap((a) => audiences.map((au) => ({ area_id: a.area_id, area_name: a.area_name, status: a.status, rank: a.rank, audience_version_id: au.id, audience_name: au.name, audience_role: au.role })));
  const pd = status === 'waiting_for_user' ? { type: 'select_targets', title: 'Choose location × audience pairs for strategies', options, suggested: options.slice(0, 2) } : null;
  const order = ['intake_validator', 'research_planner', 'entity_resolver', 'geographic_researcher', 'taste_analyst', 'market_evaluator', 'placement_researcher'];
  const ss = {};
  const upto = status === 'running' ? 4 : order.length;
  order.slice(0, upto).forEach((k) => (ss[k] = detail.run.stage_statuses?.[k] ?? { status: 'completed' }));
  if (status === 'running') ss.taste_analyst = { status: 'running' };
  const t0 = Date.now() - 26_000; // a run that started moments ago
  order.slice(0, upto).forEach((k, i) => (ss[k] = { status: 'completed', at: new Date(t0 + 2000 * (i + 1)).toISOString() }));
  if (status === 'running') ss.taste_analyst = { status: 'running' };
  const run = { ...detail.run, created_at: new Date(t0).toISOString(), project_id: C, status, stage: status === 'running' ? 'taste_analyst' : 'placement_researcher', stage_statuses: ss, pending_decision: pd, selections: {} };
  await page.route(`**/api/v1/projects/${C}/research-runs*`, (r) => r.fulfill({ json: { items: [run] } }));
  await page.route(`**/api/v1/runs/${base.id}`, (r) =>
    r.fulfill({ json: { ...detail, run, assessments: status === 'running' ? [] : detail.assessments, jobs: [], strategy_ids: [] } }),
  );
}

/** A video job in progress on the open brief (browser-side mock: nothing is generated). */
async function mockVideoJob(page) {
  const JOB = '00000000-0000-4000-8000-00000000c0de';
  const t0 = new Date(Date.now() - 64_000).toISOString();
  await page.addInitScript((j) => sessionStorage.setItem(`ll-job-plan-${j}`, JSON.stringify({ kind: 'video', orientations: ['vertical'] })), JOB);
  await page.route('**/api/v1/creative-briefs/*', async (route) => {
    if (route.request().method() !== 'GET' || /estimate|trace/.test(route.request().url())) return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    body.jobs = [{ id: JOB, kind: 'video', status: 'running', attempts: 1, max_attempts: 2, progress: { stage: 'video' }, result: {}, error: null, project_id: S, run_id: null, cost_cap_usd: 2, created_at: t0, updated_at: t0, finished_at: null, heartbeat_at: t0 }, ...body.jobs];
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/v1/projects/*/event-stream*', (r) => r.abort());
  await page.route(`**/api/v1/projects/${S}/events*`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const ev = (id, message) => ({ id, type: 'job.progress', stage: 'video', message, data: {}, run_id: null, job_id: JOB, created_at: new Date().toISOString() });
    body.items.push(ev(8_000_001, 'Scene 1 submitted'), ev(8_000_002, 'Scene 2 submitted'), ev(8_000_003, 'Scene 1 clip downloaded'), ev(8_000_004, 'Scene 3 submitted'));
    body.last_id = 8_000_004;
    await route.fulfill({ response: res, json: body });
  });
}

/* ------------------------------------------------------------------ recipes */
function recipes() {
  const studio = `/projects/${S}/studio`;
  return {
    create_video: [
      async (p) => (await open(p, studio), side(S, 'studio')),
      async (p) => (await open(p, studio), '#variants'),
      async (p) => (await open(p, `${studio}?tab=video`), '#video-tab'),
      async (p) => (await open(p, `${studio}?tab=video`), '#generate-video'),
      async (p) => {
        await open(p, `${studio}?tab=video`);
        await p.locator('#generate-video').click();
        return p.getByRole('dialog').last();
      },
      async (p) => {
        await mockVideoJob(p);
        await open(p, studio);
        await p.waitForTimeout(3500);
        return '[data-testid="generation-progress"]';
      },
    ],
    create_flyers: [
      async (p) => (await open(p, studio), side(S, 'studio')),
      async (p) => (await open(p, studio), '#variants'),
      async (p) => (await open(p, studio), '#generate-flyers'),
      async (p) => {
        await open(p, studio);
        await p.locator('#generate-flyers').click();
        return p.getByRole('dialog').last();
      },
      async (p) => (await open(p, `/projects/${S}/assets`), p.locator('#main [data-media]').first()),
    ],
    new_brief: [
      async (p) => (await open(p, studio), side(S, 'studio')),
      async (p) => (await open(p, studio), '#new-brief'),
      async (p) => {
        await open(p, studio);
        await p.locator('#new-brief').click();
        return p.getByRole('dialog').last();
      },
      async (p) => (await open(p, studio), '#variants'),
    ],
    start_research: [
      async (p) => (await open(p, `/projects/${C}/explorer`), side(C, 'explorer')),
      async (p) => (await open(p, `/projects/${C}/explorer`), '#start'),
      async (p) => (await mockRun(p, 'running'), await open(p, `/projects/${C}`), await p.waitForTimeout(2500), '[data-testid="research-progress"]'),
      async (p) => (await mockRun(p, 'waiting_for_user'), await open(p, `/projects/${C}`), await p.waitForTimeout(2500), '[data-testid="research-progress-decide"]'),
    ],
    choose_targets: [
      async (p) => (await mockRun(p, 'waiting_for_user'), await open(p, `/projects/${C}`), await p.waitForTimeout(2500), '[data-testid="research-progress-decide"]'),
      async (p) => {
        await mockRun(p, 'waiting_for_user');
        await open(p, `/projects/${C}`);
        await p.waitForTimeout(2500);
        await p.getByTestId('research-progress-decide').click();
        await p.waitForTimeout(1200);
        return p.getByRole('dialog').last();
      },
      async (p) => (await open(p, `/projects/${S}/strategy`), '[data-tour="strategy"]'),
    ],
    taste_story: [
      async (p) => (await open(p, `/projects/${S}/audiences`), side(S, 'audiences')),
      async (p) => (await open(p, `/projects/${S}/audiences`), '#taste-story'),
      async (p) => {
        await open(p, `/projects/${S}/audiences`);
        await p.waitForTimeout(2000);
        const node = p.locator('[data-testid="taste-diagram"] button[data-node^="interest:"], [data-testid="taste-diagram"] [data-node="interest_set"]').first();
        await node.hover();
        await p.waitForTimeout(600);
        return '[data-testid="taste-diagram"]';
      },
    ],
    compare_audiences: [
      async (p) => (await open(p, `/projects/${S}/audiences`), side(S, 'audiences')),
      async (p) => (await open(p, `/projects/${S}/audiences`), p.getByRole('tab', { name: /Compare two audiences/ })),
      async (p) => (await open(p, `/projects/${S}/audiences?view=compare`), await p.waitForTimeout(1500), '[data-testid="audience-compare"]'),
    ],
    export_package: [
      async (p) => (await open(p, `/projects/${S}/assets`), side(S, 'assets')),
      async (p) => (await open(p, `/projects/${S}/assets`), '#build-package'),
      async (p) => (await open(p, `/projects/${S}/assets`), '[data-tour="packages"]'),
    ],
    duplicate_sample: [
      async (p) => (await open(p, `/projects/${I}`), '#main h1'),
      async (p) => (await open(p, `/projects/${I}`), '#duplicate'),
      async (p) => (await open(p, `/projects/${C}`), '[data-testid="start-research"]'),
    ],
    provider_status: [
      async (p) => (await open(p, `/projects/${S}`), side(S, 'settings')),
      async (p) => (await open(p, `/projects/${S}/settings`), '[data-tour="providers"]'),
    ],
  };
}

async function run() {
  for (const [key, steps] of Object.entries(recipes())) {
    if (ONLY && !ONLY.has(key)) continue;
    for (let i = 0; i < steps.length; i++) {
      const page = await freshPage();
      try {
        const target = await steps[i](page);
        await shoot(page, target, key, i + 1);
      } catch (e) {
        failures.push(`${key}/${i + 1}: ${String(e.message).split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
  }
}

/* ------------------------------------------------------------------ main */
try {
  py('unlock', S);
  C = (await api(`/projects/${S}/duplicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).id;
  await run();
} finally {
  try {
    py('lock', S);
  } catch (e) {
    console.error('!! could not re-lock the US sample — lock it by hand', e.message);
  }
  if (C) await api(`/projects/${C}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) }).catch(() => undefined);
  await browser.close();
}
py('webp', PNG, OUT);
fs.rmSync(PNG, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} step(s) not captured (the chat shows them without an image):\n  ${failures.join('\n  ')}`);
}

