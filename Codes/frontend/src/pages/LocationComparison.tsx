import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, CircleHelp, Eye, GitCompareArrows, History, Info, OctagonX, RotateCcw, Scale, XCircle } from 'lucide-react';
import { mutations, pickDefaultRun, useAudiences, useRevisions, useRun, useRunDiff, useRuns, type RevisionBody } from '../api/hooks';
import { RevisionPreviewSheet } from '../components/RevisionPreview';
import type { Assessment, Component } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { EvidenceChip } from '../components/Evidence';
import { SERIES } from '../components/ExplorerCharts';
import { useProjectCtx } from '../components/ProjectContext';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Meter,
  PageHeader,
  Select,
  SkeletonCard,
  StatusPill,
  Table,
  Td,
  Th,
  Tooltip,
} from '../components/ui';
import { cn, fmtPct, humanize, shortId, timeAgo } from '../lib/format';
import { ROLE_LABEL } from '../lib/labels';

const COMP_COLOR: Record<string, string> = {
  partner_access: SERIES[0],
  venue_access: SERIES[1],
  feature_relevance: SERIES[2],
  competitive_room: SERIES[3],
  cultural_fit: SERIES[6],
};
const COMP_ORDER = ['partner_access', 'venue_access', 'feature_relevance', 'competitive_room', 'cultural_fit'];

export default function LocationComparison() {
  const { pid, sel, setSel } = useProjectCtx();
  const [params, setParams] = useSearchParams();
  const runs = useRuns(pid);
  const runId = pickDefaultRun(runs.data?.items, params.get('run') ?? sel.runId)?.id;
  const rd = useRun(runId);
  const all = rd.data?.assessments ?? [];
  const [areaIds, setAreaIds] = useState<string[]>([]);
  useEffect(() => {
    const fromUrl = params.get('areas')?.split(',').filter(Boolean);
    setAreaIds(fromUrl?.length ? fromUrl : all.map((a) => a.area_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, all.length]);
  const cmp = useQuery({
    queryKey: ['compare', runId, [...areaIds].sort().join(',')],
    queryFn: () => mutations.compare(pid, { run_id: runId!, area_ids: areaIds }),
    enabled: !!runId && areaIds.length > 0,
  });
  const items = useMemo(() => {
    const xs = cmp.data?.items ?? [];
    const ranked = all.map((a) => a.area_id);
    return [...xs].sort((a, b) => ranked.indexOf(a.area_id) - ranked.indexOf(b.area_id)).map((x) => ({ ...x, practical_rank: all.find((a) => a.area_id === x.area_id)?.practical_rank ?? x.practical_rank }));
  }, [cmp.data, all]);

  return (
    <PageWrap>
      <PageHeader
        eyebrow="Decide"
        title="Location comparison"
        description="Hard constraints are applied first. Eligible locations then get component scores with transparent weights — missing components stay missing."
        actions={
          <>
            <label htmlFor="cmp-run" className="sr-only">Research run</label>
            <Select id="cmp-run" className="h-10 w-auto min-w-[220px]" value={runId ?? ''} onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('run', e.target.value);
                setParams(next);
                setSel({ runId: e.target.value });
              }}>
              {(runs.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  Run {shortId(r.id)} · {r.status.replace(/_/g, ' ')}
                  {' · '}{timeAgo(r.created_at)}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <Callout tone="accent" icon={<Info className="h-4 w-4 text-accent-ink" />} title="Planning index, not a forecast; coverage is completeness, not confidence." className="mb-6">
        Indices are rank-based (0–1) application planning indices over the weight that has evidence. An incomplete index shows its available weight and is not directly comparable with a complete one.
      </Callout>

      {all.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-muted">Compare:</span>
          {all.map((a) => (
            <Checkbox
              key={a.area_id}
              checked={areaIds.includes(a.area_id)}
              onChange={(v) => setAreaIds((x) => (v ? [...x, a.area_id] : x.filter((y) => y !== a.area_id)))}
              label={a.area_name}
            />
          ))}
        </div>
      )}

      {(rd.isLoading || cmp.isLoading) && (
        <div className="grid gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={8} />
          ))}
        </div>
      )}
      {(rd.error || cmp.error) && <ErrorState error={rd.error ?? cmp.error} onRetry={() => (rd.refetch(), cmp.refetch())} />}
      {!rd.isLoading && runId && all.length === 0 && <EmptyState title="No assessments in this run yet">The market evaluator has not finished for this run.</EmptyState>}
      {!runId && !runs.isLoading && <EmptyState title="No research run yet">Start research from the overview or market explorer.</EmptyState>}

      {items.length > 0 && (
        <>
          {cmp.data && !cmp.data.comparable && (
            <Callout tone="warn" className="mb-4" icon={<CircleHelp className="h-4 w-4 text-warn" />}>
              {cmp.data.note}
            </Callout>
          )}
          <ComponentLegend />
          <div className={cn('grid gap-5', items.length >= 3 ? 'lg:grid-cols-3' : items.length === 2 ? 'lg:grid-cols-2' : '')} data-tour="locations">
            {items.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                <LocationCard a={a} />
              </motion.div>
            ))}
          </div>
          <ComponentTable items={items} />
        </>
      )}

      <div className="mt-8 grid gap-6">
        <DiffPanel runId={runId} />
      </div>
      <RevisionPanel candidates={all.map((a) => a.area_name)} />
    </PageWrap>
  );
}

function ComponentLegend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {COMP_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COMP_COLOR[k] }} />
          {humanize(k)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm border border-dashed border-line bg-[repeating-linear-gradient(135deg,rgb(var(--border))_0_3px,transparent_3px_6px)]" />
        Missing (weight without evidence)
      </span>
    </div>
  );
}

function HardChip({ h }: { h: Assessment['hard_constraints'][number] }) {
  const meta =
    h.result === 'pass'
      ? { icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: 'bg-ok-soft text-ok border-ok/25' }
      : h.result === 'fail'
        ? { icon: <XCircle className="h-3.5 w-3.5" />, cls: 'bg-bad-soft text-bad border-bad/25' }
        : { icon: <CircleHelp className="h-3.5 w-3.5" />, cls: 'border-dashed border-line text-muted' };
  return (
    <li className={cn('flex items-start gap-2 rounded-xl border px-2.5 py-2 text-[12.5px]', meta.cls)}>
      <span className="mt-0.5">{meta.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{h.name}</span> <span className="uppercase tracking-wide opacity-80">· {h.result}</span>
        <span className="block text-fg/80">{h.reason}</span>
      </span>
      {h.evidence_ids?.length ? <EvidenceChip ids={h.evidence_ids} title={`${h.name}`} label="src" /> : null}
    </li>
  );
}

export function ContributionBar({ a, height = 'h-4' }: { a: Assessment; height?: string }) {
  const comps = COMP_ORDER.map((k) => [k, a.components[k]] as const).filter(([, c]) => !!c);
  const total = Object.values(a.weights ?? {}).reduce((x, y) => x + y, 0) || 1;
  if (!comps.length) return <div className={cn('w-full rounded-full bg-surface2', height)} />;
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-surface2', height)} role="img" aria-label={`Component contributions for ${a.area_name}`}>
      {comps.map(([k, c]) => {
        const w = ((c!.weight ?? 0) / total) * 100;
        const filled = c!.contribution != null ? (c!.contribution / total) * 100 : 0;
        const missing = c!.state !== 'available';
        return (
          <div key={k} className="relative h-full border-r-2 border-surface last:border-r-0" style={{ width: `${w}%` }}>
          <Tooltip
            className="h-full w-full"
            content={
              <span>
                <b>{c!.label}</b>
                <br />
                {missing ? `${humanize(c!.state)} — ${fmtPct(c!.weight)} of weight without evidence` : `normalized ${c!.normalized?.toFixed(2)} × weight ${c!.weight} = ${c!.contribution?.toFixed(3)}`}
              </span>
            }
          >
            <span className="relative block h-full w-full" tabIndex={0}>
              {missing ? (
                <span className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgb(var(--border))_0_4px,transparent_4px_8px)]" />
              ) : (
                <>
                  <span className="absolute inset-0 opacity-20" style={{ background: COMP_COLOR[k] }} />
                  <motion.span
                    className="absolute inset-y-0 left-0"
                    style={{ background: COMP_COLOR[k] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(filled / w) * 100}%` }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                </>
              )}
            </span>
          </Tooltip>
          </div>
        );
      })}
    </div>
  );
}

function LocationCard({ a }: { a: Assessment }) {
  const failed = a.hard_constraints.filter((h) => h.result === 'fail');
  const complete = a.status === 'complete';
  return (
    <Card className={cn('flex h-full flex-col overflow-hidden', !a.eligible && 'border-bad/30')} data-testid={`location-${a.area_name}`}>
      <div className={cn('px-5 py-4', a.eligible ? 'bg-gradient-to-br from-brand-soft/60 to-transparent' : 'bg-gradient-to-br from-bad-soft/70 to-transparent')}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-xl font-bold">{a.area_name}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {a.eligible ? <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>Eligible</Badge> : <Badge tone="bad" icon={<OctagonX className="h-3 w-3" />}>Excluded</Badge>}
              {a.eligible && <StatusPill status={a.status} />}
              {a.practical_rank && <Badge tone="accent">Practical rank #{a.practical_rank}</Badge>}
              {a.rank && <Badge tone="ink">Rank #{a.rank}</Badge>}
            </div>
          </div>
          <EvidenceChip ids={a.evidence_ids} title={`${a.area_name}: assessment evidence`} />
        </div>
        {a.eligible ? (
          <div className="mt-4">
            <p className="eyebrow">Planning index</p>
            <p className="mt-1 font-display text-3xl font-extrabold tracking-tight">
              {a.planning_index?.toFixed(2) ?? '—'}
              <span className="ml-2 text-sm font-semibold text-muted">of {fmtPct(a.available_weight)} weight</span>
            </p>
            <p className={cn('mt-0.5 text-xs font-medium', complete ? 'text-ok' : 'text-warn')}>
              {complete ? 'Complete — all weighted components have evidence' : 'Provisional — not comparable with a complete result'}
            </p>
            <div className="mt-3">
              <ContributionBar a={a} />
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-bad/25 bg-surface/70 p-3 text-sm">
            <p className="font-semibold text-bad">Excluded by a hard constraint</p>
            <p className="mt-0.5 text-muted">{failed.map((h) => `${h.name}: ${h.reason}`).join(' · ')}</p>
            <p className="mt-1 text-xs text-subtle">Taste affinity cannot override a failed constraint; no index is computed.</p>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-4 px-5 py-4">
        <div>
          <p className="eyebrow mb-2">Hard constraints</p>
          <ul className="space-y-1.5">
            {a.hard_constraints.map((h) => (
              <HardChip key={h.name} h={h} />
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="eyebrow">Evidence coverage</p>
            <span className="num text-xs font-semibold">{fmtPct(a.evidence_coverage)}</span>
          </div>
          <Meter value={a.evidence_coverage} tone="accent" label="Evidence coverage" />
          <p className="mt-1 text-[11px] text-subtle">Completeness of expected topics — not a confidence interval.</p>
        </div>
        {a.assumptions.length > 0 && (
          <div>
            <p className="eyebrow mb-1">Assumptions</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-muted">{a.assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        <div>
          <p className="eyebrow mb-1">Limitations</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-muted">{a.limitations.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </Card>
  );
}

function ComponentTable({ items }: { items: Assessment[] }) {
  const { pid } = useProjectCtx();
  const auds = useAudiences(pid).data?.items ?? [];
  const audName = Object.fromEntries(auds.map((a) => [a.id, a.name.replace(/\s*\(hypothetical persona\)/i, '')]));
  const eligible = items.filter((a) => a.eligible);
  if (!eligible.length) return null;
  return (
    <Card className="mt-6">
      <CardHeader title="Component scores" subtitle="Raw values keep their units; normalised values are rank-based within this run. Contribution = normalised × weight." icon={<Scale className="h-4 w-4" />} />
      <div className="p-4">
        <Table caption="Component scores by location">
          <thead>
            <tr>
              <Th>Component</Th>
              <Th className="text-right">Weight</Th>
              {eligible.map((a) => (
                <Th key={a.id} className="text-right">{a.area_name}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMP_ORDER.map((k) => {
              const any = eligible.find((a) => a.components[k])?.components[k];
              if (!any) return null;
              return (
                <tr key={k}>
                  <Td>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COMP_COLOR[k] }} />
                      {any.label}
                    </span>
                  </Td>
                  <Td className="num text-right">{any.weight}</Td>
                  {eligible.map((a) => (
                    <Td key={a.id} className="text-right">
                      <CompCell c={a.components[k]} audName={audName} />
                    </Td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}

function CompCell({ c, audName }: { c?: Component; audName: Record<string, string> }) {
  if (!c) return <span className="text-subtle">—</span>;
  if (c.state !== 'available')
    return (
      <span className="inline-flex flex-col items-end">
        <Badge tone="neutral" className="border-dashed">{c.state === 'disabled_by_experiment' ? 'Disabled (experiment)' : 'Missing'}</Badge>
        <span className="mt-0.5 text-[11px] text-subtle">no evidence — not zero</span>
      </span>
    );
  return (
    <span className="inline-flex flex-col items-end">
      <span className="num font-semibold">{c.contribution?.toFixed(3)}</span>
      <span className="num text-[11px] text-subtle">
        raw {c.raw} {c.units ?? ''} · norm {c.normalized?.toFixed(2)}
      </span>
      {c.by_audience && typeof c.by_audience === 'object' ? (
        <span className="mt-1 flex flex-col items-end gap-0.5">
          {Object.entries(c.by_audience as Record<string, unknown>).map(([id, raw]) => {
            // older runs store a mean affinity number per audience; newer runs store the city taste lift
            const v = raw as number | null | { lift?: number | null; state?: string; n_signal?: number | null; n_baseline?: number | null };
            const isObj = v != null && typeof v === 'object';
            return (
              <span key={id} className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="max-w-[160px] truncate text-muted" title={audName[id]}>{audName[id] ?? id.slice(0, 6)}</span>
                {v == null ? (
                  <span className="text-subtle">unknown</span>
                ) : isObj ? (
                  v.lift != null ? (
                    <b className="num text-violet-700 dark:text-violet-300" title={`${v.n_signal ?? '?'} recommended vs ${v.n_baseline ?? '?'} baseline places`}>
                      {v.lift.toFixed(2)}×
                    </b>
                  ) : (
                    <span className="text-subtle">{humanize(v.state ?? 'unknown')}</span>
                  )
                ) : typeof v === 'number' ? (
                  <b className="num text-violet-700 dark:text-violet-300">{v.toFixed(2)}</b>
                ) : (
                  <span className="text-subtle">unknown</span>
                )}
              </span>
            );
          })}
          <span className="text-[10px] text-subtle">{Object.values(c.by_audience as Record<string, unknown>).some((x) => x != null && typeof x === 'object') ? 'Qloo taste lift per audience · not demand' : 'Qloo affinity · not demand'}</span>
        </span>
      ) : null}
      {c.evidence_ids?.length ? <EvidenceChip ids={c.evidence_ids} title={c.label} label="src" className="mt-0.5" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ experiment */
function DiffPanel({ runId }: { runId?: string }) {
  const d = useRunDiff(runId);
  return (
    <Card>
      <CardHeader icon={<GitCompareArrows className="h-4 w-4" />} title="What changed" subtitle="This run against the previous one: eligibility, status, rank and the revisions in between." />
      <div className="space-y-4 p-5">
        {d.isLoading && <SkeletonCard lines={3} />}
        {d.error && <ErrorState error={d.error} onRetry={() => d.refetch()} />}
        {d.data && !d.data.available && <EmptyState icon={<History className="h-5 w-5" />} title="Nothing to compare yet">{d.data.reason}</EmptyState>}
        {d.data?.available && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={d.data.inputs_changed?.product_version ? 'brand' : 'neutral'}>Product {d.data.inputs_changed?.product_version ? 'changed' : 'unchanged'}</Badge>
              <Badge tone={d.data.inputs_changed?.constraints_version ? 'brand' : 'neutral'}>Constraints {d.data.inputs_changed?.constraints_version ? 'changed' : 'unchanged'}</Badge>
              <Badge>vs run {shortId(d.data.against)}</Badge>
            </div>
            <Table caption="Changes by location">
              <thead>
                <tr>
                  <Th>Location</Th>
                  <Th>Before</Th>
                  <Th />
                  <Th>After</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                {d.data.areas?.map((a) => (
                  <tr key={a.area} className={a.changed ? 'bg-brand-soft/30' : ''}>
                    <Td className="font-semibold">{a.area}</Td>
                    <Td className="text-xs">{fmtState(a.before)}</Td>
                    <Td><ArrowRight className="h-3.5 w-3.5 text-subtle" /></Td>
                    <Td className="text-xs">{fmtState(a.after)}</Td>
                    <Td className="text-xs text-muted">{a.why.join('; ') || (a.changed ? 'see revisions' : 'unchanged')}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {d.data.revisions && d.data.revisions.length > 0 && (
              <div>
                <p className="eyebrow mb-1">Revisions in between</p>
                <ul className="space-y-1 text-[13px]">
                  {d.data.revisions.map((r, i) => (
                    <li key={i}>
                      <Badge tone="accent">{humanize(r.kind)}</Badge> {r.summary}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted">{d.data.strategies?.new_versions.length ?? 0} new strategy version(s) in this run; earlier versions are preserved.</p>
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ revision */
function RevisionPanel({ candidates }: { candidates: string[] }) {
  const { pid, project } = useProjectCtx();
  const revs = useRevisions(pid);
  const [kind, setKind] = useState<'exclude_region' | 'set_ad_budget' | 'disable_feature' | 'enable_feature' | 'change_audience_role'>('exclude_region');
  const [region, setRegion] = useState('');
  const [budget, setBudget] = useState('');
  const [feature, setFeature] = useState('');
  const [aud, setAud] = useState('');
  const [role, setRole] = useState('purchaser');
  const [confirm, setConfirm] = useState(false);
  const body: RevisionBody = {
    kind,
    region_name: kind === 'exclude_region' ? region : undefined,
    ad_spend_budget: kind === 'set_ad_budget' ? budget : undefined,
    feature_key: kind.endsWith('feature') ? feature : undefined,
    audience_id: kind === 'change_audience_role' ? aud : undefined,
    role: kind === 'change_audience_role' ? (role as 'purchaser') : undefined,
  };
  const valid =
    (kind === 'exclude_region' && region) || (kind === 'set_ad_budget' && budget !== '') || (kind.endsWith('feature') && feature) || (kind === 'change_audience_role' && aud && role);
  return (
    <Card className="mt-6">
      <CardHeader icon={<RotateCcw className="h-4 w-4" />} title="Revise and re-run" subtitle="Preview a common revision first. Applying it creates a new version; only affected research, strategies and creative are invalidated and previous results stay." />
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Field label="Revision">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="exclude_region">Exclude a candidate city</option>
              <option value="set_ad_budget">Change the ad-spend budget</option>
              <option value="disable_feature">Remove (disable) a feature</option>
              <option value="enable_feature">Re-enable a feature</option>
              <option value="change_audience_role">Change an audience's buyer role</option>
            </Select>
          </Field>
          {kind === 'exclude_region' && (
            <Field label="City">
              <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Choose…</option>
                {candidates.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          )}
          {kind === 'set_ad_budget' && (
            <Field label={`New ad-spend budget (${project?.constraints?.currency ?? 'INR'})`}>
              <Input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </Field>
          )}
          {kind.endsWith('feature') && (
            <Field label="Feature">
              <Select value={feature} onChange={(e) => setFeature(e.target.value)}>
                <option value="">Choose…</option>
                {project?.product?.features.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name} {f.enabled ? '' : '(disabled)'}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === 'change_audience_role' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Audience">
                <Select value={aud} onChange={(e) => setAud(e.target.value)}>
                  <option value="">Choose…</option>
                  {project?.audiences.map((a) => (
                    <option key={a.audience_id} value={a.audience_id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="New role">
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <Button variant="brand" icon={<Eye className="h-4 w-4" />} disabled={!valid} onClick={() => setConfirm(true)} data-tip="revision-preview">
            Preview the change
          </Button>
          <p className="text-xs text-muted">You see what would change and what stays before anything is applied.</p>
        </div>
        <div>
          <p className="eyebrow mb-2">Revision history</p>
          {revs.isLoading && <SkeletonCard lines={3} />}
          {revs.data?.items.length === 0 && <p className="text-sm text-subtle">No revisions yet.</p>}
          <ol className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {revs.data?.items.slice(0, 12).map((r) => (
              <li key={r.id} className="rounded-xl border border-line p-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="accent">{humanize(r.kind)}</Badge>
                  <span className="text-[11px] text-subtle">{timeAgo(r.created_at)}</span>
                </div>
                <p className="mt-1">{r.summary}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <RevisionPreviewSheet open={confirm} body={valid ? body : null} onClose={() => setConfirm(false)} />
    </Card>
  );
}

function fmtState(x: { eligible: boolean; status: string; planning_index: number | null } | null | undefined) {
  if (!x) return 'not assessed';
  if (!x.eligible) return 'Excluded';
  return `Eligible · ${x.status}${x.planning_index != null ? ` · index ${x.planning_index}` : ''}`;
}
