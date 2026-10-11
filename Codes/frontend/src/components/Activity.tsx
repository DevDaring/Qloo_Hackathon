/**
 * Activity across the app:
 *  - <ProjectNotifications/> turns live run/job events into toasts with a "View"
 *    action (research finished or waiting for you, strategies ready, flyers or
 *    video ready, a package built) — from any page of the project
 *  - <WorkspaceWatcher/> notices runs that finish while you're elsewhere in the app
 *  - <ActivityIndicator/> is a pulsing header dot whenever a run or job is active;
 *    clicking it opens the live console
 */
import { useEffect, useRef } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { Activity as ActivityIcon } from 'lucide-react';
import { isActiveRun, useProject, useProjects } from '../api/hooks';
import type { RunEvent } from '../api/types';
import { cn } from '../lib/format';
import { useProjectCtx } from './ProjectContext';
import { useToast } from './Toast';

export const OPEN_CONSOLE_EVENT = 'll-open-console';
const OPEN_CONSOLE_FLAG = 'll-open-console';

/** Ask the project layout to open the run console (now, or after navigating to the project). */
export function requestConsole(pid?: string) {
  if (pid) {
    try {
      sessionStorage.setItem(OPEN_CONSOLE_FLAG, pid);
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(new CustomEvent(OPEN_CONSOLE_EVENT, { detail: { pid } }));
}
export function takeConsoleRequest(pid: string): boolean {
  try {
    if (sessionStorage.getItem(OPEN_CONSOLE_FLAG) === pid) {
      sessionStorage.removeItem(OPEN_CONSOLE_FLAG);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function ProjectNotifications() {
  const { pid, events, stream, openDecision, project } = useProjectCtx();
  const nav = useNavigate();
  const toast = useToast();
  const baseline = useRef<number | null>(null);
  const seen = useRef(0);
  const pendingStrategies = useRef<{ n: number; t: number | null }>({ n: 0, t: null });
  // only events that arrive after the live stream connected are news
  useEffect(() => {
    if (baseline.current === null && (stream === 'live' || stream === 'polling')) {
      baseline.current = events.length ? events[events.length - 1].id : 0;
      seen.current = baseline.current;
    }
  }, [stream, events]);
  useEffect(() => {
    if (baseline.current === null) return;
    const fresh = events.filter((e) => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const go = (to: string) => () => nav(`/projects/${pid}${to}`);
    for (const e of fresh) notify(e);
    function notify(e: RunEvent) {
      const kind = String(e.data?.kind ?? '');
      if (e.type === 'run.finished') {
        toast.notify('success', 'Research finished', e.message || 'Results are ready to explore.', { label: 'View results', onClick: go('/compare') });
      } else if (e.type === 'run.waiting') {
        toast.notify('info', 'Your input is needed', e.message, { label: project?.locked ? 'View' : 'Decide', onClick: () => openDecision(e.run_id ?? undefined) });
      } else if (e.type === 'run.failed' || (e.type === 'job.failed' && kind === 'workflow')) {
        toast.notify('error', 'Research stopped', e.message, { label: 'Open console', onClick: () => requestConsole() });
      } else if (e.type === 'run.strategy' && e.data?.status === 'created') {
        // several strategies land within seconds: one notification
        const p = pendingStrategies.current;
        p.n += 1;
        if (p.t) window.clearTimeout(p.t);
        p.t = window.setTimeout(() => {
          toast.notify('success', p.n === 1 ? 'Strategy ready' : `${p.n} strategies ready`, 'Evidence-linked launch hypotheses for your chosen cities and audiences.', { label: 'View', onClick: go('/strategy') });
          p.n = 0;
          p.t = null;
        }, 2500);
      } else if (e.type === 'job.completed' && /image/.test(kind)) {
        toast.notify('success', 'Flyers ready', 'New flyers are waiting for your review.', { label: 'View', onClick: go('/studio') });
      } else if (e.type === 'job.completed' && /video/.test(kind)) {
        toast.notify('success', 'Video ready', 'The video is assembled and waiting for your review.', { label: 'View', onClick: go('/studio') });
      } else if (e.type === 'job.completed' && /export/.test(kind)) {
        toast.notify('success', 'Campaign package ready', 'Download it with its manifest.', { label: 'View', onClick: go('/assets') });
      } else if (e.type === 'job.failed' && /image|video/.test(kind)) {
        toast.notify('error', 'Generation failed', e.message, { label: 'View', onClick: go('/studio') });
      }
    }
  }, [events, nav, pid, toast, openDecision, project?.locked]);
  return null;
}

/** Runs that finish while you are on another page of the app (outside that project). */
export function WorkspaceWatcher() {
  const items = useProjects().data?.items;
  const match = useMatch('/projects/:pid/*');
  const here = match?.params.pid;
  const nav = useNavigate();
  const toast = useToast();
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!items) return;
    for (const p of items) {
      const st = p.last_run?.status ?? '';
      const before = prev.current.get(p.id);
      prev.current.set(p.id, st);
      if (!before || before === st || p.id === here || !isActiveRun(before)) continue;
      if (st === 'waiting_for_user') toast.notify('info', `Input needed: ${p.name}`, 'The research run is waiting for your choice.', { label: 'Open', onClick: () => nav(`/projects/${p.id}`) });
      else if (st === 'completed' || st === 'partially_completed') toast.notify('success', `Research finished: ${p.name}`, 'Results are ready.', { label: 'View', onClick: () => nav(`/projects/${p.id}`) });
      else if (st === 'failed') toast.notify('error', `Research stopped: ${p.name}`, 'Open the project to see why.', { label: 'Open', onClick: () => nav(`/projects/${p.id}`) });
    }
  }, [items, here, nav, toast]);
  return null;
}

/** Pulsing header dot while anything is working; opens the live console. */
export function ActivityIndicator({ compact }: { compact?: boolean }) {
  const match = useMatch('/projects/:pid/*');
  const pid = match?.params.pid;
  const project = useProject(pid).data;
  const projects = useProjects().data?.items ?? [];
  const nav = useNavigate();
  let label: string | null = null;
  let target: string | undefined;
  if (pid && project) {
    const run = project.runs.find((r) => isActiveRun(r.status));
    if (run) label = 'Research running';
    else if (project.active_jobs > 0) label = 'Generating';
    target = pid;
  } else {
    const p = projects.find((x) => isActiveRun(x.last_run?.status));
    if (p) {
      label = `Research running · ${p.name.replace(/\s*\(synthetic\)/, '')}`;
      target = p.id;
    }
  }
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (pid && target === pid) requestConsole();
        else if (target) {
          requestConsole(target);
          nav(`/projects/${target}`);
        }
      }}
      className={cn('inline-flex h-9 max-w-[260px] items-center gap-2 rounded-full border border-accent/30 bg-accent-soft/60 px-3 text-[12.5px] font-semibold text-accent-ink transition hover:border-accent [@media(pointer:coarse)]:h-11', compact && 'px-2.5')}
      data-testid="activity-indicator"
      aria-label={`${label} — open the live console`}
      title="Open the live console"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/60 motion-reduce:animate-none" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <ActivityIcon className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden />
      <span className={cn('truncate', compact && 'sr-only')}>{label}</span>
    </button>
  );
}
