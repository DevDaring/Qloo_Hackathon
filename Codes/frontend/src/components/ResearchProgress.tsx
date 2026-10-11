/**
 * "Research in progress" — never an idle screen while a run works.
 *
 * Shown at the top of the research pages whenever a run is queued, running or
 * waiting for the user. It lists the real stages (from run.stage_statuses and
 * the live event stream) with a check / spinner / pending dot, the current
 * step's live message, elapsed time and an honest typical duration per stage —
 * no fake percentages — and partial results as they land.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Check, Circle, Hand, Loader2, MapPin, Minus, Sparkles, Terminal, TriangleAlert, X } from 'lucide-react';
import { isActiveRun, useAnalytics, useRun, useRuns } from '../api/hooks';
import type { Run, RunDetail } from '../api/types';
import { cn } from '../lib/format';
import { useProjectCtx } from './ProjectContext';
import { stageState } from './StageTimeline';
import { Button } from './ui';

const STEPS: { key: string; label: string; typical: string }[] = [
  { key: 'intake_validator', label: 'Checking the brief', typical: 'a few seconds' },
  { key: 'research_planner', label: 'Planning', typical: 'a few seconds' },
  { key: 'entity_resolver', label: 'Matching interests (Qloo)', typical: 'under 10 seconds — instant when cached' },
  { key: 'geographic_researcher', label: 'Finding places & climate', typical: 'usually under a minute' },
  { key: 'taste_analyst', label: 'Qloo taste comparison', typical: '10–30 seconds — instant when cached' },
  { key: 'market_evaluator', label: 'Ranking cities', typical: 'a few seconds' },
  { key: 'placement_researcher', label: 'Shortlisting venues', typical: 'a few seconds' },
  { key: 'await_selection', label: 'Your choice: cities × audiences', typical: 'waits for you' },
  { key: 'strategy_writer', label: 'Writing strategies', typical: 'about 20–60 seconds' },
  { key: 'creative_planner', label: 'Drafting briefs', typical: 'about 20–40 seconds' },
];

const fmtElapsed = (s: number) => (s < 60 ? `${Math.max(0, Math.floor(s))} s` : `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`);

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** The run the progress panel follows: the newest one that is queued, running or (on editable projects) waiting for the user. */
export function useActiveRun(): Run | undefined {
  const { pid, project } = useProjectCtx();
  const runs = useRuns(pid).data?.items ?? [];
  return runs.find((r) => isActiveRun(r.status) || (!project?.locked && r.status === 'waiting_for_user'));
}

export function ResearchProgress({ className }: { className?: string }) {
  const run = useActiveRun();
  return <AnimatePresence>{run && <Panel key={run.id} runId={run.id} className={className} />}</AnimatePresence>;
}

function Panel({ runId, className }: { runId: string; className?: string }) {
  const { pid, project, events, openDecision, setConsoleOpen, setConsoleRunId } = useProjectCtx();
  const rd = useRun(runId).data;
  const run = rd?.run;
  const waiting = run?.status === 'waiting_for_user';
  const now = useNow(!!run && !waiting);
  const runEvents = useMemo(() => events.filter((e) => e.run_id === runId), [events, runId]);
  const last = [...runEvents].reverse().find((e) => e.type === 'run.stage' || e.type === 'run.strategy' || e.type === 'job.progress');
  const openConsole = () => {
    setConsoleRunId(runId);
    setConsoleOpen(true);
  };
  const elapsed = run ? (now - new Date(run.created_at).getTime()) / 1000 : 0;
  // the event stream is faster than the run record (polled): use the newest stage status from either
  const liveStatus = useMemo(() => {
    const m: Record<string, { status: string; at: string }> = {};
    for (const e of runEvents) if (e.type === 'run.stage' && typeof e.data?.status === 'string') m[e.stage] = { status: e.data.status as string, at: e.created_at };
    return m;
  }, [runEvents]);

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      aria-label="Research in progress"
      data-testid="research-progress"
      data-status={run?.status ?? 'loading'}
      className={cn(
        'relative mb-6 overflow-hidden rounded-3xl border p-5 shadow-card sm:p-6',
        waiting ? 'border-brand/40 bg-gradient-to-br from-brand-soft/80 via-surface to-surface' : 'border-accent/30 bg-gradient-to-br from-accent-soft/70 via-surface to-surface',
        className,
      )}
    >
      {!waiting && <div aria-hidden className="shimmer-bar absolute inset-x-0 top-0 h-[3px]" />}
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white', waiting ? 'bg-brand' : 'bg-accent')} aria-hidden>
          {waiting ? <Hand className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />}
        </span>
        <div className="min-w-0 flex-1 basis-[200px]">
          <h2 className="font-display text-[18px] font-bold leading-snug">
            {waiting ? 'Your input needed' : run?.status === 'queued' ? 'Research is starting' : 'Research in progress'}
          </h2>
          <p className="text-[13.5px] text-muted" aria-live="polite" data-testid="research-progress-message">
            {waiting
              ? run?.pending_decision?.title ?? 'The run is paused for your decision.'
              : last?.message ?? (run?.status === 'queued' ? 'Waiting for a worker to pick up the run…' : 'Working…')}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {!waiting && run && (
            <span className="num rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted shadow-card" title="Time since the run started">
              {fmtElapsed(elapsed)}
            </span>
          )}
          {waiting ? (
            <Button variant="brand" icon={<Hand className="h-4 w-4" />} onClick={() => openDecision(runId)} data-testid="research-progress-decide">
              {run?.pending_decision?.type === 'select_targets' ? 'Choose cities & audiences' : 'Review & decide'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" icon={<Terminal className="h-3.5 w-3.5" />} onClick={openConsole} data-testid="research-progress-console">
              Open live console
            </Button>
          )}
        </div>
      </div>

      {run && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <ol className="space-y-1.5" aria-label="Research stages">
            {STEPS.map((s) => (
              <StepRow key={s.key} step={s} run={run} now={now} live={liveStatus[s.key]} />
            ))}
          </ol>
          <Partial rd={rd!} pid={pid} runId={runId} events={runEvents} />
        </div>
      )}
      {!run && <div className="mt-4 h-24 animate-pulse rounded-2xl bg-surface2/70 motion-reduce:animate-none" />}

      {!waiting && (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
          <Bell className="h-3.5 w-3.5 text-accent-ink" aria-hidden />
          Keep exploring — we’ll notify you when results are ready{project?.name ? '' : ''}.
        </p>
      )}
    </motion.section>
  );
}

function StepRow({ step, run, now, live }: { step: (typeof STEPS)[number]; run: Run; now: number; live?: { status: string; at: string } }) {
  const recorded = stageState(run, step.key);
  // a live event wins over a stale "pending"/"running" from the polled run record
  const st = live && (recorded.status === 'pending' || recorded.status === 'running') ? { status: live.status, at: live.at } : recorded;
  const status = st.status;
  const done = status === 'completed' || status.startsWith('resumed') || status.includes('selected');
  const running = status === 'running';
  const waiting = status === 'waiting' || status === 'needs_input';
  const failed = status === 'failed';
  const partial = status === 'partial';
  const skipped = status === 'skipped' || status === 'unavailable';
  return (
    <li className={cn('flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px]', running && 'bg-accent-soft/60', waiting && 'bg-brand-soft/60')} data-stage={step.key} data-state={status}>
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          done && 'bg-ok text-white',
          running && 'bg-accent text-white',
          waiting && 'bg-brand text-[#1A0E08]',
          failed && 'bg-bad text-white',
          partial && 'bg-amber-400 text-[#2a1a00]',
          skipped && 'bg-surface2 text-subtle',
          !done && !running && !waiting && !failed && !partial && !skipped && 'border border-line bg-surface text-line',
        )}
        aria-hidden
      >
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : running ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : waiting ? <Hand className="h-3 w-3" /> : failed ? <X className="h-3 w-3" /> : partial ? <TriangleAlert className="h-3 w-3" /> : skipped ? <Minus className="h-3 w-3" /> : <Circle className="h-1.5 w-1.5 fill-current" />}
      </span>
      <span className={cn('min-w-0 flex-1', !done && !running && !waiting && 'text-muted')}>
        {step.label}
        <span className="sr-only"> — {done ? 'done' : running ? 'in progress' : waiting ? 'waiting for you' : failed ? 'failed' : skipped ? 'skipped' : 'not started'}</span>
      </span>
      <span className="shrink-0 text-[11.5px] text-subtle">
        {running ? `${step.typical}` : waiting ? st.note ?? 'waiting for you' : done && st.at ? new Date(st.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : skipped ? 'skipped' : failed ? 'failed' : ''}
      </span>
      {running && st.at && <span className="sr-only">{Math.round((now - new Date(st.at).getTime()) / 1000)} seconds</span>}
    </li>
  );
}

/** Partial results as they land, with a small reveal. */
function Partial({ rd, pid, runId, events }: { rd: RunDetail; pid: string; runId: string; events: { type: string; message: string; stage: string; data: Record<string, unknown> }[] }) {
  const run = rd.run;
  const places = run.counts?.places ?? 0;
  const placements = run.counts?.placements ?? 0;
  const analytics = useAnalytics(places > 0 ? runId : undefined, {}).data;
  const perCity = analytics
    ? Object.entries(analytics.category_distribution ?? {}).map(([area, m]) => ({ area, n: Object.values(m).reduce((a, b) => a + b, 0) }))
    : [];
  const entity = [...events].reverse().find((e) => e.stage === 'entity_resolver' && e.type === 'run.stage');
  const taste = [...events].reverse().find((e) => e.stage === 'taste_analyst' && e.type === 'run.stage');
  const strategies = events.filter((e) => e.type === 'run.strategy' && e.data?.status === 'created').length;
  const targets = run.selections?.targets?.length ?? 0;
  const items: { key: string; node: React.ReactNode }[] = [];
  if (entity) items.push({ key: 'entity', node: <>{entity.message}</> });
  if (places > 0)
    items.push({
      key: 'places',
      node: (
        <>
          <b className="num">{places.toLocaleString()}</b> places found
          {perCity.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {perCity.map((c) => (
                <span key={c.area} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-[2px] text-[11.5px] shadow-card">
                  <MapPin className="h-3 w-3 text-brand-ink" aria-hidden /> {c.area} · <b className="num">{c.n}</b>
                </span>
              ))}
            </span>
          )}
        </>
      ),
    });
  else if (stageState(run, 'geographic_researcher').status === 'running')
    items.push({ key: 'places-pending', node: <span className="text-muted">Finding places… the first ones appear here as soon as each city is retrieved.</span> });
  if (taste) items.push({ key: 'taste', node: <>{taste.message}</> });
  if (rd.assessments.length)
    items.push({
      key: 'cities',
      node: (
        <>
          <b className="num">{rd.assessments.length}</b> cities checked
          <span className="mt-1 flex flex-wrap gap-1">
            {[...rd.assessments]
              .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
              .map((a) => (
                <span key={a.area_id} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-medium', a.eligible ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
                  {a.eligible ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                  {a.area_name} · {a.eligible ? (a.rank ? `rank #${a.rank}` : 'eligible') : 'excluded'}
                </span>
              ))}
          </span>
        </>
      ),
    });
  if (placements > 0) items.push({ key: 'placements', node: <><b className="num">{placements}</b> venue candidates shortlisted (all unverified)</> });
  if (strategies > 0 || stageState(run, 'strategy_writer').status === 'running')
    items.push({
      key: 'strategies',
      node: (
        <>
          Strategies ready: <b className="num">{strategies}</b>
          {targets ? ` of ${targets}` : ''}
          {strategies > 0 && (
            <Link to={`/projects/${pid}/strategy`} className="link ml-2 text-[12.5px]">
              View
            </Link>
          )}
        </>
      ),
    });
  return (
    <div className="rounded-2xl border border-line bg-surface/80 p-4" data-testid="research-partial">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <Sparkles className="h-3.5 w-3.5 text-brand-ink" aria-hidden /> Results so far
      </p>
      {items.length === 0 ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-3 w-3/4 animate-pulse rounded bg-surface2 motion-reduce:animate-none" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface2 motion-reduce:animate-none" />
          <p className="pt-1 text-[12.5px] text-muted">The first results appear here within seconds.</p>
        </div>
      ) : (
        <ul className="space-y-2 text-[13px]">
          <AnimatePresence initial={false}>
            {items.map((it) => (
              <motion.li key={it.key} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="leading-snug">
                {it.node}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
