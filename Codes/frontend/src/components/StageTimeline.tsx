import { Check, Circle, CircleDashed, Hand, Loader2, Minus, TriangleAlert, X } from 'lucide-react';
import type { Run } from '../api/types';
import { cn, fmtTime } from '../lib/format';
import { STAGES } from '../lib/labels';
import { Tooltip } from './ui';

export type StageState = { status: string; at?: string; note?: string };

export function stageState(run: Run, key: string): StageState {
  const pd = run.pending_decision;
  const ss = run.stage_statuses ?? {};
  const raw = ss[key];
  const fromRaw = (): StageState | null => (raw ? (typeof raw === 'string' ? { status: raw } : { status: raw.status, at: raw.at }) : null);
  if (key === 'await_selection') {
    if (run.status === 'waiting_for_user' && pd?.type === 'select_targets') return { status: 'waiting', note: 'Waiting for your choice' };
    const n = run.selections?.targets?.length;
    if (n) return { status: 'completed', note: `${n} selected` };
    if (ss.strategy_writer) return { status: 'completed' };
    return fromRaw() ?? { status: 'pending' };
  }
  if (key === 'await_creative') {
    if (run.status === 'waiting_for_user' && pd?.type === 'creative_scope') return { status: 'waiting', note: 'Approve scope & cap' };
    if (ss.image_producer || ss.video_producer) return { status: 'completed' };
    return fromRaw() ?? { status: 'pending' };
  }
  if (key === 'intake_validator' && run.status === 'waiting_for_user' && pd?.type === 'intake') return { status: 'waiting', note: 'Missing critical facts' };
  if (key === 'entity_resolver' && run.status === 'waiting_for_user' && pd?.type === 'entity_resolution') return { status: 'waiting', note: 'Choose Qloo entities' };
  const r = fromRaw();
  if (r) return r;
  if (run.stage === key && run.status === 'running') return { status: 'running' };
  return { status: 'pending' };
}

const META: Record<string, { icon: JSX.Element; cls: string; label: string }> = {
  completed: { icon: <Check className="h-3 w-3" strokeWidth={3} />, cls: 'bg-ok text-white border-ok', label: 'Completed' },
  running: { icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: 'bg-accent text-white border-accent', label: 'Running' },
  waiting: { icon: <Hand className="h-3 w-3" />, cls: 'bg-brand text-[#1A0E08] border-brand animate-pulse', label: 'Waiting for you' },
  needs_input: { icon: <Hand className="h-3 w-3" />, cls: 'bg-brand text-[#1A0E08] border-brand', label: 'Needs input' },
  partial: { icon: <TriangleAlert className="h-3 w-3" />, cls: 'bg-amber-400 text-[#2a1a00] border-amber-400', label: 'Partial' },
  skipped: { icon: <Minus className="h-3 w-3" />, cls: 'bg-surface2 text-subtle border-line', label: 'Skipped' },
  unavailable: { icon: <CircleDashed className="h-3 w-3" />, cls: 'bg-surface2 text-subtle border-line border-dashed', label: 'Unavailable' },
  failed: { icon: <X className="h-3 w-3" strokeWidth={3} />, cls: 'bg-bad text-white border-bad', label: 'Failed' },
  pending: { icon: <Circle className="h-2 w-2" />, cls: 'bg-surface text-line border-line', label: 'Not started' },
};

export function stageMeta(status: string) {
  return META[status] ?? (status.startsWith('resumed') || status.includes('selected') || status === 'approved' ? META.completed : META.pending);
}

export function StageTimeline({ run, compact }: { run: Run; compact?: boolean }) {
  return (
    <ol className={cn('scroll-thin flex items-start overflow-x-auto pb-1', compact ? 'gap-0' : 'gap-0')} aria-label="Workflow stages">
      {STAGES.map((s, i) => {
        const st = stageState(run, s.key);
        const m = stageMeta(st.status);
        const done = m === META.completed;
        return (
          <li key={s.key} className="relative flex min-w-[74px] flex-1 flex-col items-center text-center">
            {i > 0 && (
              <span
                aria-hidden
                className={cn('absolute left-0 right-1/2 top-[11px] h-[2px] -translate-x-0', done || st.status !== 'pending' ? 'bg-ok/50' : 'bg-line')}
              />
            )}
            {i < STAGES.length - 1 && <span aria-hidden className="absolute left-1/2 right-0 top-[11px] h-[2px] bg-line" />}
            <Tooltip
              content={
                <span>
                  <b>{s.label}</b>
                  <br />
                  {m.label}
                  {st.note ? ` · ${st.note}` : ''}
                  {st.at ? ` · ${fmtTime(st.at)}` : ''}
                </span>
              }
            >
              <span
                tabIndex={0}
                className={cn('relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm', m.cls)}
                aria-label={`${s.label}: ${m.label}`}
              >
                {m.icon}
              </span>
            </Tooltip>
            <span className={cn('mt-1.5 px-0.5 text-[10.5px] font-medium leading-tight', st.status === 'pending' ? 'text-subtle' : 'text-fg', s.decision && 'italic')}>
              {s.short}
            </span>
            {!compact && st.at && <span className="num text-[9.5px] text-subtle">{fmtTime(st.at)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
