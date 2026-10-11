import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, ChevronUp, CircleStop, Hand, Play, Radio, Terminal, WifiOff } from 'lucide-react';
import { isActiveRun, mutations, useApiMutation, useRun } from '../api/hooks';
import type { RunEvent } from '../api/types';
import { cn, fmtTime, humanize, shortId, timeAgo } from '../lib/format';
import { STAGES } from '../lib/labels';
import { researchPrereqs } from '../hooks/useJourney';
import { Editable } from './Locked';
import { ActionPreview } from './ActionPreview';
import { useProjectCtx } from './ProjectContext';
import { StageTimeline } from './StageTimeline';
import { ConfirmDialog } from './Overlay';
import { useToast } from './Toast';
import { Badge, Button, Select, StatusPill } from './ui';

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

function eventTone(t: string): 'ok' | 'bad' | 'brand' | 'accent' | 'warn' | 'neutral' {
  if (t.endsWith('completed') || t === 'run.strategy') return 'ok';
  if (t.endsWith('failed')) return 'bad';
  if (t === 'run.waiting' || t.endsWith('waiting_for_user')) return 'brand';
  if (t.endsWith('partially_completed') || t.endsWith('cancelled')) return 'warn';
  if (t.endsWith('running') || t.endsWith('progress') || t === 'run.stage') return 'accent';
  return 'neutral';
}

export function RunConsole() {
  const { pid, project, events, stream, consoleRunId, setConsoleRunId, openDecision, consoleOpen: open, setConsoleOpen: setOpen } = useProjectCtx();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const toast = useToast();
  const runs = project?.runs ?? [];
  const runId = consoleRunId ?? runs[0]?.id;
  const rq = useRun(runId);
  const run = rq.data?.run;
  const cancel = useApiMutation((id: string) => mutations.cancelRun(id), [['run'], ['project', pid], ['runs', pid]]);
  const start = useApiMutation(() => mutations.startRun(pid), [['project', pid], ['runs', pid]]);

  const runEvents = useMemo(() => events.filter((e) => !runId || e.run_id === runId || !e.run_id).slice().reverse(), [events, runId]);
  const latest: RunEvent | undefined = runEvents[0];
  const active = isActiveRun(run?.status);
  const waiting = run?.status === 'waiting_for_user';

  const streamBadge =
    stream === 'live' ? (
      <Badge tone="ok" icon={<Radio className="h-3 w-3" />}>Live</Badge>
    ) : stream === 'polling' ? (
      <Badge tone="warn" icon={<Activity className="h-3 w-3" />}>Polling</Badge>
    ) : stream === 'offline' ? (
      <Badge tone="bad" icon={<WifiOff className="h-3 w-3" />}>Offline</Badge>
    ) : (
      <Badge tone="neutral">Connecting</Badge>
    );

  return (
    <section id="run-console" aria-label="Run console" data-run-console className="pointer-events-none sticky bottom-0 z-30 mt-auto">
      <div className="pointer-events-auto mx-auto w-full">
        <div className={cn('border-t border-line bg-surface/90 shadow-[0_-12px_30px_-18px_rgb(14_19_32/0.35)] backdrop-blur-xl', open && 'bg-surface/95')}>
          {/* collapsed bar */}
          <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="run-console-panel"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 text-left"
            >
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', active ? 'bg-accent-soft text-accent-ink' : waiting ? 'bg-brand-soft text-brand-ink' : 'bg-surface2 text-muted')}>
                <Terminal className="h-3.5 w-3.5" />
              </span>
              <span className="hidden text-[13px] font-semibold sm:inline">Run console</span>
              {run ? <StatusPill status={run.status} /> : runs.length === 0 ? <Badge>No runs yet</Badge> : null}
              <span className="min-w-0 truncate text-[13px] text-muted">
                {waiting
                  ? run?.pending_decision?.title
                  : latest
                    ? `${latest.message}${latest.stage ? ` · ${STAGE_LABEL[latest.stage] ?? humanize(latest.stage)}` : ''}`
                    : run
                      ? `${STAGE_LABEL[run.stage] ?? humanize(run.stage)} · updated ${timeAgo(run.updated_at)}`
                      : 'Start research to see live progress here.'}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden md:inline-flex">{streamBadge}</span>
              {waiting && (
                <Button size="sm" variant={project?.locked ? 'outline' : 'brand'} icon={<Hand className="h-3.5 w-3.5" />} onClick={() => openDecision(run?.id)}>
                  <span className="hidden sm:inline">{project?.locked ? 'View decision' : 'Decide'}</span>
                </Button>
              )}
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg"
                aria-label={open ? 'Collapse run console' : 'Expand run console'}
              >
                <ChevronUp className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                id="run-console-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 34 }}
                className="overflow-hidden"
              >
                <div className="grid max-h-[52vh] gap-4 overflow-y-auto border-t border-line px-3 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor="console-run">Run</label>
                      <Select id="console-run" className="h-8 w-auto py-1 text-xs" value={runId ?? ''} onChange={(e) => setConsoleRunId(e.target.value || undefined)}>
                        {runs.map((r) => (
                          <option key={r.id} value={r.id}>
                            Run {shortId(r.id)} · {r.status.replace(/_/g, ' ')}
                            {' · '}{timeAgo(r.created_at)}
                          </option>
                        ))}
                      </Select>
                      {run && (
                        <span className="text-xs text-subtle">
                          started {timeAgo(run.created_at)} · updated {timeAgo(run.updated_at)}
                        </span>
                      )}
                      <span className="md:hidden">{streamBadge}</span>
                      <div className="ml-auto flex gap-1.5">
                        {active && (
                          <Editable>
                            <Button size="sm" variant="outline" icon={<CircleStop className="h-3.5 w-3.5" />} onClick={() => setConfirmCancel(true)}>
                              Cancel run
                            </Button>
                          </Editable>
                        )}
                        {!active && (
                          <ActionPreview edit inlineReason={false} tipKey="start-research" disabledReason={researchPrereqs(project).length ? `First ${researchPrereqs(project).join(', ')}.` : undefined}>
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<Play className="h-3.5 w-3.5" />}
                            disabled={researchPrereqs(project).length > 0}
                            loading={start.isPending}
                            onClick={() =>
                              start.mutate(undefined, {
                                onSuccess: (r) => {
                                  toast.success('Research run started', 'Progress appears here as each stage finishes.');
                                  setConsoleRunId(r.run.id);
                                },
                                onError: (e) => toast.error('Could not start research', e),
                              })
                            }
                          >
                            New research run
                          </Button>
                          </ActionPreview>
                        )}
                      </div>
                    </div>
                    {run ? (
                      <>
                        <StageTimeline run={run} />
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(run.counts ?? {}).map(([k, v]) => {
                            // counts are numbers, except provider call summaries (e.g. qloo: {logical_requests, cache_hits, …})
                            const obj = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
                            const n = obj ? Number(obj.logical_requests ?? obj.calls ?? NaN) : Number(v);
                            if (!Number.isFinite(n)) return null;
                            const label = obj ? `${k} calls${obj.cache_hits ? ` · ${obj.cache_hits} cached` : ''}` : k.replace(/_/g, ' ');
                            return (
                              <span key={k} className="chip">
                                <span className="num font-semibold text-fg">{n.toLocaleString()}</span> {label}
                              </span>
                            );
                          })}
                        </div>
                        {run.errors?.length > 0 && (
                          <ul className="space-y-1 rounded-xl border border-bad/20 bg-bad-soft/50 p-3 text-xs">
                            {run.errors.slice(-5).map((er, i) => (
                              <li key={i}>
                                <b>{STAGE_LABEL[er.stage ?? ''] ?? er.stage}</b>
                                {er.area ? ` · ${er.area}` : ''}: {er.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="text-[11.5px] text-subtle">
                          Real stage states, counts and timestamps from the worker — no estimated percentages. Closing this page never cancels a run.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted">{runs.length ? 'Loading run…' : 'No research run yet for this project.'}</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="eyebrow mb-2">Event log</p>
                    {runEvents.length === 0 ? (
                      <p className="text-sm text-muted">No events yet.</p>
                    ) : (
                      <ol className="space-y-1.5" aria-live="polite">
                        {runEvents.slice(0, 60).map((e) => (
                          <li key={e.id} className="flex items-start gap-2 text-[12.5px]">
                            <span className="num mt-[1px] shrink-0 font-mono text-[11px] text-subtle">{fmtTime(e.created_at)}</span>
                            <Badge tone={eventTone(e.type)} className="shrink-0">
                              {e.type}
                            </Badge>
                            <span className="min-w-0 text-fg">
                              {e.message}
                              {e.stage && <span className="text-subtle"> · {STAGE_LABEL[e.stage] ?? humanize(e.stage)}</span>}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        tone="danger"
        title="Cancel this run?"
        confirmLabel="Cancel run"
        loading={cancel.isPending}
        onConfirm={() =>
          runId &&
          cancel.mutate(runId, {
            onSuccess: (r) => {
              toast.info('Cancellation requested', r.note);
              setConfirmCancel(false);
            },
            onError: (e) => toast.error('Could not cancel', e),
          })
        }
      >
        No new paid calls will start. Requests already submitted to a provider may still be billed. Completed results are kept.
      </ConfirmDialog>
    </section>
  );
}
