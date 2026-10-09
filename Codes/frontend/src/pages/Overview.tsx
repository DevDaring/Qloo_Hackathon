import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  FolderArchive,
  Hand,
  Map as MapIcon,
  MapPinned,
  Package,
  Play,
  Scale,
  Store,
  Target,
  Users,
  WandSparkles,
} from 'lucide-react';
import { mutations, pickDefaultRun, useApiMutation, useRun, useRuns } from '../api/hooks';
import { PageWrap } from '../components/AppShell';
import { ConsultPanel } from '../components/ConsultPanel';
import { useProjectCtx } from '../components/ProjectContext';
import { StageTimeline } from '../components/StageTimeline';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton, Stat, StatusPill, fadeUp, stagger } from '../components/ui';
import { cn, fmtMoney, shortId, timeAgo } from '../lib/format';

export default function Overview() {
  const { pid, project, openDecision, setConsoleRunId } = useProjectCtx();
  const runs = useRuns(pid);
  const latest = runs.data?.items[0];
  const best = pickDefaultRun(runs.data?.items);
  const rd = useRun(latest?.id);
  const bestRun = useRun(best?.id !== latest?.id ? best?.id : undefined);
  const toast = useToast();
  const start = useApiMutation(() => mutations.startRun(pid), [['project', pid], ['runs', pid]]);

  if (!project)
    return (
      <PageWrap>
        <Skeleton className="h-9 w-96" />
        <Skeleton className="mt-6 h-40 w-full" />
      </PageWrap>
    );

  const p = project.product;
  const c = project.constraints;
  const photo = project.product_assets.find((a) => a.role === 'product_photo' && a.is_primary) ?? project.product_assets.find((a) => a.role === 'product_photo');
  const openQ = (p?.open_questions ?? []).length + (p?.features ?? []).reduce((n, f) => n + f.critical_unknowns.length, 0);
  const ready = !!p && !!c && project.audiences.length > 0;
  const checklist = [
    { ok: !!p, label: 'Product brief', detail: p ? `v${p.version} · ${p.features.length} features` : 'Not saved yet', to: 'brief' },
    { ok: openQ === 0, warn: openQ > 0, label: 'Open questions', detail: openQ ? `${openQ} to answer (claims stay blocked)` : 'None', to: 'brief' },
    { ok: !!c && c.candidate_regions.length > 0, label: 'Launch constraints', detail: c ? `${c.candidate_regions.length} candidates · ${c.service_regions.length} service areas` : 'Not set', to: 'brief?tab=constraints' },
    { ok: project.audiences.length > 0, label: 'Audiences', detail: `${project.audiences.length} defined`, to: 'audiences' },
    { ok: !!photo, label: 'Product photo', detail: photo ? 'Primary photo uploaded' : 'Needed for flyers', to: 'brief?tab=uploads' },
  ];
  const run = rd.data?.run;
  const assessRun = (bestRun.data ?? rd.data)?.assessments ?? [];
  const counts = (best ?? latest)?.counts ?? {};
  const totalAssets = Object.values(project.asset_counts ?? {}).reduce((a, b) => a + b, 0);

  return (
    <PageWrap>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Project overview {project.is_demo && <Badge tone="brand">Sample · synthetic data</Badge>}
          </span>
        }
        title={project.name}
        description={project.goal}
        actions={
          <>
            <Link to={`/projects/${pid}/explorer`}>
              <Button variant="outline" icon={<MapIcon className="h-4 w-4" />}>
                Market explorer
              </Button>
            </Link>
            <Button
              variant="brand"
              icon={<Play className="h-4 w-4" />}
              disabled={!ready}
              title={ready ? undefined : 'Save the product brief, constraints and at least one audience first'}
              loading={start.isPending}
              onClick={() =>
                start.mutate(undefined, {
                  onSuccess: (r) => {
                    setConsoleRunId(r.run.id);
                    toast.success('Research started', 'Follow each stage in the run console below.');
                  },
                  onError: (e) => toast.error('Could not start research', e),
                })
              }
            >
              Start research
            </Button>
          </>
        }
      />

      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div variants={fadeUp}>
          <Stat label="Places retrieved" value={counts.places ?? null} sub="Retrieved set, not a census" icon={<MapPinned className="h-4 w-4" />} tone="brand" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <Stat label="Placement candidates" value={counts.placements ?? null} sub="All unverified until you check" icon={<Store className="h-4 w-4" />} tone="accent" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <Stat label="Creative briefs" value={project.briefs} sub="Current versions" icon={<WandSparkles className="h-4 w-4" />} tone="brand" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <Stat label="Assets" value={totalAssets} sub={`${project.active_jobs} active job${project.active_jobs === 1 ? '' : 's'}`} icon={<FolderArchive className="h-4 w-4" />} tone="accent" />
        </motion.div>
      </motion.div>

      <div className="mt-6">
          <Card>
          <CardHeader
            title="Latest research run"
            subtitle={latest ? `Run ${shortId(latest.id)} · started ${timeAgo(latest.created_at)}${latest.qloo_enabled ? '' : ' · without Qloo (experiment)'}` : 'No run yet'}
            action={
              run?.status === 'waiting_for_user' ? (
                <Button size="sm" variant="brand" icon={<Hand className="h-3.5 w-3.5" />} onClick={() => openDecision(run.id)}>
                  Decide
                </Button>
              ) : run ? (
                <StatusPill status={run.status} />
              ) : null
            }
          />
          <div className="p-5">
            {runs.error && <ErrorState error={runs.error} onRetry={() => runs.refetch()} />}
            {rd.isLoading && <Skeleton className="h-16 w-full" />}
            {run ? (
              <>
                <StageTimeline run={run} />
                {run.pending_decision && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft/50 p-3">
                    <Hand className="h-4 w-4 text-brand-ink" />
                    <p className="min-w-0 flex-1 text-sm font-medium">{run.pending_decision.title}</p>
                    <Button size="sm" onClick={() => openDecision(run.id)}>
                      Review options <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              !rd.isLoading && (
                <p className="text-sm text-muted">
                  {ready ? 'Everything needed is in place — start research to gather places, climate evidence and taste signals.' : 'Complete the checklist to start research.'}
                </p>
              )
            )}
          </div>
        </Card>

      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {assessRun.length > 0 && (
            <Card>
              <CardHeader
                title="Locations at a glance"
                subtitle="Hard constraints first; planning indices are not forecasts."
                action={
                  <Link to={`/projects/${pid}/compare`} className="link text-sm">
                    Compare <ArrowRight className="inline h-3.5 w-3.5" />
                  </Link>
                }
              />
              <ul className="divide-y divide-line">
                {assessRun.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <MapPinned className={cn('h-4 w-4', a.eligible ? 'text-brand-ink' : 'text-bad')} />
                    <span className="min-w-[110px] font-semibold">{a.area_name}</span>
                    <StatusPill status={a.status} />
                    {!a.eligible && (
                      <span className="text-[13px] text-bad">
                        {a.hard_constraints.filter((h) => h.result === 'fail').map((h) => h.name).join(', ')} failed
                      </span>
                    )}
                    {a.eligible && a.planning_index !== null && (
                      <span className="text-[13px] text-muted">
                        index <b className="num text-fg">{a.planning_index.toFixed(2)}</b> of {Math.round((a.available_weight ?? 0) * 100)}% weight
                      </span>
                    )}
                    {a.practical_rank && <Badge tone="accent">practical #{a.practical_rank}</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <QuickNav pid={pid} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Readiness" subtitle="What the workflow needs from you" />
            <ul className="divide-y divide-line">
              {checklist.map((it) => (
                <li key={it.label}>
                  <Link to={`/projects/${pid}/${it.to}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface2/60">
                    {it.ok ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" />
                    ) : it.warn ? (
                      <CircleAlert className="h-5 w-5 shrink-0 text-warn" />
                    ) : (
                      <CircleDashed className="h-5 w-5 shrink-0 text-subtle" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{it.label}</span>
                      <span className="block truncate text-xs text-muted">{it.detail}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {p && (
            <Card className="overflow-hidden">
              <div className="flex gap-4 p-5">
                {photo ? (
                  <img src={`/api/v1/assets/${photo.asset_id}/download`} alt={`${p.name} product photo`} className="h-24 w-24 shrink-0 rounded-xl border border-line bg-surface2 object-contain" />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-surface2">
                    <Package className="h-6 w-6 text-subtle" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="eyebrow">Product · v{p.version}</p>
                  <p className="mt-0.5 font-display text-lg font-bold leading-tight">{p.name}</p>
                  <p className="text-sm text-muted">{p.category}</p>
                  <p className="mt-1 font-display font-semibold">{p.price !== null ? fmtMoney(p.price, p.currency) : <span className="text-subtle">Price unknown</span>}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 border-t border-line px-5 py-3">
                {p.features.map((f) => (
                  <Badge key={f.key} tone={f.enabled ? 'accent' : 'neutral'}>
                    {f.name}
                    {!f.enabled && ' (off)'}
                  </Badge>
                ))}
                {p.is_synthetic && <Badge tone="brand">Synthetic placeholders</Badge>}
              </div>
            </Card>
          )}

          <ConsultPanel />
        </div>
      </div>
    </PageWrap>
  );
}

function QuickNav({ pid }: { pid: string }) {
  const items = [
    { to: 'explorer', icon: MapIcon, title: 'Market explorer', body: 'Map, places, competitors and evidence coverage' },
    { to: 'compare', icon: Scale, title: 'Location comparison', body: 'Constraints, components and trade-offs' },
    { to: 'audiences', icon: Users, title: 'Audience insights', body: 'Roles, interests and Qloo entities' },
    { to: 'strategy', icon: Target, title: 'Campaign strategy', body: 'Positioning, placements, pilot and budget' },
    { to: 'studio', icon: WandSparkles, title: 'Ad studio', body: 'Briefs, flyers, storyboard and video' },
    { to: 'results', icon: BarChart3, title: 'Results', body: 'Import measured pilot outcomes' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((it) => (
        <Link key={it.to} to={`/projects/${pid}/${it.to}`} className="card card-hover group flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink transition group-hover:scale-110">
            <it.icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{it.title}</span>
            <span className="block text-xs text-muted">{it.body}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
