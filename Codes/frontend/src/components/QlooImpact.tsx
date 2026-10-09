/**
 * Feature B — "See what Qloo changed".
 * The same research snapshot with and without Qloo taste signals, side by side:
 * city order, venue discovery, ranking and creative emphasis are separate
 * sections; validity problems are shown first; "no material change" is said plainly.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGroup, motion } from 'framer-motion';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Beaker, CheckCircle2, Equal, FlaskConical, Info, ListOrdered, Minus, Plus, Search, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react';
import { mutations, useApiMutation, useExperiment, useExperiments, useRuns } from '../api/hooks';
import type { ExperimentAnalysis } from '../api/types';
import { cn, fmtDate, fmtUsd, humanize, shortId } from '../lib/format';
import { DuplicateButton, useLocked } from './Locked';
import { ConfirmDialog, Drawer } from './Overlay';
import { useProjectCtx } from './ProjectContext';
import { useToast } from './Toast';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, ErrorState, Select, SkeletonCard, StatusPill } from './ui';

type Ex = ExperimentAnalysis;

function useAudName() {
  const { project } = useProjectCtx();
  return useMemo(() => {
    const m = Object.fromEntries((project?.audiences ?? []).map((a) => [a.id, a.name.replace(/\s*\(hypothetical persona\)/i, '')]));
    return (id: string) => m[id] ?? `Audience ${shortId(id)}`;
  }, [project]);
}

/** Plain-language headline numbers for an analysis. */
export function impactSummary(d: Ex) {
  const added = d.discovery.reduce((n, r) => n + r.added_by_qloo.length, 0);
  const pairsWithDiscovery = d.discovery.filter((r) => r.added_by_qloo.length > 0).length;
  const reranked = d.ranking_only.filter((r) => r.changed).length;
  const completed = d.locations.filter((l) => l.with_qloo?.status === 'complete' && l.without_qloo?.status !== 'complete').length;
  const material = d.verdict === 'material change';
  const parts: string[] = [];
  parts.push(d.location_order.changed ? 'the city order changed' : 'the city order is unchanged');
  if (added) parts.push(`Qloo surfaced ${added} venue${added === 1 ? '' : 's'} the practical baseline did not shortlist (${pairsWithDiscovery} audience × city pair${pairsWithDiscovery === 1 ? '' : 's'})`);
  parts.push(reranked ? `top-3 ranking changed for ${reranked} of ${d.ranking_only.length} pairs` : 'ranking within the practical candidates did not change');
  if (completed) parts.push(`the cultural component completed the index for ${completed} cit${completed === 1 ? 'y' : 'ies'}`);
  const sentence = `${material ? 'Material change' : 'No material change'}: ${parts.join('; ')}.`;
  const headline = !material
    ? 'No material change'
    : [d.location_order.changed ? 'City order changed' : 'City order unchanged', added ? 'Qloo changed which venues were found' : null, reranked ? 'venue ranking changed' : null].filter(Boolean).join(' · ');
  return { added, pairsWithDiscovery, reranked, completed, material, sentence, headline };
}

function validityProblems(d: Ex): string[] {
  const v = d.validity;
  const out: string[] = [];
  if (!v.pinned_to_baseline) out.push('The practical arm was not pinned to the baseline’s practical evidence, so other differences may be mixed in.');
  if (!v.practical_evidence_identical) out.push(`Practical evidence differs between the two runs (${v.mismatches.length} mismatch${v.mismatches.length === 1 ? '' : 'es'}).`);
  if (v.snapshot_differences.length) out.push(`Inputs differ between the runs: ${v.snapshot_differences.map(humanize).join(', ')}.`);
  if (v.confounders.length) out.push(`Runtime differences: ${v.confounders.join('; ')}.`);
  if (!v.valid && out.length === 0) out.push('The server marked this comparison as not valid.');
  return out;
}

/* ================================================================== full view */
export function QlooImpact({ runId, qlooRun }: { runId?: string; qlooRun?: boolean }) {
  const { pid, setConsoleRunId } = useProjectCtx();
  const locked = useLocked();
  const list = useExperiments(pid);
  const runs = useRuns(pid).data?.items ?? [];
  const [eid, setEid] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  const cur = eid ?? items[0]?.id ?? null;
  const meta = items.find((x) => x.id === cur);
  const ex = useExperiment(cur);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const create = useApiMutation(() => mutations.createExperiment(pid, runId!), [['experiments', pid], ['project', pid], ['runs', pid]]);
  const [details, setDetails] = useState(false);
  const d = ex.data;
  const runDate = (id?: string) => runs.find((r) => r.id === id)?.created_at;
  const canCreate = !locked && !!runId && qlooRun !== false;

  return (
    <section id="qloo-impact" className="scroll-mt-24 space-y-5" aria-labelledby="qloo-impact-title" data-testid="qloo-impact">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Experiment
          </p>
          <h2 id="qloo-impact-title" className="font-display text-xl font-bold">
            See what Qloo changed
          </h2>
          <p className="max-w-2xl text-sm text-muted">The same research snapshot twice: a practical baseline with Qloo taste signals withheld, and the taste-informed run. Everything else is held constant.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {items.length > 1 && (
            <Select aria-label="Experiment" value={cur ?? ''} onChange={(e) => setEid(e.target.value)} className="h-10 w-full text-sm sm:w-auto sm:min-w-[240px]">
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  Experiment {shortId(x.id)} · {fmtDate(x.created_at)}
                </option>
              ))}
            </Select>
          )}
          {!locked && (
            <Button variant="outline" icon={<Beaker className="h-4 w-4" />} disabled={!canCreate} onClick={() => setConfirm(true)}>
              New experiment
            </Button>
          )}
        </div>
      </div>

      {list.isLoading && <SkeletonCard lines={6} />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {create.error && (
        <Callout tone="bad" icon={<AlertTriangle className="h-4 w-4 text-bad" />} title="The experiment could not be started">
          {create.error.message}
        </Callout>
      )}
      {!list.isLoading && !cur && (
        <EmptyState
          icon={<FlaskConical className="h-5 w-5" />}
          title="No comparison recorded yet"
          action={
            locked ? (
              <DuplicateButton pid={pid} size="md" />
            ) : (
              <Button variant="brand" icon={<Beaker className="h-4 w-4" />} disabled={!canCreate} onClick={() => setConfirm(true)}>
                Run the comparison
              </Button>
            )
          }
        >
          {locked
            ? 'Experiments can’t be created on the read-only sample. Duplicate it to run your own comparison — the practical baseline reuses cached evidence.'
            : 'Run the same research without Qloo taste signals. Practical evidence is copied from this run, so only taste signals differ.'}
        </EmptyState>
      )}
      {cur && ex.isLoading && <SkeletonCard lines={8} />}
      {ex.error && <ErrorState error={ex.error} onRetry={() => ex.refetch()} />}
      {d && (
        <>
          <RunDates d={d} withRun={meta?.run_with_qloo_id} withoutRun={meta?.run_without_qloo_id} runDate={runDate} />
          <Verdict d={d} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <CityOrder d={d} />
            <HeldConstant d={d} onDetails={() => setDetails(true)} />
          </div>
          <Discovery d={d} />
          <Ranking d={d} />
          <Creative d={d} />
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-subtle">
            {d.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <ExperimentDetails d={d} open={details} onClose={() => setDetails(false)} />
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Run the same research without Qloo?"
        confirmLabel="Start comparison"
        loading={create.isPending}
        onConfirm={() =>
          create.mutate(undefined, {
            onSuccess: (r) => {
              setEid(r.experiment_id);
              setConsoleRunId(r.run.id);
              setConfirm(false);
              toast.success('Comparison started', 'A practical baseline run without Qloo is in progress.');
            },
            onError: () => setConfirm(false),
          })
        }
      >
        A second research run starts with Qloo taste signals withheld. Practical evidence (places, climate) is copied from the run you are viewing, so only taste signals differ. No images or videos are generated.
      </ConfirmDialog>
    </section>
  );
}

function RunDates({ d, withRun, withoutRun, runDate }: { d: Ex; withRun?: string; withoutRun?: string; runDate: (id?: string) => string | undefined }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="impact-dates">
      <DateTile label="Practical baseline (without Qloo)" run={withoutRun} when={runDate(withoutRun) ?? d.recorded_at} />
      <DateTile label="Taste-informed (with Qloo)" run={withRun ?? d.baseline.run_id} when={runDate(withRun) ?? d.baseline.snapshot_at} accent />
      <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Snapshot compared</p>
        <p className="mt-0.5 text-sm font-semibold">{fmtDate(d.baseline.snapshot_at)}</p>
        <p className="text-[11.5px] text-muted">Comparison recorded {fmtDate(d.recorded_at)}</p>
      </div>
    </div>
  );
}

function DateTile({ label, run, when, accent }: { label: string; run?: string; when?: string; accent?: boolean }) {
  return (
    <div className={cn('rounded-2xl border px-4 py-3', accent ? 'border-accent/30 bg-accent-soft/30' : 'border-line bg-surface')}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{fmtDate(when)}</p>
      <p className="font-mono text-[11px] text-muted">run {shortId(run)}</p>
    </div>
  );
}

function Verdict({ d }: { d: Ex }) {
  const s = impactSummary(d);
  const problems = validityProblems(d);
  return (
    <div className="space-y-3">
      {!d.validity.valid && (
        <Callout tone="bad" icon={<AlertTriangle className="h-4 w-4 text-bad" />} title="Read with care: this is not a clean comparison" className="border-2" >
          <ul className="list-disc space-y-0.5 pl-4" data-testid="validity-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      )}
      <div className={cn('flex flex-wrap items-start gap-3 rounded-2xl border p-4', s.material ? 'border-accent/30 bg-accent-soft/30' : 'border-line bg-surface2/50')} data-testid="impact-verdict">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', s.material ? 'bg-accent text-white' : 'bg-surface text-muted')}>
          {s.material ? <Sparkles className="h-4 w-4" /> : <Equal className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[16px] font-bold">{s.headline}</p>
          <p className="text-[13.5px] text-muted">{s.sentence}</p>
          {!s.material && <p className="mt-1 text-[12.5px] text-muted">That is a valid result: here, taste signals did not move the recommendation.</p>}
        </div>
        {d.validity.valid && (
          <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>
            Valid: practical evidence identical
          </Badge>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ city order, side by side */
function CityOrder({ d }: { d: Ex }) {
  const practical = [...d.locations].sort((a, b) => (a.without_qloo?.practical_rank ?? 99) - (b.without_qloo?.practical_rank ?? 99));
  const taste = [...d.locations].sort((a, b) => (a.with_qloo?.rank ?? 99) - (b.with_qloo?.rank ?? 99));
  return (
    <Card>
      <CardHeader
        icon={<ListOrdered className="h-4 w-4" />}
        title="City order"
        subtitle="Hard constraints first; then the practical index alone vs the full planning index."
        action={d.location_order.changed ? <Badge tone="accent">Order changed</Badge> : <Badge tone="neutral" icon={<Equal className="h-3 w-3" />}>Order unchanged</Badge>}
      />
      <LayoutGroup>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <OrderColumn title="Practical baseline" sub="without Qloo" rows={practical.map((l) => ({ key: l.area, area: l.area, rank: l.without_qloo?.practical_rank ?? null, eligible: !!l.without_qloo?.eligible, status: l.without_qloo?.status ?? 'not assessed', index: l.without_qloo?.practical_index ?? null, other: l.with_qloo?.rank ?? null }))} />
          <OrderColumn title="Taste-informed" sub="with Qloo" accent rows={taste.map((l) => ({ key: l.area, area: l.area, rank: l.with_qloo?.rank ?? null, eligible: !!l.with_qloo?.eligible, status: l.with_qloo?.status ?? 'not assessed', index: l.with_qloo?.planning_index ?? null, other: l.without_qloo?.practical_rank ?? null, cultural: l.with_qloo?.cultural_state }))} />
        </div>
      </LayoutGroup>
      <p className="border-t border-line px-5 py-3 text-[12px] text-muted">
        The practical index leaves the cultural weight empty (not redistributed), so it is “incomplete” by design; the taste-informed index fills it from Qloo. Planning indices are not forecasts.
      </p>
    </Card>
  );
}

function OrderColumn({ title, sub, rows, accent }: { title: string; sub: string; accent?: boolean; rows: { key: string; area: string; rank: number | null; eligible: boolean; status: string; index: number | null; other: number | null; cultural?: string | null }[] }) {
  return (
    <div>
      <p className={cn('mb-2 text-[12px] font-bold uppercase tracking-wider', accent ? 'text-accent-ink' : 'text-subtle')}>
        {title} <span className="font-normal normal-case tracking-normal text-subtle">· {sub}</span>
      </p>
      <ol className="space-y-2">
        {rows.map((r) => {
          const moved = accent && r.rank != null && r.other != null && r.rank !== r.other;
          return (
            <motion.li
              key={r.key}
              layout
              layoutId={`${title}-${r.key}`}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', r.eligible ? (accent ? 'border-accent/30 bg-surface' : 'border-line bg-surface') : 'border-dashed border-line bg-surface2/50 text-muted')}
            >
              <span className={cn('num flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold', r.eligible ? (accent ? 'bg-accent text-white' : 'bg-fg text-surface') : 'bg-surface2 text-subtle')}>
                {r.rank ?? '–'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{r.area}</span>
                <span className="flex flex-wrap items-center gap-1 text-[11px] text-subtle">
                  {r.eligible ? <StatusPill status={r.status} /> : <Badge tone="bad">Excluded</Badge>}
                  {r.index != null && <span className="num">index {r.index.toFixed(2)}</span>}
                  {r.cultural && <span>· taste component {r.cultural.replace(/_/g, ' ')}</span>}
                </span>
              </span>
              {accent && r.eligible && (
                <span className="shrink-0 text-[11px] font-semibold" aria-label={moved ? `moved from ${r.other} to ${r.rank}` : 'same position'}>
                  {moved ? (
                    r.rank! < r.other! ? (
                      <span className="inline-flex items-center gap-0.5 text-ok">
                        <ArrowUp className="h-3.5 w-3.5" /> {r.other! - r.rank!}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-warn">
                        <ArrowDown className="h-3.5 w-3.5" /> {r.rank! - r.other!}
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-subtle">
                      <Minus className="h-3.5 w-3.5" /> same
                    </span>
                  )}
                </span>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ held constant */
function HeldConstant({ d, onDetails }: { d: Ex; onDetails: () => void }) {
  return (
    <Card className="flex flex-col" data-testid="held-constant">
      <CardHeader icon={<ShieldCheck className="h-4 w-4" />} title="What was held constant" subtitle="Only Qloo taste signals differ between the arms." />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <ul className="flex flex-wrap gap-1.5">
          {d.conditions.held_constant.map((h) => (
            <li key={h}>
              <Badge tone="neutral" icon={<CheckCircle2 className="h-3 w-3 text-ok" />}>
                {h}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="rounded-xl bg-accent-soft/40 px-3 py-2 text-[12.5px]">
          <b className="font-semibold">Varied: </b>
          {d.conditions.varied}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span>
            Cost {fmtUsd(d.cost_latency.with_qloo.cost_usd, 3)} vs {fmtUsd(d.cost_latency.without_qloo.cost_usd, 3)} · time {d.cost_latency.with_qloo.latency_s ?? '?'} s vs {d.cost_latency.without_qloo.latency_s ?? '?'} s
          </span>
          <Button size="sm" variant="outline" className="ml-auto" icon={<Search className="h-3.5 w-3.5" />} onClick={onDetails}>
            Details
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ExperimentDetails({ d, open, onClose }: { d: Ex; open: boolean; onClose: () => void }) {
  const c = d.conditions as Record<string, unknown>;
  const runtimeA = (c.runtime_baseline ?? {}) as Record<string, unknown>;
  const runtimeB = (c.runtime_experiment ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(runtimeA), ...Object.keys(runtimeB)]));
  return (
    <Drawer open={open} onClose={onClose} title="Experiment conditions" subtitle="Everything recorded about how the two arms were run." width="max-w-xl">
      <div className="space-y-5 text-[13px]">
        <Section title="Validity">
          <ul className="space-y-1">
            <Check ok={d.validity.practical_evidence_identical}>Practical evidence identical</Check>
            <Check ok={d.validity.pinned_to_baseline}>Practical arm pinned to the baseline’s evidence</Check>
            <Check ok={d.validity.snapshot_differences.length === 0}>Same inputs (product, constraints, audiences){d.validity.snapshot_differences.length ? `: differs in ${d.validity.snapshot_differences.join(', ')}` : ''}</Check>
            <Check ok={d.validity.confounders.length === 0}>No runtime differences{d.validity.confounders.length ? `: ${d.validity.confounders.join('; ')}` : ''}</Check>
          </ul>
        </Section>
        <Section title="Held constant">
          <ul className="list-disc pl-5 text-muted">
            {d.conditions.held_constant.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="mt-2">
            <b>Varied:</b> {d.conditions.varied}
          </p>
        </Section>
        <Section title="Versions">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            {['product_version_id', 'constraint_version_id', 'baseline_run_id', 'model'].map((k) =>
              c[k] ? (
                <FragmentRow key={k} k={humanize(k)} v={String(c[k])} />
              ) : null,
            )}
            <FragmentRow k="Snapshot" v={fmtDate(d.baseline.snapshot_at)} />
          </dl>
        </Section>
        {keys.length > 0 && (
          <Section title="Runtime (both arms)">
            <table className="w-full text-left text-[12px]">
              <thead className="text-subtle">
                <tr>
                  <th className="py-1 font-medium">Setting</th>
                  <th className="py-1 font-medium">With Qloo</th>
                  <th className="py-1 font-medium">Without</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className={cn('border-t border-line', String(runtimeA[k]) !== String(runtimeB[k]) && 'bg-warn-soft/50')}>
                    <td className="py-1 pr-2">{humanize(k)}</td>
                    <td className="py-1 pr-2 font-mono text-[11px]">{String(runtimeA[k] ?? '—')}</td>
                    <td className="py-1 font-mono text-[11px]">{String(runtimeB[k] ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        <Section title="Cost and time">
          <p>
            With Qloo: {fmtUsd(d.cost_latency.with_qloo.cost_usd, 4)} · {d.cost_latency.with_qloo.latency_s ?? '?'} s
            <br />
            Without: {fmtUsd(d.cost_latency.without_qloo.cost_usd, 4)} · {d.cost_latency.without_qloo.latency_s ?? '?'} s
          </p>
        </Section>
      </div>
    </Drawer>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-subtle">{k}</dt>
      <dd className="break-all font-mono text-[11.5px]">{v}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="yes" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-label="no" />}
      <span>{children}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ discovery */
function Discovery({ d }: { d: Ex }) {
  const aud = useAudName();
  const rows = d.discovery;
  const total = rows.reduce((n, r) => n + r.added_by_qloo.length, 0);
  return (
    <Card data-testid="impact-discovery">
      <CardHeader icon={<Plus className="h-4 w-4" />} title="Discovery: venues only the taste-informed run shortlisted" subtitle={`${total} venue${total === 1 ? '' : 's'} added by Qloo across ${rows.length} audience × city pairs. Overlap is the share of venues both arms shortlisted.`} />
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div key={`${r.area}-${r.audience_version_id}`} className="rounded-xl border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-[13px] font-semibold leading-snug">
                {r.area} · {aud(r.audience_version_id)}
              </p>
              <span className="shrink-0 text-[11px] text-subtle">{r.jaccard_overlap != null ? `${Math.round(r.jaccard_overlap * 100)}% overlap` : 'overlap unknown'}</span>
            </div>
            {r.added_by_qloo.length === 0 && r.no_longer_shortlisted.length === 0 ? (
              <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-muted">
                <Equal className="h-3.5 w-3.5" /> Same shortlist in both arms
              </p>
            ) : (
              <>
                <p className="mt-2 text-[11px] font-semibold text-accent-ink">Added by Qloo ({r.added_by_qloo.length})</p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {r.added_by_qloo.map((n, i) => (
                    <li key={`${n}-${i}`}>
                      <Badge tone="accent" icon={<Plus className="h-3 w-3" />}>
                        {n}
                      </Badge>
                    </li>
                  ))}
                </ul>
                {r.no_longer_shortlisted.length > 0 && (
                  <>
                    <p className="mt-2 text-[11px] font-semibold text-subtle">Only in the practical baseline ({r.no_longer_shortlisted.length})</p>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {r.no_longer_shortlisted.map((n, i) => (
                        <li key={`${n}-${i}`}>
                          <Badge tone="neutral" icon={<Minus className="h-3 w-3" />}>
                            {n}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ ranking */
function Ranking({ d }: { d: Ex }) {
  const aud = useAudName();
  const changed = d.ranking_only.filter((r) => r.changed).length;
  const noneKnown = d.ranking_only.length > 0 && d.ranking_only.every((r) => r.with_qloo_affinity === 0);
  return (
    <Card data-testid="impact-ranking">
      <CardHeader
        icon={<ListOrdered className="h-4 w-4" />}
        title="Ranking: the practical candidates re-scored with taste"
        subtitle={`Same candidate venues in both arms, re-ordered with Qloo affinity where Qloo knows the venue. Kendall τ = 1 means the same order. ${changed ? `Top 3 changed in ${changed} of ${d.ranking_only.length} pairs.` : 'The top 3 did not change in any pair.'}`}
      />
      {noneKnown && (
        <p className="flex items-start gap-2 border-b border-line bg-surface2/50 px-5 py-2.5 text-[12.5px] text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Qloo had no affinity for any of the practical baseline’s candidates, so re-scoring could not move them. Qloo’s effect here shows up as discovery — different venues — rather than a different order.
        </p>
      )}
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <thead className="bg-surface2/60 text-[11px] uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-2 font-semibold">City · audience</th>
              <th className="px-3 py-2 font-semibold">Candidates (Qloo knew)</th>
              <th className="px-3 py-2 font-semibold">Kendall τ</th>
              <th className="px-3 py-2 font-semibold">Top 3 · practical</th>
              <th className="px-3 py-2 font-semibold">Top 3 · taste</th>
            </tr>
          </thead>
          <tbody>
            {d.ranking_only.map((r) => (
              <tr key={`${r.area}-${r.audience_version_id}`} className={cn('border-t border-line', r.changed && 'bg-accent-soft/30')}>
                <td className="px-4 py-2 font-semibold">
                  {r.area} · <span className="font-normal">{aud(r.audience_version_id)}</span>
                </td>
                <td className="num px-3 py-2">
                  {r.candidates} ({r.with_qloo_affinity})
                </td>
                <td className="num px-3 py-2">
                  {r.kendall_tau != null ? r.kendall_tau.toFixed(2) : 'n/a'} {r.changed ? <Badge tone="accent">changed</Badge> : <span className="text-subtle">same top 3</span>}
                </td>
                <td className="px-3 py-2 text-muted">{r.practical_top3.join(' · ') || '—'}</td>
                <td className="px-3 py-2">{r.taste_top3.join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ creative */
function Creative({ d }: { d: Ex }) {
  const aud = useAudName();
  const rows = d.feature_emphasis;
  return (
    <Card data-testid="impact-creative">
      <CardHeader icon={<WandSparkles className="h-4 w-4" />} title="Creative: which feature each strategy leads with" subtitle="Strategies are written only for the taste-informed arm unless you choose targets in the baseline too." />
      <ul className="divide-y divide-line">
        {rows.map((r, i) =>
          'note' in r ? (
            <li key={i} className="flex items-start gap-2 px-5 py-3 text-[12.5px] text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.note}
            </li>
          ) : (
            <li key={i} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
              <span className="min-w-[220px] flex-1 font-semibold">
                {r.area} · <span className="font-normal">{aud(r.audience_version_id)}</span>
              </span>
              <Badge tone="neutral">Baseline: {r.without_qloo ? humanize(r.without_qloo) : 'no strategy written'}</Badge>
              <ArrowRight className="h-3.5 w-3.5 text-subtle" aria-hidden />
              <Badge tone="accent">With Qloo: {r.with_qloo ? humanize(r.with_qloo) : '—'}</Badge>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

/* ================================================================== overview card */
export function QlooImpactCard() {
  const { pid } = useProjectCtx();
  const list = useExperiments(pid);
  const cur = list.data?.items[0]?.id;
  const ex = useExperiment(cur);
  const d = ex.data;
  const s = d ? impactSummary(d) : null;
  return (
    <Card data-testid="impact-card">
      <CardHeader
        icon={<FlaskConical className="h-4 w-4" />}
        title="See what Qloo changed"
        subtitle="Practical baseline vs taste-informed, same snapshot."
        action={
          <Link to={`/projects/${pid}/compare?view=impact`} className="link inline-flex items-center gap-1 text-sm">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="p-5">
        {(list.isLoading || (cur && ex.isLoading)) && <SkeletonCard lines={3} />}
        {!list.isLoading && !cur && <p className="text-sm text-muted">No comparison recorded yet. {list.data && 'Open the comparison to see how to run one.'}</p>}
        {d && s && (
          <div className="space-y-3">
            {!d.validity.valid && (
              <p className="flex items-start gap-2 rounded-xl bg-bad-soft px-3 py-2 text-[12.5px] text-bad">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not a clean comparison — see the details before relying on it.
              </p>
            )}
            <p className="font-display text-[15px] font-bold">{s.headline}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Mini label="City order" value={d.location_order.changed ? 'changed' : 'unchanged'} />
              <Mini label="Venues added" value={String(s.added)} />
              <Mini label="Top 3 re-ranked" value={`${s.reranked}/${d.ranking_only.length}`} />
            </div>
            <p className="text-[12.5px] text-muted">{s.sentence}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface2/70 px-2 py-2">
      <p className="num font-display text-[15px] font-bold">{value}</p>
      <p className="text-[10.5px] text-subtle">{label}</p>
    </div>
  );
}
