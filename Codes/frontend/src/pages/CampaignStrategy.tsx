import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Bot,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  Lightbulb,
  ListChecks,
  MapPinned,
  Megaphone,
  RefreshCw,
  Send,
  Star,
  Target,
  Wallet,
} from 'lucide-react';
import { mutations, useApiMutation, usePlacements, usePublicConfig, useStrategies, useStrategy } from '../api/hooks';
import type { Placement, Place, Strategy, StrategyDetail } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { EvidenceBadge, EvidenceChip } from '../components/Evidence';
import { SERIES } from '../components/ExplorerCharts';
import { MapView } from '../components/MapView';
import { ConfirmDialog } from '../components/Overlay';
import { useProjectCtx } from '../components/ProjectContext';
import { Editable, LockNote, useLocked } from '../components/Locked';
import { useToast } from '../components/Toast';
import { StrategyNextStep } from '../components/StrategyNextStep';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, ErrorState, PageHeader, Select, SkeletonCard, Table, Tabs, Td, Th, Textarea, Tooltip } from '../components/ui';
import { cn, fmtDate, fmtMoney, humanize } from '../lib/format';
import { PLACEMENT_STATUS, ROLE_LABEL } from '../lib/labels';

export default function CampaignStrategy() {
  const { pid, sel, setSel } = useProjectCtx();
  const q = useStrategies(pid);
  const [params, setParams] = useSearchParams();
  const groups = useMemo(() => {
    const m = new Map<string, Strategy[]>();
    for (const s of q.data?.items ?? []) {
      const k = `${s.area_id}|${s.audience_version_id}`;
      m.set(k, [...(m.get(k) ?? []), s].sort((a, b) => b.version - a.version));
    }
    return Array.from(m.entries());
  }, [q.data]);
  // default to the shared working context (city × audience) when it matches a strategy
  const ctxPair = groups.find(([k]) => {
    const [a, au] = k.split('|');
    return (!sel.areaId || a === sel.areaId) && (!sel.audienceId || au === sel.audienceId);
  })?.[0];
  const tab = params.get('pair') ?? ctxPair ?? groups[0]?.[0];
  const versions = groups.find(([k]) => k === tab)?.[1] ?? [];
  const sid = params.get('s') && versions.some((v) => v.id === params.get('s')) ? params.get('s')! : versions[0]?.id;

  return (
    <PageWrap>
      <PageHeader
        eyebrow="Plan"
        title="Campaign strategy"
        description="Evidence-linked launch strategies per location × audience: positioning, the feature to lead with, partners, placements, a small pilot and a budget scenario."
      />
      {q.isLoading && <SkeletonCard lines={10} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && groups.length === 0 && (
        <StrategyNextStep />
      )}
      {groups.length > 0 && (
        <>
          <Tabs
            className="mb-6"
            value={tab ?? ''}
            onChange={(k) => {
              setParams({ pair: k });
              const [a, au] = k.split('|');
              setSel({ areaId: a, audienceId: au });
            }}
            tabs={groups.map(([k, vs]) => ({
              key: k,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <MapPinned className="h-3.5 w-3.5" />
                  {vs[0].content.selected?.area_name} × {vs[0].content.selected?.audience_name?.replace(/\s*\(hypothetical persona\)/i, '')}
                  {vs[0].stale && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" aria-label="stale" />}
                </span>
              ),
            }))}
          />
          {versions.length > 1 && (
            <div className="mb-4 flex items-center gap-2 text-sm">
              <label htmlFor="sv" className="text-muted">Version</label>
              <Select id="sv" className="h-9 w-auto py-1" value={sid} onChange={(e) => setParams({ pair: tab!, s: e.target.value })}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {fmtDate(v.created_at)} {v.stale ? '· stale' : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div key={sid} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {sid && <StrategyView sid={sid} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </PageWrap>
  );
}

function StrategyView({ sid }: { sid: string }) {
  const { pid, setConsoleRunId } = useProjectCtx();
  const q = useStrategy(sid);
  const toast = useToast();
  const [regen, setRegen] = useState(false);
  const rewrite = useApiMutation(
    () => mutations.createStrategy(pid, { run_id: q.data!.run_id!, area_id: q.data!.area_id, audience_version_id: q.data!.audience_version_id, force: true }),
    [['strategies', pid], ['jobs', pid]],
  );
  if (q.isLoading) return <SkeletonCard lines={12} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const c = s.content;
  const pl = (id: string) => s.placements.find((p) => p.id === id);
  const dropped = s.validation?.dropped;
  const droppedClaims = dropped?.claims ?? [];
  const droppedEv = (dropped as { evidence_ids?: string[] } | undefined)?.evidence_ids ?? [];
  const evIds = (ids: string[]) => ids;

  return (
    <div className="space-y-6">
      {s.stale && (
        <Callout tone="warn" icon={<AlertTriangle className="h-4 w-4 text-warn" />} title="This strategy is stale">
          {s.stale_reason ?? 'An input changed since it was written.'} Re-run research or regenerate the strategy before creating new creative from it.
        </Callout>
      )}
      {/* hero */}
      <Card className="relative overflow-hidden" data-tour="strategy">
        <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-[#FF7A45]/20 to-[#1F6FEB]/20 blur-3xl" />
        <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="brand" icon={<MapPinned className="h-3 w-3" />}>{c.selected.area_name}</Badge>
              <Badge tone="accent">{c.selected.audience_name}</Badge>
              <Badge>{ROLE_LABEL[c.selected.audience_role]}</Badge>
              <Badge>v{s.version}</Badge>
              <Tooltip content={s.generator?.type === 'llm' ? `Written by ${s.generator.model}; every message passed a deterministic claim check.` : 'Template strategy: the reasoning provider was unavailable.'}>
                <span tabIndex={0}>
                  <Badge tone={s.generator?.type === 'llm' ? 'violet' : 'warn'} icon={<Bot className="h-3 w-3" />}>
                    {s.generator?.type === 'llm' ? `LLM · ${s.generator.model}` : 'Template'}
                  </Badge>
                </span>
              </Tooltip>
            </div>
            <p className="eyebrow mt-5">Positioning</p>
            <p className="mt-1.5 font-display text-[22px] font-semibold leading-snug tracking-tight">“{c.positioning}”</p>
            <div className="mt-5 rounded-2xl border border-line bg-surface/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Lightbulb className="h-4 w-4 text-brand-ink" />
                <span className="text-sm font-semibold">Lead with: {humanize(c.main_feature_key)}</span>
                <EvidenceBadge badge="Hypothesis" />
                <EvidenceChip ids={c.main_feature_rationale.evidence_ids} title="Main feature rationale" />
              </div>
              <p className="mt-1.5 text-sm text-muted">{c.main_feature_rationale.text}</p>
            </div>
          </div>
          <div className="space-y-3">
            {c.location_summary && (
              <div className="rounded-2xl border border-line bg-surface/70 p-4">
                <p className="eyebrow">Location summary</p>
                <p className="mt-1 font-display text-2xl font-bold">
                  {c.location_summary.planning_index?.toFixed(2) ?? '—'} <span className="text-sm font-semibold text-muted">of {Math.round(c.location_summary.available_weight * 100)}% weight</span>
                </p>
                <p className="text-xs text-muted">{c.location_summary.status === 'complete' ? 'Complete evidence' : 'Incomplete — provisional index'}</p>
              </div>
            )}
            <div className="rounded-2xl border border-line bg-surface/70 p-4 text-[13px]">
              <p className="eyebrow mb-1.5">Validation</p>
              <p className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-ok" /> Claim checker: {s.validation?.claim_checker ?? '—'}
              </p>
              <p className="mt-1 text-muted">
                {droppedClaims.length} unsupported claim{droppedClaims.length === 1 ? '' : 's'} removed · {new Set(droppedEv).size} invalid evidence citation{new Set(droppedEv).size === 1 ? '' : 's'} dropped
              </p>
              {droppedClaims.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-bad">
                  {droppedClaims.map((d) => (
                    <li key={d.text}>{d.text}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <EvidenceChip ids={s.evidence_ids} title="All evidence behind this strategy" label={`All ${s.evidence_ids.length} evidence`} />
              <Editable>
                <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={!s.run_id} onClick={() => setRegen(true)}>
                  Regenerate
                </Button>
              </Editable>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<FlaskConical className="h-4 w-4" />} title="Feature-emphasis hypotheses" subtitle="Two competing hypotheses to test in the pilot — not conclusions." />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {c.feature_hypotheses.map((h, i) => (
              <div key={i} className="rounded-2xl border border-warn/25 bg-warn-soft/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg font-extrabold text-warn">H{i + 1}</span>
                  <EvidenceChip ids={evIds(h.evidence_ids)} title={`Hypothesis H${i + 1}`} />
                </div>
                <p className="mt-1 text-[13.5px]">{h.text}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Megaphone className="h-4 w-4" />} title="Key messages & supporting benefits" subtitle="Each passed the claim check. Click an evidence chip to see its basis." />
          <ul className="divide-y divide-line">
            {c.key_messages.map((m, i) => (
              <li key={`k${i}`} className="flex items-start justify-between gap-3 px-5 py-3">
                <span className="text-[13.5px] font-medium">{m.text}</span>
                <EvidenceChip ids={m.evidence_ids} title={m.text} />
              </li>
            ))}
            {c.supporting_benefits.map((m, i) => (
              <li key={`b${i}`} className="flex items-start justify-between gap-3 px-5 py-3">
                <span className="text-[13.5px] text-muted">
                  <Badge className="mr-1.5">benefit</Badge>
                  {m.text}
                </span>
                <EvidenceChip ids={m.evidence_ids} title={m.text} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PickList title="Partner shortlist" subtitle="Affinity or category fit does not establish willingness to collaborate." icon={<Star className="h-4 w-4" />} picks={c.partner_shortlist} pl={pl} />
        <PickList title="Placement options" subtitle="A place record is not an ad slot. Every option needs verification." icon={<Send className="h-4 w-4" />} picks={c.placement_options} pl={pl} />
      </div>

      <PlacementsSection s={s} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<CalendarRange className="h-4 w-4" />} title="Launch steps" />
          <ol className="relative p-5">
            {c.launch_steps.map((st, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="relative flex gap-4 pb-5 last:pb-0">
                {i < c.launch_steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-gradient-to-b from-brand/50 to-line" aria-hidden />}
                <span className="z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-display text-xs font-bold text-white dark:bg-white dark:text-[#0E1320]">{i + 1}</span>
                <div>
                  <p className="text-[13.5px] font-medium">{st.step}</p>
                  {st.timing && <p className="text-xs text-subtle">{st.timing}</p>}
                </div>
              </motion.li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardHeader icon={<ClipboardList className="h-4 w-4" />} title={`Pilot plan · ${c.pilot_plan.duration_weeks} weeks`} subtitle={c.pilot_plan.objective} />
          <div className="space-y-4 p-5 text-[13.5px]">
            <div>
              <p className="eyebrow mb-1">Steps</p>
              <ul className="list-disc space-y-0.5 pl-5">{c.pilot_plan.steps.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <p className="eyebrow mb-1">Signals worth watching</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted">{c.pilot_plan.success_signals.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Target className="h-4 w-4" />} title="KPIs — targets to test" subtitle="Suggested targets for the pilot, never asserted outcomes." />
          <div className="p-4">
            <Table caption="KPIs to test">
              <thead>
                <tr>
                  <Th>Metric</Th>
                  <Th>Target to test</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                {c.kpis_to_test.map((k) => (
                  <tr key={k.metric}>
                    <Td className="font-medium">{k.metric}</Td>
                    <Td><Badge tone="warn">to test</Badge> <span className="text-[13px]">{k.target_to_test}</span></Td>
                    <Td className="text-xs text-muted">{k.rationale}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {c.expected_learning.length > 0 && (
              <div className="mt-4">
                <p className="eyebrow mb-1">Expected learning</p>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-muted">{c.expected_learning.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        </Card>
        <BudgetCard s={s} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <p className="section-title mb-2">Assumptions</p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">{c.assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
        <Card className="p-5">
          <p className="section-title mb-2">Limitations</p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">{c.limitations.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
      </div>

      <div id="handoff" className="scroll-mt-28 space-y-3">
        <Callout tone="brand" icon={<FileText className="h-4 w-4" />} title="Turn this strategy into ads" action={<Link to={`/projects/${pid}/studio`}><Button size="sm" variant="brand">Open Ad studio</Button></Link>}>
          Write a creative brief from this strategy in the Ad studio (“New brief from strategy”). Briefs need your approval before any image or video is generated.
        </Callout>
        <Callout tone="neutral" icon={<FileText className="h-4 w-4" />} title="Placement brief & outreach draft (not sent)" action={<Link to={`/projects/${pid}/assets`}><Button size="sm" variant="outline">Assets & exports</Button></Link>}>
          The campaign package includes a placement brief and an outreach draft for your shortlisted placements. LaunchLens never contacts businesses or buys ads — you send anything yourself.
        </Callout>
      </div>

      <ConfirmDialog
        open={regen}
        onClose={() => setRegen(false)}
        title="Regenerate this strategy?"
        confirmLabel="Regenerate"
        loading={rewrite.isPending}
        onConfirm={() =>
          rewrite.mutate(undefined, {
            onSuccess: () => {
              setRegen(false);
              if (s.run_id) setConsoleRunId(s.run_id);
              toast.success('Strategy job queued', 'A new version appears when it completes; this one is preserved.');
            },
            onError: (e) => toast.error('Could not regenerate', e),
          })
        }
      >
        A new version is written with the reasoning model (small reasoning cost, no image or video generation) from the same research evidence. Version v{s.version} stays available.
      </ConfirmDialog>
    </div>
  );
}

function PickList({
  title,
  subtitle,
  icon,
  picks,
  pl,
}: {
  title: string;
  subtitle: string;
  icon: JSX.Element;
  picks: { placement_id: string; rationale: string; verification_questions: string[] }[];
  pl: (id: string) => Placement | undefined;
}) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <ul className="divide-y divide-line">
        {picks.length === 0 && <li className="p-5 text-sm text-subtle">None proposed.</li>}
        {picks.map((p) => {
          const x = pl(p.placement_id);
          const st = PLACEMENT_STATUS[x?.status ?? 'candidate'];
          return (
            <li key={p.placement_id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{x?.name ?? 'Placement'}</span>
                {x && <Badge tone={st?.tone === 'ok' ? 'ok' : st?.tone === 'bad' ? 'bad' : st?.tone === 'warn' ? 'warn' : 'neutral'}>{st?.label}</Badge>}
                {x && <Badge>{humanize(x.channel_type)}</Badge>}
                {x && typeof x.qloo_relevance?.affinity === 'number' && <Badge tone="violet">Qloo affinity {(x.qloo_relevance.affinity as number).toFixed(2)}</Badge>}
                {x?.practical_evidence_ids?.length ? <EvidenceChip ids={x.practical_evidence_ids} title={x.name} className="ml-auto" /> : null}
              </div>
              <p className="mt-1 text-[13px] text-muted">{p.rationale}</p>
              {p.verification_questions.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {p.verification_questions.map((q) => (
                    <li key={q} className="flex gap-1.5">
                      <ListChecks className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                      {q}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const VKEYS = ['availability', 'permission', 'contact', 'cost', 'dates'];

function PlacementsSection({ s }: { s: StrategyDetail }) {
  const { pid } = useProjectCtx();
  const cfg = usePublicConfig().data;
  const q = usePlacements(pid, { run_id: s.run_id ?? undefined, area_id: s.area_id, audience_version_id: s.audience_version_id });
  const toast = useToast();
  const [onlyShort, setOnlyShort] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const patch = useApiMutation((v: { id: string; b: Parameters<typeof mutations.patchPlacement>[1] }) => mutations.patchPlacement(v.id, v.b), [['placements', pid], ['strategy']]);
  const items = (q.data?.items ?? []).filter((p) => !onlyShort || p.shortlisted);
  const asPlaces: Place[] = items
    .filter((p) => p.location)
    .map((p) => ({
      id: p.id,
      area_id: p.area_id,
      provider: p.source,
      provider_id: '',
      name: p.name,
      category: p.category,
      role: p.channel_type === 'partner_business' ? 'partner' : p.channel_type === 'physical_venue' ? 'venue' : 'institution',
      role_basis: '',
      address: p.address,
      lat: p.location!.lat,
      lon: p.location!.lon,
      distance_m: null,
      accessibility: p.accessibility,
      metadata: {},
      retrieved_at: '',
      evidence_id: null,
    }));
  const short = new Set((q.data?.items ?? []).filter((p) => p.shortlisted).map((p) => p.id));
  const locked = useLocked();
  const doPatch = (id: string, b: Parameters<typeof mutations.patchPlacement>[1], ok?: string) =>
    patch.mutate({ id, b }, { onSuccess: () => ok && toast.success(ok), onError: (e) => toast.error('Could not update placement', e) });

  return (
    <Card>
      <CardHeader
        icon={<Send className="h-4 w-4" />}
        title="Placements & partnerships"
        subtitle="Compare candidates, shortlist, and record what you have verified. A verified opportunity needs availability, permission, contact, cost and dates verified."
        action={
          <button className="text-xs font-semibold text-accent-ink" onClick={() => setOnlyShort((v) => !v)} aria-pressed={onlyShort}>
            {onlyShort ? 'Show all' : 'Shortlist only'}
          </button>
        }
      />
      {q.isLoading && <div className="p-5"><SkeletonCard lines={5} /></div>}
      {q.error && <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}
      {q.data && (
        <div className="grid gap-4 p-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
            {locked && <LockNote className="mb-2 max-w-none">Read-only sample: shortlist, status and verification are shown as recorded. Duplicate the project to change them.</LockNote>}
            <Table caption="Placement comparison">
              <thead>
                <tr>
                  <Th>Placement</Th>
                  <Th>Activation</Th>
                  <Th>Status</Th>
                  <Th>Verification</Th>
                  <Th className="text-right">Qloo affinity</Th>
                  <Th className="text-right">Suitability</Th>
                  <Th>Shortlist</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={cn(selected === p.id && 'bg-brand-soft/40')} onClick={() => setSelected(p.id)}>
                    <Td className="min-w-[200px]">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-muted">
                        {humanize(p.channel_type)} · {humanize(p.category)} · accessibility {p.accessibility === 'unknown' ? 'unknown' : humanize(p.accessibility)}
                      </p>
                      <p className="mt-1 text-[11.5px] text-subtle">Next: {p.next_action}</p>
                      <details className="mt-1 text-xs" onClick={(e) => e.stopPropagation()}>
                        <summary className="cursor-pointer font-medium text-accent-ink">Notes</summary>
                        <Textarea
                          className="mt-1 min-h-[60px] text-xs"
                          defaultValue={p.owner_notes}
                          aria-label={`Notes for ${p.name}`}
                          onBlur={(e) => e.target.value !== p.owner_notes && doPatch(p.id, { owner_notes: e.target.value }, 'Notes saved')}
                        />
                      </details>
                    </Td>
                    <Td className="text-xs">{humanize(p.activation)}</Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <Select aria-label={`Status of ${p.name}`} className="h-8 w-44 py-0.5 text-xs" value={p.status} onChange={(e) => doPatch(p.id, { status: e.target.value as 'candidate' }, 'Status updated')}>
                        {Object.entries(PLACEMENT_STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td onClick={(e) => e.stopPropagation()} className="min-w-[230px]">
                      <div className="flex flex-wrap gap-1">
                        {VKEYS.map((k) => {
                          const v = p.verification?.[k] ?? 'unknown';
                          const next = v === 'unknown' ? 'verified' : v === 'verified' ? 'declined' : 'unknown';
                          return (
                            <Tooltip key={k} content={`${humanize(k)}: ${v}. Click to mark ${next}.`}>
                              <button
                                className={cn(
                                  'rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold capitalize',
                                  v === 'verified' ? 'border-ok/30 bg-ok-soft text-ok' : v === 'declined' ? 'border-bad/30 bg-bad-soft text-bad' : 'border-dashed border-line text-subtle',
                                )}
                                onClick={() => doPatch(p.id, { verification: { [k]: next as 'verified' } })}
                              >
                                {k}
                              </button>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </Td>
                    <Td className="text-right text-xs">
                      <QlooAffinity p={p} />
                    </Td>
                    <Td className="num text-right text-xs">{p.suitability_score?.toFixed(2) ?? '—'}</Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => doPatch(p.id, { shortlisted: !p.shortlisted }, p.shortlisted ? 'Removed from shortlist' : 'Shortlisted')} aria-label={p.shortlisted ? `Remove ${p.name} from shortlist` : `Shortlist ${p.name}`} className="rounded p-1 hover:bg-surface2">
                        <Star className={cn('h-4 w-4', p.shortlisted ? 'fill-amber-400 text-amber-500' : 'text-subtle')} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {items.length === 0 && <EmptyState title={onlyShort ? 'Nothing shortlisted yet' : 'No placements for this pair'} className="mt-3" />}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
              {Object.entries(q.data.legend).map(([k, v]) => (
                <span key={k}>
                  <b className="text-fg">{PLACEMENT_STATUS[k]?.label ?? k}:</b> {v}
                </span>
              ))}
            </div>
          </fieldset>
          <div className="overflow-hidden rounded-2xl border border-line">
            {mapErr || !cfg ? (
              <div className="p-4 text-xs text-muted">{mapErr ?? 'Loading map…'}</div>
            ) : (
              <MapView
                styleUrl={cfg.mapStyleUrl}
                places={asPlaces}
                areas={[]}
                shortlisted={short}
                selectedId={selected}
                onSelect={setSelected}
                onError={setMapErr}
                initial={asPlaces[0] ? { center: [asPlaces[0].lon, asPlaces[0].lat], zoom: 12 } : undefined}
                className="h-[340px] w-full 2xl:h-full 2xl:min-h-[420px]"
              />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function QlooAffinity({ p }: { p: Placement }) {
  const r = p.qloo_relevance;
  const a = r && typeof r.affinity === 'number' ? (r.affinity as number) : null;
  if (a === null)
    return (
      <Tooltip content={r?.state === 'not_available' ? 'No Qloo signal for this placement.' : 'Unknown — no Qloo affinity returned.'}>
        <span tabIndex={0} className="text-subtle">unknown</span>
      </Tooltip>
    );
  return (
    <Tooltip content={String(r?.meaning ?? 'Qloo affinity to audience interests; not willingness to collaborate')}>
      <span tabIndex={0} className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950">
          <span className="block h-full rounded-full bg-violet-600" style={{ width: `${Math.round(a * 100)}%` }} />
        </span>
        <b className="num text-violet-700 dark:text-violet-300">{a.toFixed(2)}</b>
      </span>
    </Tooltip>
  );
}

function BudgetCard({ s }: { s: Strategy }) {
  const b = s.budget_scenario;
  const data = (b.lines ?? []).map((l) => ({ name: l.placement, amount: l.amount, basis: l.basis, type: l.channel_type }));
  return (
    <Card>
      <CardHeader icon={<Wallet className="h-4 w-4" />} title="Budget scenario" subtitle="A planning scenario splitting your ad-spend budget — not observed advertising prices." />
      <div className="p-4">
        {b.status !== 'scenario' ? (
          <EmptyState title="No budget scenario">{b.note}</EmptyState>
        ) : (
          <>
            <p className="font-display text-2xl font-bold">{fmtMoney(b.total, b.currency)}</p>
            <div className="mt-2 h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64, top: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={150} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} />
                  <RTooltip
                    cursor={{ fill: 'rgb(var(--surface-2))' }}
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <div className="max-w-[240px] rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lift">
                          <p className="font-semibold">{payload[0].payload.name}</p>
                          <p className="num">{fmtMoney(payload[0].payload.amount, b.currency)}</p>
                          <p className="text-muted">{payload[0].payload.basis}</p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {data.map((d, i) => (
                      <Cell key={i} fill={d.type === 'reserve' ? '#9AA1B2' : d.type === 'digital_geo' ? SERIES[0] : SERIES[1]} />
                    ))}
                    <LabelList dataKey="amount" position="right" formatter={(v: number) => fmtMoney(v, b.currency)} style={{ fontSize: 11, fill: 'rgb(var(--text))' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {data.map((d) => (
                <li key={d.name}>
                  <b className="text-fg">{d.name}</b> — {d.basis} ({b.total ? Math.round((d.amount / b.total) * 100) : 0}% of total)
                </li>
              ))}
            </ul>
            {b.formula && <p className="mt-2 font-mono text-[11px] text-subtle">{b.formula}</p>}
            <ul className="mt-2 list-disc pl-5 text-xs text-subtle">{b.assumptions?.map((a) => <li key={a}>{a}</li>)}</ul>
          </>
        )}
      </div>
    </Card>
  );
}
