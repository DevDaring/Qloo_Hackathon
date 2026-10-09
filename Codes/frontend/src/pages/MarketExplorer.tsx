import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkPlus,
  Network,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  Layers,
  List,
  Map as MapIcon,
  MapPinned,
  Navigation,
  PenTool,
  Play,
  Save,
  Scale,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import {
  mutations,
  pickDefaultRun,
  useAnalytics,
  useApiMutation,
  useAreas,
  useAudiences,
  usePlaces,
  useProviders,
  usePublicConfig,
  useRun,
  useRuns,
  useTasteLayer,
  type PlaceFilters,
} from '../api/hooks';
import type { Place } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { ActionPreview } from '../components/ActionPreview';
import { researchPrereqs } from '../hooks/useJourney';
import { CategoryDistribution, Competitors, EvidenceCoverage, FeatureRelevance, TasteProfile, categoryColor } from '../components/ExplorerCharts';
import { EvidenceChip } from '../components/Evidence';
import { MapView, type MapArea, type MapViewHandle } from '../components/MapView';
import { Modal } from '../components/Overlay';
import { useProjectCtx } from '../components/ProjectContext';
import { Editable, useLocked } from '../components/Locked';
import { WhyThisPlace } from '../components/WhyThisPlace';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Td,
  Th,
  Toggle,
} from '../components/ui';
import { cn, fmtDate, humanize, shortId, timeAgo } from '../lib/format';
import { PLACE_ROLE_COLOR, PLACE_ROLE_LABEL } from '../lib/labels';

const ROLES = ['competitor', 'partner', 'venue', 'institution'];

export default function MarketExplorer() {
  const { project } = useProjectCtx();
  if (!project)
    return (
      <PageWrap>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-6 h-[560px] w-full" />
      </PageWrap>
    );
  return <Explorer />;
}

function Explorer() {
  const { pid, project, setConsoleRunId, sel: ctxSel, setSel } = useProjectCtx();
  const [params, setParams] = useSearchParams();
  const saved = project?.saved_map_state ?? {};
  const runs = useRuns(pid);
  const runId = pickDefaultRun(runs.data?.items, params.get('run') ?? ctxSel.runId ?? saved.run_id)?.id;
  const rd = useRun(runId);
  const areasQ = useAreas(pid);
  const cfg = usePublicConfig().data;
  const providers = useProviders().data;
  const audiences = useAudiences(pid).data?.items ?? [];
  const toast = useToast();
  const nav = useNavigate();

  // the city filter is the shared working context (context bar ↔ explorer)
  const areaId = ctxSel.areaId ?? '';
  const setAreaId = (v: string) => setSel({ areaId: v || undefined });
  useEffect(() => {
    if (!ctxSel.areaId && saved.filters?.area_id) setSel({ areaId: saved.filters.area_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [cats, setCats] = useState<string[]>(saved.filters?.category ? saved.filters.category.split(',') : []);
  const [roles, setRoles] = useState<string[]>(saved.filters?.role ? saved.filters.role.split(',') : []);
  const [view, setView] = useState<'map' | 'list'>(saved.view ?? 'map');
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [tray, setTray] = useState<string[]>([]);
  const [provider, setProvider] = useState<'all' | 'qloo' | 'osm'>('all');
  const [taste, setTaste] = useState(false);
  const [tasteAud, setTasteAud] = useState(ctxSel.audienceId ?? '');
  const [drawing, setDrawing] = useState(false);
  const [drawPts, setDrawPts] = useState<[number, number][]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [limit, setLimit] = useState(120);
  const mapRef = useRef<MapViewHandle>(null);
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const filters: PlaceFilters = useMemo(
    () => ({ area_id: areaId || undefined, category: cats.length ? cats.join(',') : undefined, role: roles.length ? roles.join(',') : undefined }),
    [areaId, cats, roles],
  );
  const places = usePlaces(runId, filters);
  const analytics = useAnalytics(runId, filters);
  const allCats = useAnalytics(runId, { area_id: areaId || undefined }).data;
  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    Object.values(allCats?.category_distribution ?? {}).forEach((m) => Object.keys(m).forEach((c) => s.add(c)));
    return Array.from(s).sort();
  }, [allCats]);

  const assessments = rd.data?.assessments ?? [];
  const projectAreas = areasQ.data?.items ?? [];
  const mapAreas: MapArea[] = useMemo(() => {
    const fromAssess: MapArea[] = assessments.map((a) => ({
      id: a.area_id,
      name: a.area_name,
      center: a.center,
      radius_m: a.radius_m,
      polygon: projectAreas.find((x) => x.id === a.area_id)?.polygon,
      tone: !a.eligible ? 'excluded' : a.status === 'complete' ? 'eligible' : 'incomplete',
    }));
    const savedAreas: MapArea[] = projectAreas
      .filter((x) => x.kind === 'saved')
      .map((x) => ({ id: x.id, name: x.name, center: x.center, radius_m: x.radius_m, polygon: x.polygon, tone: 'saved' }));
    return [...fromAssess, ...savedAreas];
  }, [assessments, projectAreas]);

  const shortlisted = useMemo(() => new Set(projectAreas.flatMap((a) => a.shortlisted_place_ids)), [projectAreas]);
  const allItems = places.data?.items ?? [];
  const provCounts = useMemo(() => ({ qloo: allItems.filter((p) => p.provider === 'qloo').length, osm: allItems.filter((p) => p.provider !== 'qloo').length }), [allItems]);
  const items = useMemo(() => (provider === 'all' ? allItems : allItems.filter((p) => (provider === 'qloo' ? p.provider === 'qloo' : p.provider !== 'qloo'))), [allItems, provider]);
  const audName = useMemo(() => Object.fromEntries(audiences.map((a) => [a.id, a.name.replace(/\s*\(hypothetical persona\)/i, '')])), [audiences]);
  const sel = items.find((p) => p.id === selected) ?? null;

  const tasteQ = useTasteLayer(runId, areaId || assessments[0]?.area_id, tasteAud || audiences[0]?.id, taste);
  const tastePts = useMemo(
    () =>
      tasteQ.data?.available
        ? (tasteQ.data.points ?? [])
            .map((p) => ({ lat: Number(p.lat ?? p.latitude), lon: Number(p.lon ?? p.longitude), w: Number(p.affinity_rank ?? p.affinity ?? p.value ?? 0.5) }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        : null,
    [tasteQ.data],
  );

  // when the taste layer arrives, bring its area into view so the heatmap is legible
  useEffect(() => {
    if (!taste || !tastePts?.length) return;
    const a = assessments.find((x) => x.area_id === (areaId || assessments[0]?.area_id));
    if (a?.center) mapRef.current?.flyTo(a.center.lon, a.center.lat, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taste, tastePts]);

  useEffect(() => {
    if (selected && cardRefs.current[selected]) cardRefs.current[selected]!.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const shortlist = useApiMutation((p: Place) => {
    const area = projectAreas.find((a) => a.id === p.area_id);
    const cur = area?.shortlisted_place_ids ?? [];
    const next = cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id];
    return mutations.patchArea(p.area_id, { shortlisted_place_ids: next });
  }, [['areas', pid]]);
  const saveState = useApiMutation(() => {
    const v = mapRef.current?.getView();
    return mutations.saveMapState(pid, {
      center: v?.center,
      zoom: v?.zoom,
      filters: { area_id: areaId || undefined, category: cats.join(',') || undefined, role: roles.join(',') || undefined },
      run_id: runId,
      area_id: areaId || undefined,
      view,
    });
  }, [['project', pid]]);
  const start = useApiMutation(() => mutations.startRun(pid), [['project', pid], ['runs', pid]]);
  const prereqs = researchPrereqs(project);
  const locked = useLocked();
  const [why, setWhy] = useState<Place | null>(null);

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const showTable = view === 'list' || !!mapError;
  const run = rd.data?.run;
  const totalsAgree = places.data && analytics.data ? places.data.total === analytics.data.total_places : null;

  return (
    <PageWrap className="max-w-[1680px]">
      <PageHeader
        eyebrow="Research workspace"
        title="Market explorer"
        description="Retrieved businesses, competitors, potential partners and candidate areas — with the source and limits of every count."
        actions={
          <>
            <label className="sr-only" htmlFor="run-select">Research run</label>
            <span id="runs" className="sr-only">Research runs</span>
            <Select
              id="run-select"
              className="h-10 w-auto min-w-[220px]"
              value={runId ?? ''}
              onChange={(e) => {
                setParams({ run: e.target.value });
                setSel({ runId: e.target.value });
                setSelected(null);
              }}
            >
              {(runs.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  Run {shortId(r.id)} · {r.status.replace(/_/g, ' ')} · {r.counts?.places ?? 0} places{r.qloo_enabled ? '' : ' · no Qloo'} · {timeAgo(r.created_at)}
                </option>
              ))}
              {!runs.data?.items.length && <option value="">No runs yet</option>}
            </Select>
            <ActionPreview
              tip="Find places and audience matches for your selected cities."
              title="Start research"
              details={<p>Starts a new research run (places, climate, Qloo taste signals) with the current brief and audiences. Earlier runs stay available in the run selector. Nothing is generated or bought.</p>}
              disabledReason={prereqs.length ? `First ${prereqs.join(', ')}.` : undefined}
              edit
            >
              <Button
                id="start"
                variant="outline"
                icon={<Play className="h-4 w-4" />}
                loading={start.isPending}
                disabled={prereqs.length > 0}
                onClick={() =>
                  start.mutate(undefined, {
                    onSuccess: (r) => {
                      setConsoleRunId(r.run.id);
                      toast.success('Research started', 'Watch the run console; results appear when places are retrieved.');
                    },
                    onError: (e) => toast.error('Could not start research', e),
                  })
                }
              >
                Start research
              </Button>
            </ActionPreview>
            <Button
              variant="primary"
              icon={<Save className="h-4 w-4" />}
              loading={saveState.isPending}
              onClick={() =>
                saveState.mutate(undefined, {
                  onSuccess: () =>
                    locked
                      ? toast.info('View kept for this visit', 'The read-only sample keeps its shared saved view; duplicate it to save your own.')
                      : toast.success('Map state saved', 'It is restored next time you open the explorer.'),
                  onError: (e) => toast.error('Could not save map state', e),
                })
              }
            >
              Save view
            </Button>
          </>
        }
      />

      {runs.isLoading ? (
        <Skeleton className="h-[560px] w-full" />
      ) : !runId ? (
        <EmptyState icon={<MapPinned className="h-5 w-5" />} title="No research yet" action={<Editable note><Button onClick={() => start.mutate(undefined)} loading={start.isPending}>Start research</Button></Editable>}>
          Start a research run to retrieve places and evidence for your candidate locations.
        </EmptyState>
      ) : (
        <>
          {/* status strip */}
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
            {run && <StatusPill status={run.status} />}
            <span className="chip">
              <b className="num text-fg" data-testid="places-total">{places.data?.total ?? '…'}</b> places listed
            </span>
            <span className="chip">
              <b className="num text-fg" data-testid="analytics-total">{analytics.data?.total_places ?? '…'}</b> in charts
            </span>
            {totalsAgree && (
              <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>
                Map, list and charts use the same filtered set
              </Badge>
            )}
            <span className="text-subtle">{places.data?.note}</span>
            {run && run.status !== 'completed' && run.status !== 'waiting_for_user' && (run.counts?.places ?? 0) === 0 && (
              <Badge tone="accent">Run in progress — places appear when retrieval finishes</Badge>
            )}
          </div>

          <div className={cn('grid gap-4', filtersOpen ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : 'lg:grid-cols-[44px_minmax(0,1fr)]')}>
            {/* filters */}
            <aside aria-label="Filters" className="lg:sticky lg:top-4 lg:self-start">
              {filtersOpen ? (
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="section-title flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" /> Filters
                    </p>
                    <button className="rounded-md p-1 text-muted hover:bg-surface2" onClick={() => setFiltersOpen(false)} aria-label="Collapse filters">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  </div>
                  <Field label="Area">
                    <Select value={areaId} onChange={(e) => (setAreaId(e.target.value), setSelected(null))}>
                      <option value="">All areas</option>
                      {assessments.map((a) => (
                        <option key={a.area_id} value={a.area_id}>
                          {a.area_name}
                          {!a.eligible ? ' (excluded)' : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <p className="label mt-4">Role</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={roles.includes(r)}
                        onClick={() => setRoles((x) => toggle(x, r))}
                        className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition', roles.includes(r) ? 'border-fg/30 bg-surface2 text-fg' : 'border-line text-muted hover:text-fg')}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: PLACE_ROLE_COLOR[r] }} />
                        {PLACE_ROLE_LABEL[r]}
                      </button>
                    ))}
                  </div>
                  <p className="label mt-4">Source</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Place source">
                    {(
                      [
                        ['all', `All · ${allItems.length}`],
                        ['qloo', `Qloo · ${provCounts.qloo}`],
                        ['osm', `OpenStreetMap · ${provCounts.osm}`],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={provider === k}
                        onClick={() => setProvider(k)}
                        className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition', provider === k ? 'border-fg/30 bg-surface2 text-fg' : 'border-line text-muted hover:text-fg')}
                      >
                        {k === 'qloo' && <span className="h-2 w-2 rounded-full bg-violet-600" />}
                        {l}
                      </button>
                    ))}
                  </div>
                  {provider !== 'all' && <p className="mt-1 text-[11px] text-subtle">Source filter applies to the map and list; charts cover all sources.</p>}
                  <p className="label mt-4">Category</p>
                  <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                    {categoryOptions.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={cats.includes(c)}
                        onClick={() => setCats((x) => toggle(x, c))}
                        className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition', cats.includes(c) ? 'border-fg/30 bg-surface2 text-fg' : 'border-line text-muted hover:text-fg')}
                      >
                        <span className="h-2 w-2 rounded-sm" style={{ background: categoryColor(c) }} />
                        {humanize(c)}
                      </button>
                    ))}
                    {categoryOptions.length === 0 && <span className="text-xs text-subtle">No categories retrieved</span>}
                  </div>
                  {(areaId || cats.length > 0 || roles.length > 0) && (
                    <button className="mt-3 text-xs font-medium text-accent-ink hover:underline" onClick={() => (setAreaId(''), setCats([]), setRoles([]))}>
                      Clear filters
                    </button>
                  )}
                  <div className="mt-5 border-t border-line pt-4">
                    <ActionPreview
                      tip={`Show relative taste affinity for the selected audience in ${assessments.find((a) => a.area_id === (areaId || assessments[0]?.area_id))?.area_name ?? 'the selected city'} (Qloo heatmap). It is a relative signal, not demand.`}
                      disabledReason={tasteQ.data && !tasteQ.data.available ? tasteQ.data.reason : undefined}
                    >
                      <Toggle checked={taste} onChange={setTaste} label={<span className="inline-flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-violet-600" /> View taste layer</span>} description="Provider affinity heatmap — never demand." />
                    </ActionPreview>
                    {taste && (
                      <div className="mt-3 space-y-2">
                        <Select aria-label="Audience for taste layer" value={tasteAud} onChange={(e) => setTasteAud(e.target.value)} className="h-9 py-1 text-xs">
                          {audiences.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </Select>
                        {tasteQ.isLoading && <Skeleton className="h-10 w-full" />}
                        {tasteQ.error && <ErrorState error={tasteQ.error} compact />}
                        {tasteQ.data && !tasteQ.data.available && (
                          <Callout tone="neutral" className="text-xs">
                            <b className="text-fg">Unavailable:</b> {tasteQ.data.reason}
                          </Callout>
                        )}
                        {tasteQ.data?.available && tasteQ.data.label && (
                          <div className="rounded-xl border border-violet-200 bg-violet-50 p-2.5 text-[11.5px] dark:border-violet-900 dark:bg-violet-950/40" data-testid="taste-legend">
                            <p className="font-semibold">Qloo taste heatmap · {tasteQ.data.points?.length ?? 0} grid points</p>
                            <div className="my-1.5 h-2 rounded-full bg-gradient-to-r from-violet-200 via-violet-500 to-violet-900" aria-hidden />
                            <div className="flex justify-between text-[10px] text-muted">
                              <span>lower affinity rank</span>
                              <span>higher</span>
                            </div>
                            <p className="mt-1.5 font-semibold text-violet-900 dark:text-violet-200">Relative within this query only — not demand.</p>
                            <p className="mt-1"><b>Entity type:</b> {tasteQ.data.label.entity_type}</p>
                            <p><b>Metric:</b> {tasteQ.data.label.metric}</p>
                            <p><b>Scale:</b> {tasteQ.data.label.scale}</p>
                            <p className="mt-1 text-bad">{tasteQ.data.label.not}</p>
                            {tasteQ.data.retrieved_at && <p className="mt-1 text-subtle">Retrieved {fmtDate(tasteQ.data.retrieved_at)}</p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-5 border-t border-line pt-4">
                    <p className="label">Legend</p>
                    <ul className="space-y-1 text-xs text-muted">
                      <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-dashed border-[#FF7A45]" /> Eligible, complete</li>
                      <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-dashed border-[#D99100]" /> Eligible, incomplete evidence</li>
                      <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-dashed border-[#E5484D]" /> Excluded by a hard constraint</li>
                      <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-dashed border-[#1F6FEB]" /> Your saved area</li>
                      <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-[3px] border-[#FFB020] bg-white" /> Shortlisted place</li>
                    </ul>
                  </div>
                </Card>
              ) : (
                <button
                  className="flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium shadow-card lg:h-11 lg:w-11 lg:px-0"
                  onClick={() => setFiltersOpen(true)}
                  aria-label="Expand filters"
                >
                  <SlidersHorizontal className="h-4 w-4 lg:hidden" />
                  <span className="lg:hidden">Filters{areaId || cats.length || roles.length ? ' (active)' : ''}</span>
                  <ChevronRight className="hidden h-4 w-4 lg:block" />
                </button>
              )}
            </aside>

            {/* workspace */}
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-surface2 p-1" role="group" aria-label="View">
                  {(
                    [
                      ['map', 'Map', MapIcon],
                      ['list', 'Table', List],
                    ] as const
                  ).map(([k, l, I]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={view === k}
                      onClick={() => setView(k)}
                      className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium', view === k ? 'bg-surface text-fg shadow-card' : 'text-muted')}
                    >
                      <I className="h-3.5 w-3.5" /> {l}
                    </button>
                  ))}
                </div>
                {!showTable && (
                  <>
                    <Button size="sm" variant="outline" icon={<Navigation className="h-3.5 w-3.5" />} onClick={() => mapRef.current?.fitAreas()}>
                      Fit areas
                    </Button>
                    <Editable>
                    <Button
                      size="sm"
                      variant={drawing ? 'brand' : 'outline'}
                      icon={<PenTool className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setDrawing((d) => !d);
                        setDrawPts([]);
                      }}
                    >
                      {drawing ? `Drawing… ${drawPts.length} pts` : 'Draw area'}
                    </Button>
                    </Editable>
                    {drawing && drawPts.length >= 3 && (
                      <Button size="sm" variant="primary" onClick={() => (setDrawing(false), setSaveOpen(true))}>
                        Finish polygon
                      </Button>
                    )}
                  </>
                )}
                <Editable>
                  <Button size="sm" variant="outline" icon={<BookmarkPlus className="h-3.5 w-3.5" />} onClick={() => (setDrawPts([]), setSaveOpen(true))}>
                    Save area (radius)
                  </Button>
                </Editable>
              </div>
              {drawing && <Callout tone="accent" className="text-xs">Click on the map to add polygon vertices (at least three), then “Finish polygon”. Coordinates are stored in EPSG:4326.</Callout>}
              {mapError && view === 'map' && (
                <Callout tone="warn" title="Map unavailable — table fallback">
                  {mapError}
                </Callout>
              )}

              <div className={cn('grid gap-4', !showTable && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
                {!showTable && (
                  <div className="relative overflow-hidden rounded-2xl border border-line bg-surface2 shadow-card">
                    {cfg?.mapStyleUrl ? (
                      <MapView
                        ref={mapRef}
                        styleUrl={cfg.mapStyleUrl}
                        places={items}
                        areas={mapAreas}
                        selectedId={selected}
                        shortlisted={shortlisted}
                        onSelect={setSelected}
                        onError={setMapError}
                        initial={saved.center ? { center: saved.center, zoom: saved.zoom } : undefined}
                        taste={taste ? tastePts : null}
                        drawing={drawing}
                        drawPoints={drawPts}
                        onDrawPoint={(p) => setDrawPts((x) => [...x, p])}
                        className="h-[440px] w-full sm:h-[600px]"
                      />
                    ) : (
                      <Skeleton className="h-[600px] w-full" />
                    )}
                    {places.isFetching && (
                      <span className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-medium text-muted shadow-card">Updating…</span>
                    )}
                  </div>
                )}

                {showTable ? (
                  <PlacesTable items={items} loading={places.isLoading} selected={selected} onSelect={setSelected} shortlisted={shortlisted} onShortlist={(p) => shortlist.mutate(p)} />
                ) : (
                  <Card className="flex max-h-[600px] min-h-[300px] flex-col overflow-hidden">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <p className="text-sm font-semibold">
                        <span className="num">{items.length}</span> of <span className="num">{places.data?.total ?? 0}</span> places{provider !== 'all' ? ` · ${provider === 'qloo' ? 'Qloo' : 'OSM'} only` : ''}
                      </p>
                      <span className="text-[11px] text-subtle">sorted by distance</span>
                    </div>
                    <AnimatePresence>
                      {sel && <PlaceDetail key={sel.id} p={sel} audName={audName} areaName={assessments.find((a) => a.area_id === sel.area_id)?.area_name} onClose={() => setSelected(null)} starred={shortlisted.has(sel.id)} onStar={() => shortlist.mutate(sel)} onWhy={run?.qloo_enabled ? () => setWhy(sel) : undefined} />}
                    </AnimatePresence>
                    <ul className="scroll-thin flex-1 overflow-y-auto p-2" aria-label="Places">
                      {places.isLoading &&
                        Array.from({ length: 6 }).map((_, i) => (
                          <li key={i} className="p-2">
                            <Skeleton className="h-14 w-full" />
                          </li>
                        ))}
                      {places.error && <ErrorState error={places.error} onRetry={() => places.refetch()} />}
                      {!places.isLoading && items.length === 0 && <EmptyState title="No places match these filters" className="m-2" />}
                      {items.slice(0, limit).map((p) => (
                        <li key={p.id} ref={(el) => (cardRefs.current[p.id] = el)}>
                          <button
                            type="button"
                            onClick={() => setSelected(p.id === selected ? null : p.id)}
                            aria-current={p.id === selected}
                            className={cn(
                              'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition',
                              p.id === selected ? 'bg-brand-soft/70 ring-1 ring-brand/40' : 'hover:bg-surface2',
                            )}
                          >
                            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: PLACE_ROLE_COLOR[p.role] ?? '#8A93A6' }} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13.5px] font-semibold">{p.name}</span>
                                {shortlisted.has(p.id) && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Shortlisted" />}
                                <ProviderBadge p={p} />
                              </span>
                              <span className="block truncate text-xs text-muted">
                                {PLACE_ROLE_LABEL[p.role] ?? p.role} · {humanize(p.category)}
                                {p.role_basis === 'inferred_category' ? ' · inferred' : ''}
                              </span>
                            </span>
                            <span className="num shrink-0 text-[11px] text-subtle">{p.distance_m != null ? `${(p.distance_m / 1000).toFixed(1)} km` : ''}</span>
                          </button>
                        </li>
                      ))}
                      {items.length > limit && (
                        <li className="p-2">
                          <Button size="sm" variant="ghost" className="w-full" onClick={() => setLimit((l) => l + 200)}>
                            Show more ({items.length - limit} remaining)
                          </Button>
                        </li>
                      )}
                    </ul>
                    <p className="border-t border-line px-4 py-2 text-[11px] text-subtle">{places.data?.attribution}</p>
                  </Card>
                )}
              </div>

              {/* locations + comparison tray */}
              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="section-title flex items-center gap-2">
                    <Layers className="h-4 w-4" /> Candidate locations
                  </p>
                  <span className="text-xs text-subtle">Add at least two to the comparison tray</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {assessments.map((a) => {
                    const inTray = tray.includes(a.area_id);
                    return (
                      <div key={a.id} className={cn('rounded-xl border p-3 transition', inTray ? 'border-brand bg-brand-soft/40' : 'border-line')}>
                        <div className="flex items-center justify-between gap-2">
                          <button className="truncate text-left text-sm font-semibold hover:underline" onClick={() => (setAreaId(a.area_id), a.center && mapRef.current?.flyTo(a.center.lon, a.center.lat, 11))}>
                            {a.area_name}
                          </button>
                          <StatusPill status={a.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {a.eligible ? `index ${a.planning_index?.toFixed(2) ?? '—'} of ${Math.round((a.available_weight ?? 0) * 100)}% weight` : a.hard_constraints.filter((h) => h.result === 'fail').map((h) => h.reason).join('; ')}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <EvidenceChip ids={a.evidence_ids} title={`${a.area_name} evidence`} />
                          <button
                            className={cn('rounded-lg px-2 py-1 text-xs font-semibold', inTray ? 'text-brand-ink' : 'text-muted hover:bg-surface2 hover:text-fg')}
                            onClick={() => setTray((t) => (inTray ? t.filter((x) => x !== a.area_id) : [...t, a.area_id].slice(-8)))}
                            aria-pressed={inTray}
                          >
                            {inTray ? '✓ In tray' : '+ Compare'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {projectAreas
                    .filter((x) => x.kind === 'saved')
                    .map((x) => (
                      <div key={x.id} className="rounded-xl border border-dashed border-accent/40 p-3">
                        <p className="truncate text-sm font-semibold">{x.name}</p>
                        <p className="text-xs text-muted">
                          Saved area · {x.source} · {x.shortlisted_place_ids.length} shortlisted
                        </p>
                      </div>
                    ))}
                </div>
              </Card>
            </div>
          </div>

          {/* charts */}
          <div className="mt-8">
            <h2 className="mb-3 font-display text-xl font-bold">Analysis for the current filter</h2>
            {analytics.error && <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />}
            {analytics.isLoading && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Skeleton className="h-72" />
                <Skeleton className="h-72" />
              </div>
            )}
            {analytics.data && (
              <div className="grid gap-4 lg:grid-cols-2">
                <CategoryDistribution a={analytics.data} />
                <Competitors a={analytics.data} />
                <div className="lg:col-span-2">
                  <EvidenceCoverage a={analytics.data} />
                </div>
                <div className="lg:col-span-2">
                  <FeatureRelevance a={analytics.data} />
                </div>
                <div className="lg:col-span-2">
                  <TasteProfile a={analytics.data} qlooConfigured={providers?.qloo.configured} />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* tray */}
      <AnimatePresence>
        {tray.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-20 left-1/2 z-40 flex w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur-xl"
            role="region"
            aria-label="Comparison tray"
          >
            <Scale className="h-5 w-5 shrink-0 text-brand-ink" />
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {tray.map((id) => (
                <Badge key={id} tone="brand">
                  {assessments.find((a) => a.area_id === id)?.area_name ?? id.slice(0, 6)}
                  <button className="ml-1" onClick={() => setTray((t) => t.filter((x) => x !== id))} aria-label="Remove from tray">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Button size="sm" variant="brand" disabled={tray.length < 2} onClick={() => nav(`/projects/${pid}/compare?run=${runId}&areas=${tray.join(',')}`)}>
              Compare {tray.length}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <SaveAreaModal
        open={saveOpen}
        onClose={() => (setSaveOpen(false), setDrawPts([]))}
        polygon={drawPts.length >= 3 ? drawPts : null}
        center={mapRef.current?.getView()?.center ?? (sel ? [sel.lon, sel.lat] : undefined)}
        shortlistIds={Array.from(shortlisted).filter((id) => items.some((p) => p.id === id))}
      />
      <WhyThisPlace place={why} runId={runId} areaName={assessments.find((a) => a.area_id === why?.area_id)?.area_name} onClose={() => setWhy(null)} />
    </PageWrap>
  );
}

function ProviderBadge({ p }: { p: Place }) {
  return p.provider === 'qloo' ? (
    <Badge tone="violet" className="shrink-0 !py-0 !text-[10px]">Qloo</Badge>
  ) : (
    <Badge tone="neutral" className="shrink-0 !py-0 !text-[10px]">OSM</Badge>
  );
}

function PlaceDetail({ p, areaName, onClose, starred, onStar, audName, onWhy }: { p: Place; areaName?: string; onClose: () => void; starred: boolean; onStar: () => void; audName: Record<string, string>; onWhy?: () => void }) {
  const osm = p.provider_id?.match(/^(node|way|relation)\/(\d+)$/);
  const md = (p.metadata ?? {}) as { qloo_affinity_by_audience?: Record<string, number | null>; qloo_popularity?: number; business_rating?: number; source_note?: string };
  const aff = Object.entries(md.qloo_affinity_by_audience ?? {});
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-line bg-surface2/50">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-display text-[15px] font-bold leading-snug">
              {p.name} <ProviderBadge p={p} />
            </p>
            <p className="text-xs text-muted">
              <span style={{ color: PLACE_ROLE_COLOR[p.role] }} className="font-semibold">{PLACE_ROLE_LABEL[p.role] ?? p.role}</span> · {humanize(p.category)} ·{' '}
              {p.role_basis === 'confirmed' ? 'confirmed' : 'inferred from category tags'}
            </p>
          </div>
          <button className="rounded-md p-1 text-subtle hover:bg-surface hover:text-fg" onClick={onClose} aria-label="Close place detail">
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-subtle">Area</dt>
          <dd>{areaName ?? '—'}</dd>
          <dt className="text-subtle">Distance</dt>
          <dd className="num">{p.distance_m != null ? `${(p.distance_m / 1000).toFixed(2)} km from centre` : 'Unknown'}</dd>
          <dt className="text-subtle">Address</dt>
          <dd>{p.address || 'Not in source'}</dd>
          <dt className="text-subtle">Accessibility</dt>
          <dd>{p.accessibility === 'unknown' ? 'Unknown (not verified)' : humanize(p.accessibility)}</dd>
          <dt className="text-subtle">Source</dt>
          <dd>
            {osm ? (
              <a className="link inline-flex items-center gap-1" href={`https://www.openstreetmap.org/${osm[1]}/${osm[2]}`} target="_blank" rel="noreferrer noopener">
                {p.provider} {p.provider_id} <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              `${p.provider} ${p.provider_id}`
            )}
          </dd>
          <dt className="text-subtle">Retrieved</dt>
          <dd>{fmtDate(p.retrieved_at)}</dd>
        </dl>
        {p.provider === 'qloo' && (
          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/70 p-2.5 text-xs dark:border-violet-900 dark:bg-violet-950/40" data-testid="qloo-affinity">
            <p className="font-semibold text-violet-900 dark:text-violet-200">Qloo affinity by audience</p>
            {aff.length === 0 ? (
              <p className="text-muted">No audience affinity returned.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {aff.map(([id, v]) => (
                  <li key={id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{audName[id] ?? `Audience ${id.slice(0, 6)}`}</span>
                    {v == null ? (
                      <span className="text-subtle">unknown</span>
                    ) : (
                      <>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900">
                          <span className="block h-full rounded-full bg-violet-600" style={{ width: `${Math.round(v * 100)}%` }} />
                        </span>
                        <b className="num w-9 text-right">{v.toFixed(2)}</b>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-muted">
              {md.qloo_popularity != null && <>Popularity {md.qloo_popularity.toFixed(2)} · </>}
              {md.business_rating != null && <>Rating {md.business_rating.toFixed(1)} · </>}
              Relative taste affinity — not demand, footfall or willingness to partner.
            </p>
          </div>
        )}
        <p className="mt-2 rounded-lg bg-warn-soft/60 px-2.5 py-1.5 text-[11.5px] text-fg">Retrieved set, not a census: absence from this list does not mean absence on the ground. A place record is not an ad slot.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {p.provider === 'qloo' && onWhy && (
            <Button size="sm" variant="brand" icon={<Network className="h-3.5 w-3.5" />} onClick={onWhy}>
              Why this place?
            </Button>
          )}
          <Editable>
            <Button size="sm" variant={starred ? 'secondary' : 'outline'} icon={<Star className={cn('h-3.5 w-3.5', starred && 'fill-amber-400 text-amber-500')} />} onClick={onStar}>
              {starred ? 'Shortlisted' : 'Shortlist'}
            </Button>
          </Editable>
          {p.evidence_id && <EvidenceChip ids={[p.evidence_id]} title={`Evidence for ${p.name}`} className="!py-1.5" label="Evidence" />}
        </div>
      </div>
    </motion.div>
  );
}

function PlacesTable({
  items,
  loading,
  selected,
  onSelect,
  shortlisted,
  onShortlist,
}: {
  items: Place[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  shortlisted: Set<string>;
  onShortlist: (p: Place) => void;
}) {
  const [limit, setLimit] = useState(150);
  return (
    <Card className="overflow-hidden" data-testid="places-table">
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <div className="max-h-[640px] overflow-auto scroll-thin">
          <Table caption="Retrieved places">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Category</Th>
                <Th className="text-right">Distance</Th>
                <Th>Address</Th>
                <Th>Source · retrieved</Th>
                <Th>Shortlist</Th>
                <Th>Evidence</Th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, limit).map((p) => (
                <tr key={p.id} className={cn('cursor-pointer', p.id === selected ? 'bg-brand-soft/50' : 'hover:bg-surface2/60')} onClick={() => onSelect(p.id)}>
                  <Td className="font-semibold">{p.name}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: PLACE_ROLE_COLOR[p.role] }} />
                      {PLACE_ROLE_LABEL[p.role] ?? p.role}
                      {p.role_basis === 'inferred_category' && <span className="text-subtle">(inferred)</span>}
                    </span>
                  </Td>
                  <Td className="text-xs">{humanize(p.category)}</Td>
                  <Td className="num text-right text-xs">{p.distance_m != null ? `${(p.distance_m / 1000).toFixed(1)} km` : '—'}</Td>
                  <Td className="max-w-[200px] truncate text-xs text-muted">{p.address || '—'}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <ProviderBadge p={p} /> {fmtDate(p.retrieved_at, false)}
                    </span>
                  </Td>
                  <Td>
                    <button
                      onClick={(e) => (e.stopPropagation(), onShortlist(p))}
                      aria-label={shortlisted.has(p.id) ? `Remove ${p.name} from shortlist` : `Shortlist ${p.name}`}
                      className="rounded p-1 hover:bg-surface2"
                    >
                      <Star className={cn('h-4 w-4', shortlisted.has(p.id) ? 'fill-amber-400 text-amber-500' : 'text-subtle')} />
                    </button>
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>{p.evidence_id && <EvidenceChip ids={[p.evidence_id]} title={p.name} label="View" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {items.length > limit && (
            <div className="p-3">
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setLimit((l) => l + 300)}>
                Show more ({items.length - limit})
              </Button>
            </div>
          )}
          {items.length === 0 && <EmptyState title="No places match these filters" className="m-4" />}
        </div>
      )}
    </Card>
  );
}

function SaveAreaModal({
  open,
  onClose,
  polygon,
  center,
  shortlistIds,
}: {
  open: boolean;
  onClose: () => void;
  polygon: [number, number][] | null;
  center?: [number, number];
  shortlistIds: string[];
}) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [name, setName] = useState('');
  const [radius, setRadius] = useState('3');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  useEffect(() => {
    if (open && center) {
      setLon(String(center[0]));
      setLat(String(center[1]));
    }
  }, [open, center]);
  const save = useApiMutation(
    () =>
      mutations.saveArea(
        pid,
        polygon
          ? { name, polygon, shortlisted_place_ids: shortlistIds }
          : { name, lat: Number(lat), lon: Number(lon), radius_km: Number(radius), shortlisted_place_ids: shortlistIds },
      ),
    [['areas', pid]],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={polygon ? 'Save drawn area' : 'Save area by radius'}
      description="Saved areas appear on the map and can carry a shortlist of places."
      icon={<BookmarkPlus className="h-4 w-4" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!name.trim() || (!polygon && (!lat || !lon || !radius))}
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.success('Area saved');
                  setName('');
                  onClose();
                },
                onError: (e) => toast.error('Could not save area', e),
              })
            }
          >
            Save area
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salt Lake demo cluster" />
        </Field>
        {polygon ? (
          <p className="text-sm text-muted">{polygon.length} vertices (EPSG:4326). The backend validates the polygon.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Latitude">
              <Input type="number" value={lat} onChange={(e) => setLat(e.target.value)} />
            </Field>
            <Field label="Longitude">
              <Input type="number" value={lon} onChange={(e) => setLon(e.target.value)} />
            </Field>
            <Field label="Radius (km)">
              <Input type="number" min={0.1} max={200} value={radius} onChange={(e) => setRadius(e.target.value)} />
            </Field>
          </div>
        )}
        <p className="text-xs text-subtle">
          Includes {shortlistIds.length} shortlisted place{shortlistIds.length === 1 ? '' : 's'} from the current view. Centre defaults to the current map centre.
        </p>
      </div>
    </Modal>
  );
}
