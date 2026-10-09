import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, Check, CircleDollarSign, Clapperboard, Film, Hand, ImageIcon, MapPin, OctagonX, ShieldCheck, Users } from 'lucide-react';
import { get } from '../api/client';
import { mutations, useApiMutation, useBriefs, useRun } from '../api/hooks';
import type { BriefDetail, Orientation, Preset, TargetOption } from '../api/types';
import { cn, fmtUsd, humanize } from '../lib/format';
import { LANG_LABEL, PRESETS, ROLE_LABEL } from '../lib/labels';
import { Modal } from './Overlay';
import { LockNote, useLocked } from './Locked';
import { useToast } from './Toast';
import { Badge, Button, Callout, Checkbox, EmptyState, ErrorState, Field, Input, SkeletonCard, StatusPill, Toggle } from './ui';

export function DecisionPanel({ pid, runId, open, onClose }: { pid: string; runId?: string; open: boolean; onClose: () => void }) {
  const rq = useRun(open ? runId : undefined);
  const run = rq.data?.run;
  const pd = run?.pending_decision;
  const waiting = run?.status === 'waiting_for_user' && !!pd;
  const title = pd?.title ?? 'Decision';
  const locked = useLocked();
  return (
    <Modal
      open={open}
      onClose={onClose}
      size={pd?.type === 'creative_scope' || pd?.type === 'select_targets' ? 'xl' : 'md'}
      icon={<Hand className="h-4 w-4" />}
      title={waiting ? title : 'No decision pending'}
      description={waiting ? 'The workflow is paused at a checkpoint that belongs to you. Nothing continues until you decide.' : undefined}
    >
      {rq.isLoading && <SkeletonCard lines={5} />}
      {rq.error && <ErrorState error={rq.error} onRetry={() => rq.refetch()} />}
      {locked && waiting && <LockNote className="mb-3 max-w-none">Read-only sample: decisions are shown but can’t be made here. Duplicate the project to decide.</LockNote>}
      <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
      {run && !waiting && (
        <EmptyState icon={<Check className="h-5 w-5" />} title="This run is not waiting for a decision">
          Current status: <StatusPill status={run.status} />
        </EmptyState>
      )}
      {run && waiting && pd?.type === 'intake' && <IntakeDecision pid={pid} runId={run.id} onDone={onClose} />}
      {run && waiting && pd?.type === 'entity_resolution' && <EntityDecision pid={pid} runId={run.id} onDone={onClose} />}
      {run && waiting && pd?.type === 'select_targets' && <SelectTargets runId={run.id} onDone={onClose} />}
      {run && waiting && pd?.type === 'creative_scope' && <CreativeScope pid={pid} runId={run.id} onDone={onClose} />}
      </fieldset>
    </Modal>
  );
}

function useResume(runId: string, pid?: string) {
  return useApiMutation((d: Record<string, unknown>) => mutations.resume(runId, d), [['run', runId], ['project', pid], ['runs', pid], ['projects']]);
}

/* ------------------------------------------------------------------ intake */
function IntakeDecision({ pid, runId, onDone }: { pid: string; runId: string; onDone: () => void }) {
  const run = useRun(runId).data?.run;
  const resume = useResume(runId, pid);
  const toast = useToast();
  const pd = run?.pending_decision;
  return (
    <div className="space-y-4">
      <Callout tone="bad" title="Critical facts are missing">
        Research cannot start until these are fixed. Unsupported claims are never generated to fill gaps.
      </Callout>
      <ul className="space-y-2">
        {(pd?.critical ?? []).map((c, i) => (
          <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
            <span>
              <b>{humanize(String(c.field ?? ''))}</b> — {c.question ?? c.message}
            </span>
            <Link className="link shrink-0 text-xs" to={`/projects/${pid}/${String(c.field ?? '').startsWith('audiences') ? 'audiences' : 'brief'}`} onClick={onDone}>
              Fix
            </Link>
          </li>
        ))}
      </ul>
      {(pd?.optional ?? []).length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Optional gaps (disclosed, not blocking)</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {pd!.optional!.map((c, i) => (
              <li key={i}>{c.question}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end">
        <Button
          loading={resume.isPending}
          onClick={() =>
            resume.mutate({ action: 'retry' }, { onSuccess: () => (toast.success('Re-checking your inputs'), onDone()), onError: (e) => toast.error('Could not continue', e) })
          }
        >
          I fixed them — continue
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ entities */
function EntityDecision({ pid, runId, onDone }: { pid: string; runId: string; onDone: () => void }) {
  const run = useRun(runId).data?.run;
  const resume = useResume(runId, pid);
  const toast = useToast();
  const items = (run?.pending_decision?.items ?? []) as { query?: string; candidates?: number; audience_version_id?: string }[];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{run?.pending_decision?.note}</p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between rounded-xl border border-line p-3 text-sm">
            <span>
              <b>“{it.query}”</b> — {it.candidates ?? 0} possible Qloo matches
            </span>
            <Badge tone="warn">Ambiguous</Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Link to={`/projects/${pid}/audiences`} onClick={onDone}>
          <Button variant="outline" icon={<Users className="h-4 w-4" />}>
            Resolve in Audience insights
          </Button>
        </Link>
        <Button
          loading={resume.isPending}
          onClick={() => resume.mutate({ action: 'continue' }, { onSuccess: () => (toast.success('Continuing research'), onDone()), onError: (e) => toast.error('Could not continue', e) })}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ select targets */
const key = (o: { area_id: string; audience_version_id: string }) => `${o.area_id}|${o.audience_version_id}`;

function SelectTargets({ runId, onDone }: { runId: string; onDone: () => void }) {
  const rq = useRun(runId);
  const run = rq.data?.run;
  const pd = run?.pending_decision;
  const options = pd?.options ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => setSel(new Set((pd?.suggested ?? []).map(key))), [pd?.suggested]);
  const resume = useResume(runId, run?.project_id);
  const toast = useToast();
  const assessments = rq.data?.assessments ?? [];
  const excluded = assessments.filter((a) => !a.eligible);
  const byArea = useMemo(() => {
    const m = new Map<string, TargetOption[]>();
    options.forEach((o) => m.set(o.area_id, [...(m.get(o.area_id) ?? []), o]));
    return Array.from(m.entries());
  }, [options]);
  const toggle = (k: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Pick the location × audience pairs that should receive an evidence-linked strategy. Suggested pairs are pre-selected. Only locations that passed every hard
        constraint are offered.
      </p>
      {byArea.map(([areaId, opts]) => {
        const a = assessments.find((x) => x.area_id === areaId);
        return (
          <div key={areaId}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <MapPin className="h-4 w-4 text-brand-ink" />
              <h3 className="font-display font-semibold">{opts[0].area_name}</h3>
              <StatusPill status={opts[0].status} />
              {a?.practical_rank && <Badge tone="accent">Practical rank #{a.practical_rank}</Badge>}
              {a?.available_weight != null && a.planning_index != null && (
                <span className="text-xs text-muted">
                  index {a.planning_index.toFixed(2)} of {Math.round(a.available_weight * 100)}% weight
                </span>
              )}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {opts.map((o) => {
                const k = key(o);
                const on = sel.has(k);
                return (
                  <motion.button
                    type="button"
                    key={k}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => toggle(k)}
                    aria-pressed={on}
                    className={cn(
                      'group relative flex items-start gap-3 rounded-2xl border p-3.5 text-left transition',
                      on ? 'border-brand bg-brand-soft/60 shadow-glow' : 'border-line bg-surface hover:border-fg/20 hover:bg-surface2/60',
                    )}
                  >
                    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', on ? 'border-transparent bg-ink text-white dark:bg-white dark:text-[#0E1320]' : 'border-line')}>
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug">{o.audience_name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone="neutral">{ROLE_LABEL[o.audience_role] ?? o.audience_role}</Badge>
                        {o.rank != null && <Badge tone="accent">rank {o.rank}</Badge>}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        );
      })}
      {excluded.length > 0 && (
        <Callout tone="neutral" icon={<OctagonX className="h-4 w-4 text-bad" />} title="Not offered (failed a hard constraint)">
          {excluded.map((a) => (
            <span key={a.id} className="mr-3 inline-block">
              <b>{a.area_name}</b>: {a.hard_constraints.filter((h) => h.result === 'fail').map((h) => `${h.name} — ${h.reason}`).join('; ')}
            </span>
          ))}
        </Callout>
      )}
      <div className="sticky bottom-0 -mx-6 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
        <span className="text-sm text-muted">
          <b className="text-fg">{sel.size}</b> pair{sel.size === 1 ? '' : 's'} selected · strategies are written by the reasoning model and validated against your claims
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              resume.mutate({ selections: [] }, { onSuccess: () => (toast.info('Stopped after research', 'No strategies will be written for this run.'), onDone()) })
            }
          >
            Stop here
          </Button>
          <Button
            variant="brand"
            disabled={!sel.size}
            loading={resume.isPending}
            icon={<ArrowRight className="h-4 w-4" />}
            onClick={() =>
              resume.mutate(
                { selections: Array.from(sel).map((k) => ({ area_id: k.split('|')[0], audience_version_id: k.split('|')[1] })) },
                { onSuccess: () => (toast.success('Writing strategies', 'Follow progress in the run console.'), onDone()), onError: (e) => toast.error('Could not continue', e) },
              )
            }
          >
            Write {sel.size || ''} strateg{sel.size === 1 ? 'y' : 'ies'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ creative scope */
function CreativeScope({ pid, runId, onDone }: { pid: string; runId: string; onDone: () => void }) {
  const run = useRun(runId).data?.run;
  const pd = run?.pending_decision;
  const briefIds = pd?.brief_ids ?? [];
  const all = useBriefs(pid);
  const briefs = (all.data?.items ?? []).filter((b) => briefIds.includes(b.id));
  const details = useQueries({
    queries: briefIds.map((id) => ({ queryKey: ['brief', id], queryFn: () => get<BriefDetail>(`/creative-briefs/${id}`) })),
  });
  const d = pd?.defaults;
  const [presets, setPresets] = useState<Preset[]>(d?.presets ?? ['square']);
  const [imageIds, setImageIds] = useState<string[]>(briefIds);
  const [videoIds, setVideoIds] = useState<string[]>(d?.video_brief_ids ?? []);
  const [orients, setOrients] = useState<Orientation[]>(d?.orientations ?? ['vertical']);
  const [mode, setMode] = useState<'full' | 'animatic' | 'none'>(d?.mode ?? 'full');
  const [cap, setCap] = useState<string>(String(d?.cap_usd ?? 3));
  const [narration, setNarration] = useState<boolean>(d?.narration ?? false);
  const [ack, setAck] = useState(false);
  const resume = useResume(runId, pid);
  const toast = useToast();

  const imgEach = Number(pd?.estimates?.image_usd_each);
  const vidSec = Number(pd?.estimates?.video_usd_per_second);
  const genSeconds = (id: string) => {
    const det = details.find((q) => q.data?.id === id)?.data;
    return det?.storyboard?.scenes.filter((s) => s.kind === 'generated').reduce((a, s) => a + Number(s.duration_s), 0);
  };
  const frames = (id: string) => details.find((q) => q.data?.id === id)?.data?.storyboard?.scenes.filter((s) => s.kind === 'generated').length ?? 0;
  const imgCost = Number.isFinite(imgEach) ? imgEach * imageIds.length * presets.length : null;
  const vidSecs = videoIds.reduce((a, id) => a + (genSeconds(id) ?? 0), 0);
  const vidKnown = videoIds.every((id) => genSeconds(id) !== undefined);
  const vidCost =
    mode !== 'full' ? 0 : Number.isFinite(vidSec) && vidKnown ? vidSec * vidSecs + (Number.isFinite(imgEach) ? imgEach * videoIds.reduce((a, id) => a + frames(id), 0) : 0) : null;
  const total = imgCost !== null && vidCost !== null ? imgCost + vidCost : null;
  const capNum = Number(cap);
  const capOk = Number.isFinite(capNum) && capNum > 0 && capNum <= 30;
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="space-y-5">
      <Callout tone="brand" icon={<CircleDollarSign className="h-4 w-4 text-brand-ink" />} title="This step can spend real money">
        Images and video are generated through xAI and billed to the configured account. Nothing is generated until you approve. The cap is enforced by the worker;
        estimates come from the versioned pricing file ({pd?.estimates?.pricing_source || 'source unknown'}) and actual cost is recorded from xAI usage.
      </Callout>

      <div>
        <p className="eyebrow mb-2">Drafted briefs ({briefIds.length})</p>
        {all.isLoading && <SkeletonCard lines={3} />}
        <div className="grid gap-3 md:grid-cols-2">
          {briefIds.map((id) => {
            const b = briefs.find((x) => x.id === id);
            const det = details.find((q) => q.data?.id === id)?.data;
            return (
              <div key={id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="accent">{det?.strategy.area ?? '…'}</Badge>
                  <Badge>{det?.strategy.audience ?? '…'}</Badge>
                  {b && <Badge tone="violet">{LANG_LABEL[b.language] ?? b.language}</Badge>}
                  {b?.angle && <Badge tone="brand">{humanize(b.angle)}</Badge>}
                </div>
                <p lang={b?.language} className="mt-2 font-display text-[15px] font-semibold leading-snug">{b?.content.headline ?? 'Loading…'}</p>
                <p lang={b?.language} className="mt-1 line-clamp-2 text-[13px] text-muted">{b?.content.body}</p>
                <div className="mt-3 flex flex-wrap gap-4">
                  <Checkbox checked={imageIds.includes(id)} onChange={() => setImageIds((x) => toggleIn(x, id))} label={<span className="inline-flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" /> Flyers</span>} />
                  <Checkbox
                    checked={videoIds.includes(id)}
                    disabled={mode === 'none'}
                    onChange={() => setVideoIds((x) => toggleIn(x, id))}
                    label={<span className="inline-flex items-center gap-1"><Film className="h-3.5 w-3.5" /> Video{genSeconds(id) !== undefined ? ` (${genSeconds(id)}s generated)` : ''}</span>}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Flyer presets">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Checkbox key={p.key} checked={presets.includes(p.key)} onChange={() => setPresets((x) => toggleIn(x, p.key))} label={`${p.label} ${p.w}×${p.h}`} />
              ))}
            </div>
          </Field>
          <Field label="Video mode">
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['full', 'Full xAI video', 'Real generated clips + assembly'],
                  ['animatic', 'Animatic draft', 'Stills only — NOT xAI video'],
                  ['none', 'No video', 'Flyers only'],
                ] as const
              ).map(([k, l, s]) => (
                <button
                  type="button"
                  key={k}
                  aria-pressed={mode === k}
                  onClick={() => setMode(k)}
                  className={cn('rounded-xl border p-2.5 text-left text-xs transition', mode === k ? 'border-brand bg-brand-soft/60' : 'border-line hover:bg-surface2')}
                >
                  <span className="block text-[13px] font-semibold text-fg">{l}</span>
                  <span className="text-muted">{s}</span>
                </button>
              ))}
            </div>
          </Field>
          {mode !== 'none' && (
            <Field label="Video orientations">
              <div className="flex gap-4">
                <Checkbox checked={orients.includes('vertical')} onChange={() => setOrients((x) => toggleIn(x, 'vertical'))} label="Vertical 9:16" />
                <Checkbox checked={orients.includes('landscape')} onChange={() => setOrients((x) => toggleIn(x, 'landscape'))} label="Landscape 16:9" />
              </div>
            </Field>
          )}
          <Toggle checked={narration} onChange={setNarration} label="Narration (TTS)" description="Optional; marked “needs review”. Without it videos are silent with captions." />
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface2/60 p-4">
            <p className="eyebrow mb-2">Estimate (planning, from pricing file)</p>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Image each</dt><dd className="num font-medium">{fmtUsd(pd?.estimates?.image_usd_each, 3)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Video per generated second</dt><dd className="num font-medium">{fmtUsd(pd?.estimates?.video_usd_per_second, 3)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Flyers ({imageIds.length} briefs × {presets.length} presets)</dt><dd className="num font-medium">{imgCost === null ? 'unknown' : `≤ ${fmtUsd(imgCost)}`}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Video {mode === 'full' ? `(${vidSecs}s + frames)` : `(${mode})`}</dt><dd className="num font-medium">{vidCost === null ? 'unknown' : `≤ ${fmtUsd(vidCost)}`}</dd></div>
              <div className="flex justify-between border-t border-line pt-1.5"><dt className="font-semibold">Upper bound</dt><dd className="num font-display text-lg font-bold">{total === null ? 'unknown' : fmtUsd(total)}</dd></div>
            </dl>
            <p className="mt-2 text-[11.5px] text-subtle">{pd?.estimates?.note} Reused backgrounds and clips cost nothing.</p>
          </div>
          <Field label="Spending cap (USD)" required hint="Required. Between $0.01 and $30. The run stops before exceeding it." error={!capOk ? 'Enter a cap between 0.01 and 30.' : undefined}>
            <Input type="number" min={0.01} max={30} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} invalid={!capOk} />
          </Field>
          {total !== null && capOk && total > capNum && (
            <Callout tone="warn">The estimate exceeds your cap — generation will stop when the cap is reached; some items may not be produced.</Callout>
          )}
          <Checkbox checked={ack} onChange={setAck} label={<span className="text-[13px]">I understand this may spend up to <b>{capOk ? fmtUsd(capNum) : 'the cap'}</b> on xAI.</span>} />
        </div>
      </div>
      <div className="sticky bottom-0 -mx-6 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
        <Button
          variant="ghost"
          onClick={() => resume.mutate({ approve: false }, { onSuccess: () => (toast.info('Stopped before generation', 'Briefs are saved; you can generate later from the Ad studio.'), onDone()) })}
        >
          Stop here
        </Button>
        <Button
          variant="brand"
          icon={mode === 'full' ? <Clapperboard className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          disabled={!capOk || !ack || (!imageIds.length && !videoIds.length) || (mode !== 'none' && videoIds.length > 0 && !orients.length)}
          loading={resume.isPending}
          onClick={() =>
            resume.mutate(
              {
                approve: true,
                presets: imageIds.length ? presets : [],
                image_brief_ids: imageIds,
                video_brief_ids: mode === 'none' ? [] : videoIds,
                orientations: orients,
                mode,
                cap_usd: capNum,
                narration,
              },
              { onSuccess: () => (toast.success('Generation approved', 'Follow each job in the run console and Ad studio.'), onDone()), onError: (e) => toast.error('Could not approve', e) },
            )
          }
        >
          Approve &amp; generate
        </Button>
      </div>
    </div>
  );
}
