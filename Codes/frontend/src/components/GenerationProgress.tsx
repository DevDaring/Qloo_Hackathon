/**
 * Generation progress for the Ad studio: while an image or video job runs, show
 * what is happening per format and per scene — queued → generating → composing
 * → done — from the job's live progress events, with thumbnails as each flyer
 * or frame completes, elapsed vs typical time, and a confirmed Cancel.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Circle, Clapperboard, ImagePlus, Loader2, RefreshCw, StopCircle, Terminal } from 'lucide-react';
import { isActiveJob, mutations, useApiMutation } from '../api/hooks';
import type { BriefDetail, Job, RunEvent } from '../api/types';
import { cn, humanize } from '../lib/format';
import { Editable } from './Locked';
import { ConfirmDialog } from './Overlay';
import { useProjectCtx } from './ProjectContext';
import { useToast } from './Toast';
import { Button } from './ui';

/* what the user asked for when the job was queued (the job record doesn't echo it back) */
type Plan = { kind: 'images'; presets: string[] } | { kind: 'video'; orientations: string[] };
const planKey = (id: string) => `ll-job-plan-${id}`;
export function rememberJobPlan(jobId: string, plan: Plan) {
  try {
    sessionStorage.setItem(planKey(jobId), JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}
function recallPlan(jobId: string): Plan | null {
  try {
    return JSON.parse(sessionStorage.getItem(planKey(jobId)) ?? 'null');
  } catch {
    return null;
  }
}

const isGeneration = (j: Job) => /image|video/.test(j.kind);
const fmt = (s: number) => (s < 60 ? `${Math.max(0, Math.floor(s))} s` : `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`);

type ItemState = 'queued' | 'generating' | 'reviewing' | 'composing' | 'submitted' | 'rendering' | 'downloaded' | 'assembling' | 'done' | 'failed';
interface Item {
  key: string;
  label: string;
  state: ItemState;
  thumb?: string;
  note?: string;
}

function imageItems(job: Job, evs: RunEvent[]): Item[] {
  const plan = recallPlan(job.id);
  const presets = new Set<string>(plan?.kind === 'images' ? plan.presets : []);
  const stage = String(job.progress?.stage ?? '');
  if (stage.startsWith('image:')) presets.add(stage.slice(6));
  const items = new Map<string, Item>();
  for (const p of presets) items.set(p, { key: p, label: humanize(p), state: 'queued' });
  for (const e of evs) {
    const m = e.message;
    const preset = /(square|portrait|vertical|landscape)/i.exec(m)?.[1]?.toLowerCase();
    if (!preset) continue;
    const cur = items.get(preset) ?? { key: preset, label: humanize(preset), state: 'queued' as ItemState };
    if (/^Generating/i.test(m)) cur.state = 'generating';
    else if (/fidelity review|regenerat/i.test(m)) {
      cur.state = 'reviewing';
      cur.note = 'Failed an automatic check — regenerating once';
    } else if (/^Composing/i.test(m)) cur.state = 'composing';
    else if (/^Composed/i.test(m)) {
      cur.state = 'done';
      const id = e.data?.asset_id as string | undefined;
      if (id) cur.thumb = `/api/v1/assets/${id}/download`;
    } else if (/fail/i.test(m)) cur.state = 'failed';
    items.set(preset, cur);
  }
  return Array.from(items.values());
}

function videoItems(job: Job, evs: RunEvent[], scenes: number): Item[] {
  const items: Item[] = Array.from({ length: Math.max(scenes, 1) }, (_, i) => ({ key: `s${i + 1}`, label: `Scene ${i + 1}`, state: 'queued' as ItemState }));
  const finals = new Map<string, Item>();
  for (const e of evs) {
    const m = e.message;
    const sm = /Scene (\d+)/i.exec(m);
    if (sm) {
      const n = Number(sm[1]);
      while (items.length < n) items.push({ key: `s${items.length + 1}`, label: `Scene ${items.length + 1}`, state: 'queued' });
      const it = items[n - 1];
      if (/reference frame/i.test(m) && /fidelity|regenerat/i.test(m)) {
        it.state = 'reviewing';
        it.note = 'Frame failed an automatic check — regenerating once';
      } else if (/frame/i.test(m) && e.data?.asset_id) {
        it.thumb = `/api/v1/assets/${e.data.asset_id}/download`;
        if (it.state === 'queued') it.state = 'generating';
      } else if (/submitted/i.test(m)) it.state = 'rendering';
      else if (/downloaded/i.test(m)) it.state = 'downloaded';
      else if (/fail/i.test(m)) it.state = 'failed';
      continue;
    }
    const fm = /Final video \((\w+)\) assembled/i.exec(m);
    if (fm) finals.set(fm[1], { key: `f-${fm[1]}`, label: `Final ${fm[1]} video`, state: 'done' });
    else if (/assembl/i.test(m)) finals.set('any', { key: 'f-any', label: 'Final video', state: 'assembling' });
  }
  const plan = recallPlan(job.id);
  const allDownloaded = items.every((i) => i.state === 'downloaded');
  const orients = plan?.kind === 'video' ? plan.orientations : [];
  const finalsOut = orients.length
    ? orients.map((o) => finals.get(o) ?? { key: `f-${o}`, label: `Final ${o} video`, state: (allDownloaded ? 'assembling' : 'queued') as ItemState })
    : finals.size
      ? Array.from(finals.values())
      : [{ key: 'f', label: 'Final video', state: (allDownloaded ? 'assembling' : 'queued') as ItemState }];
  return [...items, ...finalsOut];
}

const STATE_LABEL: Record<ItemState, string> = {
  queued: 'Queued',
  generating: 'Generating',
  reviewing: 'Checking',
  composing: 'Composing',
  submitted: 'Submitted',
  rendering: 'Rendering',
  downloaded: 'Clip ready',
  assembling: 'Assembling',
  done: 'Done',
  failed: 'Failed',
};

export function GenerationProgress({ b }: { b: BriefDetail }) {
  const { events } = useProjectCtx();
  const active = b.jobs.filter((j) => isGeneration(j) && isActiveJob(j.status));
  return (
    <AnimatePresence>
      {active.map((j) => (
        <JobView key={j.id} job={j} events={events.filter((e) => e.job_id === j.id)} scenes={b.storyboard?.scenes.length ?? 0} />
      ))}
    </AnimatePresence>
  );
}

function JobView({ job, events, scenes }: { job: Job; events: RunEvent[]; scenes: number }) {
  const { pid, setConsoleOpen } = useProjectCtx();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const cancel = useApiMutation(() => mutations.cancelJob(job.id), [['brief'], ['jobs', pid]]);
  const video = /video/.test(job.kind);
  const items = useMemo(() => (video ? videoItems(job, events, scenes) : imageItems(job, events)), [video, job, events, scenes]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = (now - new Date(job.created_at).getTime()) / 1000;
  const last = events[events.length - 1];
  const done = items.filter((i) => i.state === 'done' || i.state === 'downloaded').length;
  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-accent-soft/60 via-surface to-surface p-5 shadow-card"
      aria-label={video ? 'Video generation in progress' : 'Flyer generation in progress'}
      data-testid="generation-progress"
    >
      <div aria-hidden className="shimmer-bar absolute inset-x-0 top-0 h-[3px]" />
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-white" aria-hidden>
          {video ? <Clapperboard className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1 basis-[200px]">
          <h3 className="font-display text-[17px] font-bold">{video ? 'Generating video' : 'Generating flyers'}</h3>
          <p className="text-[13px] text-muted" aria-live="polite">
            {job.status === 'queued' ? 'Queued — a worker picks it up in a moment.' : job.status === 'waiting_for_provider' ? 'Waiting for the image/video provider…' : last?.message ?? 'Starting…'}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span className="num rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted shadow-card">
            {fmt(elapsed)} · typically {video ? '1–3 min' : 'under a minute per format'}
          </span>
          <Button variant="ghost" size="sm" icon={<Terminal className="h-3.5 w-3.5" />} onClick={() => setConsoleOpen(true)}>
            Live console
          </Button>
          <Editable>
            <Button variant="outline" size="sm" icon={<StopCircle className="h-3.5 w-3.5" />} onClick={() => setConfirm(true)} data-testid="generation-cancel">
              Cancel
            </Button>
          </Editable>
        </div>
      </div>
      <p className="mt-3 text-[12px] font-semibold text-subtle">
        {done} of {items.length} {video ? 'steps' : 'formats'} ready
      </p>
      <ul className={cn('mt-2 grid gap-3', video ? 'grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,200px))]' : 'grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(120px,170px))]')}>
        {items.map((it) => (
          <li key={it.key} className="rounded-2xl border border-line bg-surface p-2.5" data-state={it.state}>
            <div className={cn('relative flex items-center justify-center overflow-hidden rounded-xl bg-surface2', video ? 'aspect-video' : 'aspect-square')}>
              {it.thumb ? (
                <motion.img initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} src={it.thumb} alt={`${it.label} preview`} className="h-full w-full object-cover" />
              ) : it.state === 'queued' ? (
                <Circle className="h-4 w-4 text-line" aria-hidden />
              ) : (
                <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-accent-soft to-brand-soft motion-reduce:animate-none" aria-hidden />
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate font-semibold">{it.label}</span>
              <StateChip s={it.state} />
            </div>
            {it.note && <p className="mt-1 text-[11px] text-muted">{it.note}</p>}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        tone="danger"
        title="Cancel this generation?"
        confirmLabel="Cancel generation"
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(undefined, {
            onSuccess: (r) => {
              setConfirm(false);
              toast.info('Cancellation requested', r.note);
            },
            onError: (e) => toast.error('Could not cancel', e),
          })
        }
      >
        Work already finished is kept. A provider request that is already running may still be charged; the spending cap still applies.
      </ConfirmDialog>
    </motion.section>
  );
}

function StateChip({ s }: { s: ItemState }) {
  const done = s === 'done' || s === 'downloaded';
  const busy = s === 'generating' || s === 'composing' || s === 'rendering' || s === 'submitted' || s === 'assembling' || s === 'reviewing';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold', done ? 'bg-ok-soft text-ok' : busy ? 'bg-accent-soft text-accent-ink' : s === 'failed' ? 'bg-bad-soft text-bad' : 'bg-surface2 text-subtle')}>
      {done ? <Check className="h-2.5 w-2.5" aria-hidden /> : s === 'reviewing' ? <RefreshCw className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" aria-hidden /> : busy ? <Loader2 className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {STATE_LABEL[s]}
    </span>
  );
}
