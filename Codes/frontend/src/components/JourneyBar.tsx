import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Check, Hand, Loader2, MapPin, Users } from 'lucide-react';
import { pickDefaultRun, useAreas, useJourneyApi, useRuns } from '../api/hooks';
import { stageForPath, useJourney, type JourneyStage } from '../hooks/useJourney';
import { cn, shortId, timeAgo } from '../lib/format';
import { useProjectCtx } from './ProjectContext';
import { Button, Tooltip } from './ui';

/** Persistent journey + working context, shown at the top of every project page. */
export function JourneyHeader() {
  const { pid, openDecision } = useProjectCtx();
  const loc = useLocation();
  const nav = useNavigate();
  const sub = loc.pathname.split(`/projects/${pid}`)[1]?.replace(/^\//, '') ?? '';
  const here = stageForPath(sub);
  const j = useJourney(pid);
  const next = j.next;
  const goNext = () => {
    if (!next) return;
    if (next.decisionRunId) openDecision(next.decisionRunId);
    else if (next.to) nav(next.to);
  };
  return (
    <div className="border-b border-line bg-surface/80 backdrop-blur-xl" data-testid="journey" data-tour="journey">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-2.5 sm:px-6 lg:px-10 2xl:flex-row 2xl:items-center 2xl:gap-6">
        <nav aria-label="Project journey" className="min-w-0 2xl:flex-1">
          <ol className="scroll-thin flex items-center gap-0 overflow-x-auto pb-0.5 sm:gap-1" aria-busy={j.loading || undefined}>
            {j.stages.map((s, i) => (
              <li key={s.id} className="flex shrink-0 items-center">
                {i > 0 && <span aria-hidden className={cn('mx-0.5 h-px w-2 sm:mx-1 sm:w-6', s.status === 'done' || j.stages[i - 1].status === 'done' ? 'bg-ok/50' : 'bg-line')} />}
                <StageChip s={s} n={i + 1} current={here === s.id} loading={j.loading} />
              </li>
            ))}
          </ol>
        </nav>
        {next && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 2xl:max-w-[520px] 2xl:shrink-0 2xl:flex-nowrap" data-testid="next-action">
            <p className="min-w-0 flex-1 basis-[220px] text-[12.5px] leading-snug text-muted 2xl:text-right">
              <span className="mr-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-subtle 2xl:mr-0 2xl:block">Next step</span>
              {/* on the read-only sample the banner already says why; keep the line short */}
              {j.locked ? <span className="hidden sm:inline">{next.why}</span> : next.why}
            </p>
            <div className="flex shrink-0 items-start gap-2">
              <Button variant="brand" size="sm" className="h-10 shrink-0 px-4" onClick={goNext} icon={next.decisionRunId ? <Hand className="h-4 w-4" /> : undefined}>
                {next.label}
                {!next.decisionRunId && <ArrowRight className="h-4 w-4" />}
              </Button>
              {/* the read-only banner above already offers "Duplicate to edit" (next.secondary) */}
            </div>
          </div>
        )}
      </div>
      <ContextBar />
    </div>
  );
}

function StageChip({ s, n, current, loading }: { s: JourneyStage; n: number; current: boolean; loading: boolean }) {
  const icon =
    s.status === 'done' ? (
      <Check className="h-3 w-3" strokeWidth={3} />
    ) : s.status === 'active' ? (
      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
    ) : s.status === 'attention' ? (
      <AlertCircle className="h-3 w-3" />
    ) : (
      <span className="text-[10px] font-bold">{n}</span>
    );
  const statusText = { done: 'complete', active: 'in progress', attention: 'needs attention', todo: 'not started' }[s.status];
  return (
    <Tooltip
      content={
        loading ? (
          <span>{s.label}</span>
        ) : (
          <span>
            <b>{s.label}</b> — {statusText}
            <br />
            {s.summary}
            {s.blockers.length > 0 && (
              <>
                <br />
                To do: {s.blockers.map((b) => b.text).join('; ')}
              </>
            )}
          </span>
        )
      }
    >
      <Link
        to={s.to}
        aria-current={current ? 'step' : undefined}
        aria-label={loading ? s.label : `${s.label}: ${statusText}`}
        className={cn(
          'relative inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-full border px-2 text-[13px] sm:px-3 font-semibold transition [@media(pointer:coarse)]:h-11',
          current ? 'border-fg/25 bg-surface2 text-fg shadow-card' : 'border-transparent text-muted hover:bg-surface2 hover:text-fg',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full',
            s.status === 'done' && 'bg-ok text-white',
            s.status === 'active' && 'bg-accent text-white',
            s.status === 'attention' && 'bg-warn-soft text-warn ring-1 ring-warn/40',
            s.status === 'todo' && 'bg-surface2 text-subtle ring-1 ring-line',
            loading && 'animate-pulse motion-reduce:animate-none',
          )}
          aria-hidden
        >
          {icon}
        </span>
        <span className={current ? '' : 'hidden sm:inline'}>{s.label}</span>
        {current && <motion.span layoutId="journey-current" className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full bg-gradient-to-r from-[#FF7A45] to-[#1F6FEB]" />}
      </Link>
    </Tooltip>
  );
}

/** Project · audience · city · research run — the working context every page uses. */
function ContextBar() {
  const { pid, project, sel, setSel } = useProjectCtx();
  const runs = useRuns(pid).data?.items ?? [];
  const areas = (useAreas(pid).data?.items ?? []).filter((a) => a.kind !== 'saved');
  const run = pickDefaultRun(runs, sel.runId);
  const auds = project?.audiences ?? [];
  const productVersion = useJourneyApi(pid).data?.context.product_version;
  const selectCls =
    'h-8 max-w-[220px] cursor-pointer truncate rounded-lg border border-line bg-surface px-2 pr-6 text-[12.5px] font-medium text-fg [@media(pointer:coarse)]:h-11 appearance-none bg-[length:14px] bg-[right_6px_center] bg-no-repeat ' +
    "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23697085' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]";
  return (
    <div className="border-t border-line/70 bg-surface2/40" data-testid="context-bar">
      <div className="scroll-thin mx-auto flex max-w-[1440px] items-center gap-2 overflow-x-auto px-4 py-1.5 text-[12.5px] sm:px-6 lg:px-10">
        <span className="shrink-0 font-semibold text-fg" title={project?.name}>
          {project ? (project.name.length > 34 ? `${project.name.slice(0, 32)}…` : project.name) : '…'}
        </span>
        {productVersion != null && (
          <span className="shrink-0 rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] font-semibold text-muted" title="Product brief version used by new work">
            Product v{productVersion}
          </span>
        )}
        <span aria-hidden className="text-subtle">·</span>
        <label className="flex shrink-0 items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-subtle" aria-hidden />
          <span className="sr-only">Audience</span>
          <select className={selectCls} value={sel.audienceId ?? ''} onChange={(e) => setSel({ audienceId: e.target.value || undefined })}>
            <option value="">All audiences</option>
            {auds.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name.replace(/\s*\(hypothetical persona\)/i, '')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex shrink-0 items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-subtle" aria-hidden />
          <span className="sr-only">City</span>
          <select className={selectCls} value={sel.areaId ?? ''} onChange={(e) => setSel({ areaId: e.target.value || undefined })}>
            <option value="">All cities</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex shrink-0 items-center gap-1.5">
          <span className="text-subtle">Research</span>
          <select className={selectCls} value={sel.runId ?? ''} onChange={(e) => setSel({ runId: e.target.value || undefined })} aria-label="Research run">
            <option value="">Latest{run && !sel.runId ? ` (${shortId(run.id)})` : ''}</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {shortId(r.id)} · {r.status.replace(/_/g, ' ')}
                {r.qloo_enabled ? '' : ' · no Qloo'} · {timeAgo(r.created_at)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
