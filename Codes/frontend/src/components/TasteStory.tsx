/**
 * Feature A — the taste story:
 *   your interests → Qloo recommendations → shortlisted placement → campaign hypothesis → creative preview
 *
 * Rules this view keeps:
 *  - every edge is typed; provider edges open their evidence in the Evidence drawer
 *  - per-input attribution is drawn only when Qloo provided it (qloo_explainability)
 *  - a combined interest set gets ONE bracket, "recommended for this combined interest set", and no per-interest weights
 *  - generated nodes/edges are dashed, labelled "Generated hypothesis" and carry the note; they never look like Qloo facts
 *  - hover/focus only highlights; nothing is fetched or changed on hover
 *  - a list layout is used on narrow screens and can be chosen by anyone (keyboard/screen-reader friendly)
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Brain, CircleHelp, FileSearch, Fingerprint, GitBranch, LayoutList, Lightbulb, MapPin, Network, Sparkles, Store, Target } from 'lucide-react';
import { ApiError } from '../api/client';
import { useTasteStory } from '../api/hooks';
import type { CitySignal, EdgeKind, StoryEdge, StoryRecommendation, TasteStory as Story } from '../api/types';
import { cn, fmtDate, humanize } from '../lib/format';
import { LANG_LABEL } from '../lib/labels';
import { useEvidenceDrawer } from './Evidence';
import { InteractiveMedia } from './InteractiveMedia';
import { Badge, EmptyState, ErrorState, Skeleton, Tooltip } from './ui';

const MAX_INTERESTS = 3;

export const EDGE_STYLE: Record<EdgeKind, { stroke: string; dash?: string; label: string }> = {
  qloo_explainability: { stroke: 'rgb(var(--secondary))', label: 'Qloo attribution' },
  qloo_combined_set: { stroke: 'rgb(var(--secondary))', label: 'Qloo · combined interest set' },
  app_derived: { stroke: 'rgb(var(--muted) / 0.75)', label: 'Computed by LaunchLens' },
  generated_hypothesis: { stroke: '#8B5CF6', dash: '6 5', label: 'Generated hypothesis' },
};

/* ------------------------------------------------------------------ small parts */
export function GeneratedBadge({ className }: { className?: string }) {
  return (
    <Tooltip content="Proposed by a language model from the cited evidence — a campaign hypothesis, not a Qloo fact or a result.">
      <span
        tabIndex={0}
        data-testid="generated-badge"
        className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-violet-400 bg-violet-50 px-2 py-[2px] text-[10.5px] font-semibold text-violet-800 dark:bg-violet-950/50 dark:text-violet-200', className)}
      >
        <Lightbulb className="h-3 w-3" aria-hidden /> Generated hypothesis
      </span>
    </Tooltip>
  );
}

function QlooBadge() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-accent/30 bg-accent-soft px-2 py-[2px] text-[10.5px] font-semibold text-accent-ink">
      <Fingerprint className="h-3 w-3" aria-hidden /> Qloo
    </span>
  );
}

function AppBadge() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface2 px-2 py-[2px] text-[10.5px] font-semibold text-muted">
      <Brain className="h-3 w-3" aria-hidden /> Computed
    </span>
  );
}

export function CitySignalChip({ s, city }: { s: CitySignal; city?: string | null }) {
  const { open } = useEvidenceDrawer();
  const ev = s.evidence_id;
  const body =
    s.state === 'available' && s.lift != null ? (
      <>
        Taste lift in {city ?? 'this city'}: <b className="num font-display text-[15px]">{s.lift.toFixed(1)}×</b>
      </>
    ) : s.state === 'sparse' ? (
      <>
        Taste lift in {city ?? 'this city'}: <Badge tone="warn">sparse</Badge> <span className="text-muted">too few baseline places to score</span>
      </>
    ) : (
      <span className="text-muted">Taste lift in {city ?? 'this city'}: unknown — {s.reason ?? 'not recorded'}</span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-[13px]" data-testid="city-signal">
      <MapPin className="h-3.5 w-3.5 text-accent-ink" aria-hidden />
      <span>{body}</span>
      {s.state === 'available' && s.n_signal != null && (
        <Tooltip content={<>{s.meaning} Based on {s.n_signal} recommended vs {s.n_baseline} baseline places. A relative signal, not demand.</>}>
          <span tabIndex={0} className="cursor-help text-[11.5px] text-subtle underline decoration-dotted underline-offset-2">
            {s.n_signal} vs {s.n_baseline} places
          </span>
        </Tooltip>
      )}
      {ev && (
        <button type="button" onClick={() => open([ev], `City taste lift · ${city ?? ''}`)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-ink hover:underline" aria-label="Evidence for the city taste lift">
          <FileSearch className="h-3 w-3" /> evidence
        </button>
      )}
    </span>
  );
}

function EdgeLegend({ story }: { story: Story }) {
  const kinds = Array.from(new Set(story.edges.map((e) => e.kind)));
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted" aria-label="Edge legend">
      {kinds.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden>
            <line x1="1" y1="4" x2="25" y2="4" stroke={EDGE_STYLE[k].stroke} strokeWidth="2.5" strokeDasharray={EDGE_STYLE[k].dash} strokeLinecap="round" />
          </svg>
          <span>{story.legend[k] ?? EDGE_STYLE[k].label}</span>
        </li>
      ))}
    </ul>
  );
}

const placeKey = (id: string) => `place:${id}`;

/* ------------------------------------------------------------------ data wrapper */
export function TasteStory({
  runId,
  areaId,
  audienceId,
  focusPlaceId,
  forceList,
}: {
  runId?: string;
  areaId?: string;
  audienceId?: string;
  focusPlaceId?: string;
  forceList?: boolean;
}) {
  const q = useTasteStory(runId, areaId, audienceId, focusPlaceId);
  if (!runId || !areaId || !audienceId) return <EmptyState icon={<Network className="h-5 w-5" />} title="Choose an audience and a city">The taste story follows one audience in one city.</EmptyState>;
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (q.error) {
    const e = q.error;
    if (e instanceof ApiError && e.code === 'audience_not_in_run')
      return <EmptyState icon={<CircleHelp className="h-5 w-5" />} title="This audience is not part of the selected research run">The audience was added or changed after the run. A new research run includes it.</EmptyState>;
    return <ErrorState error={e} onRetry={() => q.refetch()} />;
  }
  return q.data ? <TasteStoryView story={q.data} focusPlaceId={focusPlaceId} forceList={forceList} /> : null;
}

/* ------------------------------------------------------------------ view */
export function TasteStoryView({ story, focusPlaceId, forceList }: { story: Story; focusPlaceId?: string; forceList?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [mode, setMode] = useState<'auto' | 'diagram' | 'list'>('auto');
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 1000));
    ro.observe(el);
    setWide(el.clientWidth >= 1000);
    return () => ro.disconnect();
  }, []);
  const layout = forceList ? 'list' : mode === 'auto' ? (wide ? 'diagram' : 'list') : mode;

  const recs = story.recommendations;
  const defaultSel = focusPlaceId && recs.some((r) => r.id === focusPlaceId) ? focusPlaceId : story.placement?.place_id && recs.some((r) => r.id === story.placement!.place_id) ? story.placement.place_id : recs[0]?.id;
  const [selected, setSelected] = useState<string | undefined>(defaultSel);
  useEffect(() => setSelected(defaultSel), [defaultSel]);
  const sel = recs.find((r) => r.id === selected);

  if (story.state === 'no_signals' || story.state === 'no_recommendations' || story.state === 'qloo_disabled')
    return (
      <div className="space-y-3" data-testid="taste-story" data-state={story.state}>
        <EmptyState icon={<Network className="h-5 w-5" />} title={story.state === 'qloo_disabled' ? 'No taste story for this run' : story.state === 'no_signals' ? 'No taste signals for this audience yet' : 'Qloo returned no matching places'}>
          {story.message}
        </EmptyState>
        {story.state !== 'qloo_disabled' && <CitySignalChip s={story.city_signal} city={story.area.name} />}
      </div>
    );

  return (
    <div ref={wrap} className="min-w-0 space-y-4" data-testid="taste-story" data-state={story.state} data-attribution={story.attribution ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        <CitySignalChip s={story.city_signal} city={story.area.name} />
        <Badge tone={story.attribution === 'per_input' ? 'accent' : 'neutral'} icon={<GitBranch className="h-3 w-3" />}>
          {story.attribution === 'per_input' ? 'Qloo explained which input drove each place' : 'Qloo gave no per-input explanation'}
        </Badge>
        {!forceList && (
          <div className="ml-auto inline-flex rounded-xl border border-line bg-surface2/60 p-0.5" role="radiogroup" aria-label="Layout">
            {(['diagram', 'list'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={layout === m}
                onClick={() => setMode(m)}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition [@media(pointer:coarse)]:h-11', layout === m ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}
              >
                {m === 'diagram' ? <Network className="h-3.5 w-3.5" /> : <LayoutList className="h-3.5 w-3.5" />}
                {m === 'diagram' ? 'Diagram' : 'List'}
              </button>
            ))}
          </div>
        )}
      </div>
      {story.warnings.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-surface2/70 px-3 py-2 text-[12.5px] text-muted">
          <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{story.warnings.join(' ')}</span>
        </p>
      )}
      {story.state === 'partial' && (
        <p className="text-[12.5px] text-muted">Partial story: {!story.placement ? 'no placement was derived from these places yet' : 'no campaign hypothesis has been written for this audience and city yet'}.</p>
      )}
      {layout === 'diagram' ? <Diagram story={story} selected={selected} onSelect={setSelected} /> : <ListLayout story={story} selected={selected} onSelect={setSelected} />}
      <EdgeLegend story={story} />
      {sel && <PlaceExplain story={story} r={sel} />}
      {story.unknown_evidence_ids.length > 0 && (
        <p className="text-[11.5px] text-warn">{story.unknown_evidence_ids.length} cited evidence id(s) could not be found and are treated as unsupported.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ diagram */
type Seg = { id: string; edge: StoryEdge; d: string; mx: number; my: number; tx: number; ty: number };

function useEdgeGeometry(container: React.RefObject<HTMLDivElement>, edges: StoryEdge[], deps: unknown[]) {
  const [segs, setSegs] = useState<Seg[]>([]);
  const [bracket, setBracket] = useState<{ d: string; lx: number; ly: number; top: number; bottom: number; x: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const measure = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const R = root.getBoundingClientRect();
    const box = (id: string) => {
      const el = root.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left - R.left, r: r.right - R.left, t: r.top - R.top, b: r.bottom - R.top, my: r.top - R.top + r.height / 2 };
    };
    const out: Seg[] = [];
    edges.forEach((e, i) => {
      if (e.kind === 'qloo_combined_set') return; // drawn once as a bracket
      const a = box(e.from);
      const b = box(e.to);
      if (!a || !b) return;
      const x1 = a.r;
      const y1 = a.my;
      const x2 = b.l;
      const y2 = b.my;
      const dx = Math.max(24, (x2 - x1) / 2);
      out.push({ id: `${e.from}->${e.to}-${i}`, edge: e, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, tx: x2, ty: y2 });
    });
    setSegs(out);
    const combined = edges.filter((e) => e.kind === 'qloo_combined_set');
    const set = box('interest_set');
    const targets = combined.map((e) => box(e.to)).filter(Boolean) as NonNullable<ReturnType<typeof box>>[];
    if (set && targets.length) {
      const top = Math.min(...targets.map((t) => t.t)) + 6;
      const bottom = Math.max(...targets.map((t) => t.b)) - 6;
      const x = Math.min(...targets.map((t) => t.l)) - 14;
      const mid = (top + bottom) / 2;
      const x1 = set.r;
      const y1 = set.my;
      const dx = Math.max(20, (x - x1) / 2);
      // one connector from the interest set to ONE bracket spanning every recommended place
      const d = `M${x1},${y1} C${x1 + dx},${y1} ${x - dx},${mid} ${x - 8},${mid} L${x},${mid} M${x + 8},${top} Q${x},${top} ${x},${top + 10} L${x},${bottom - 10} Q${x},${bottom} ${x + 8},${bottom}`;
      setBracket({ d, lx: (x1 + x) / 2, ly: (y1 + mid) / 2, top, bottom, x });
    } else setBracket(null);
    setSize({ w: R.width, h: R.height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges]);
  useLayoutEffect(() => {
    measure();
    const root = container.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    root.querySelectorAll('[data-node]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);
  return { segs, bracket, size };
}

function Diagram({ story, selected, onSelect }: { story: Story; selected?: string; onSelect: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { open } = useEvidenceDrawer();
  const [allInterests, setAllInterests] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const combined = story.attribution !== 'per_input';
  const signals = story.interests.filter((i) => i.used_as_signal);
  const others = story.interests.filter((i) => !i.used_as_signal);
  const ordered = [...signals, ...others];
  const shownInterests = allInterests ? ordered : ordered.slice(0, MAX_INTERESTS);
  const { segs, bracket, size } = useEdgeGeometry(root, story.edges, [allInterests, story]);

  // hover/focus an interest → the places Qloo attributed to it
  const lit = useMemo(() => {
    if (!hover) return null;
    if (hover === 'interest_set') return new Set(story.recommendations.map((r) => placeKey(r.id)));
    return new Set(story.edges.filter((e) => e.kind === 'qloo_explainability' && e.from === hover).map((e) => e.to));
  }, [hover, story]);
  const name = (id: string) => {
    if (id.startsWith('interest:')) return story.interests.find((i) => `interest:${i.id}` === id)?.label ?? 'interest';
    if (id === 'interest_set') return 'the combined interest set';
    if (id.startsWith('place:')) return story.recommendations.find((r) => placeKey(r.id) === id)?.name ?? 'place';
    if (id.startsWith('placement:')) return story.placement?.name ?? 'placement';
    if (id.startsWith('strategy:')) return 'the campaign hypothesis';
    if (id.startsWith('brief:')) return 'the creative';
    return id;
  };
  const combinedEv = Array.from(new Set(story.edges.filter((e) => e.kind === 'qloo_combined_set').flatMap((e) => e.evidence_ids)));

  const interestNode = (i: Story['interests'][number]) => {
    const nid = i.id ? `interest:${i.id}` : `interest-row:${i.entity_row_id ?? i.label}`;
    const attributed = story.edges.some((e) => e.kind === 'qloo_explainability' && e.from === nid);
    return (
      <li key={nid}>
        <button
          type="button"
          data-node={combined ? undefined : nid}
          onMouseEnter={() => setHover(nid)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(nid)}
          onBlur={() => setHover(null)}
          aria-describedby={combined ? 'ts-combined-note' : undefined}
          className={cn(
            'w-full rounded-xl border px-3 py-2 text-left transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            i.used_as_signal ? 'border-line bg-surface hover:border-accent/50' : 'border-dashed border-line bg-surface2/50 text-muted',
            hover === nid && 'border-accent shadow-[0_0_0_3px_rgb(var(--secondary)/0.18)]',
          )}
        >
          <span className="block text-[13px] font-semibold leading-snug">{i.label}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-subtle">
            {i.status === 'proxy' ? <Badge tone="violet">proxy for “{i.proxy_for}”</Badge> : <span>{humanize(i.status)}</span>}
            <span>· {i.is_tag ? 'tag' : 'entity'}</span>
            {!i.used_as_signal && <span>· not used as a signal</span>}
            {!combined && i.used_as_signal && <span>· {attributed ? 'attributed' : 'no attributed place shown'}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="scroll-thin overflow-x-auto">
      <div ref={root} className="relative min-w-[1000px] pb-2" data-testid="taste-diagram">
        {/* edges */}
        <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
          {segs.map((s, i) => {
            const st = EDGE_STYLE[s.edge.kind];
            const dim = lit && !(s.edge.kind === 'qloo_explainability' && lit.has(s.edge.to) && s.edge.from === hover);
            return (
              <motion.path
                key={s.id}
                d={s.d}
                fill="none"
                stroke={st.stroke}
                strokeWidth={s.edge.kind === 'qloo_explainability' && !dim && lit ? 3 : 2}
                strokeDasharray={st.dash}
                strokeLinecap="round"
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: dim ? 0.18 : 0.9 }}
                transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.05 * i }}
              />
            );
          })}
          {bracket && (
            <motion.path
              d={bracket.d}
              fill="none"
              stroke={EDGE_STYLE.qloo_combined_set.stroke}
              strokeWidth={hover === 'interest_set' ? 3 : 2}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ duration: reduce ? 0 : 0.8 }}
              data-testid="combined-bracket"
            />
          )}
        </svg>
        {/* edge evidence buttons (provider and computed edges) */}
        {segs
          .filter((s) => s.edge.kind !== 'generated_hypothesis' || s.edge.evidence_ids.length > 0)
          .map((s) => {
            const qloo = s.edge.kind === 'qloo_explainability';
            const x = qloo ? s.tx - 22 : s.mx;
            const y = qloo ? s.ty : s.my;
            return (
              <EdgeButton
                key={`b-${s.id}`}
                x={x}
                y={y}
                kind={s.edge.kind}
                disabled={!s.edge.evidence_ids.length}
                label={`${EDGE_STYLE[s.edge.kind].label}: ${name(s.edge.from)} → ${name(s.edge.to)}${s.edge.score != null ? ` (score ${s.edge.score.toFixed(2)})` : ''}`}
                onClick={() => open(s.edge.evidence_ids, `${name(s.edge.from)} → ${name(s.edge.to)}`)}
              />
            );
          })}

        <div className="relative grid grid-cols-[minmax(170px,0.9fr)_minmax(210px,1.15fr)_minmax(160px,0.95fr)_minmax(170px,1fr)_minmax(130px,0.8fr)] gap-x-10">
          <ColHead icon={<Fingerprint className="h-3.5 w-3.5" />} title="Your interests" sub="Resolved to Qloo" />
          <ColHead icon={<Sparkles className="h-3.5 w-3.5" />} title="Qloo recommendations" sub={`Top ${story.recommendations.length} places for this audience`} />
          <ColHead icon={<Store className="h-3.5 w-3.5" />} title="Placement" sub="Practical fit + taste" />
          <ColHead icon={<Target className="h-3.5 w-3.5" />} title="Campaign hypothesis" sub="Generated" generated />
          <ColHead icon={<Lightbulb className="h-3.5 w-3.5" />} title="Creative preview" sub="Generated" generated />

          {/* interests */}
          <div className="self-center">
            {combined ? (
              <div
                data-node="interest_set"
                onMouseEnter={() => setHover('interest_set')}
                onMouseLeave={() => setHover(null)}
                className={cn('rounded-2xl border-2 border-accent/30 bg-accent-soft/30 p-2 transition', hover === 'interest_set' && 'border-accent')}
              >
                <p className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-accent-ink">Interest set</p>
                <ul className="space-y-1.5">{shownInterests.map(interestNode)}</ul>
                <p id="ts-combined-note" className="px-1 pt-1.5 text-[10.5px] leading-snug text-muted">
                  Qloo scored places for the set as a whole — no per-interest weights exist.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">{shownInterests.map(interestNode)}</ul>
            )}
            {ordered.length > MAX_INTERESTS && (
              <button type="button" className="mt-2 text-xs font-semibold text-accent-ink hover:underline" onClick={() => setAllInterests((v) => !v)} aria-expanded={allInterests}>
                {allInterests ? 'Show fewer' : `Show ${ordered.length - MAX_INTERESTS} more`}
              </button>
            )}
          </div>

          {/* places */}
          <div className="self-center">
          {combined && (
            <button
              type="button"
              onClick={() => open(combinedEv, 'Qloo · recommended for this combined interest set')}
              className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-surface px-2.5 py-1 text-[11px] font-semibold text-accent-ink shadow-card transition hover:border-accent hover:shadow-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="combined-edge"
              aria-label="Evidence: Qloo recommended these places for this combined interest set"
            >
              <FileSearch className="h-3 w-3" aria-hidden />
              recommended for this combined interest set
            </button>
          )}
          <ul className="space-y-2" aria-label="Qloo recommendations">
            {story.recommendations.map((r) => {
              const k = placeKey(r.id);
              const isLit = lit?.has(k);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    data-node={k}
                    onClick={() => onSelect(r.id)}
                    aria-pressed={selected === r.id}
                    className={cn(
                      'w-full rounded-xl border bg-surface px-3 py-2 text-left transition-[opacity,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      selected === r.id ? 'border-accent shadow-[0_0_0_3px_rgb(var(--secondary)/0.2)]' : 'border-line hover:border-accent/50',
                      lit && !isLit && 'opacity-40',
                      isLit && 'border-accent shadow-[0_0_0_3px_rgb(var(--secondary)/0.25)]',
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{r.name}</span>
                      <span className="num shrink-0 text-[11px] font-bold text-accent-ink">#{r.affinity_rank}</span>
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-subtle">
                      {humanize(r.category)} · rank {r.affinity_rank} of {r.of}
                      {story.placement?.place_id === r.id && ' · placement'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          </div>

          {/* placement */}
          <div className="self-center">
            {story.placement ? (
              <div data-node={`placement:${story.placement.id}`} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AppBadge />
                  <Badge tone={story.placement.shortlisted ? 'ok' : 'neutral'}>{story.placement.shortlisted ? 'Shortlisted' : 'Top candidate'}</Badge>
                </div>
                <p className="mt-1.5 text-[13.5px] font-semibold leading-snug">{story.placement.name}</p>
                <p className="text-[11px] text-subtle">
                  {humanize(story.placement.category)} · suitability {story.placement.suitability != null ? story.placement.suitability.toFixed(2) : 'unknown'}
                </p>
                <p className="mt-1 text-[11px] text-warn">{humanize(story.placement.status)}</p>
              </div>
            ) : (
              <EmptyNode text="No placement derived from these places yet." />
            )}
          </div>

          {/* hypothesis */}
          <div className="self-center">
            {story.hypothesis ? (
              <div data-node={`strategy:${story.hypothesis.strategy_id}`} className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/40 p-3 dark:border-violet-800 dark:bg-violet-950/20" data-generated="true">
                <GeneratedBadge />
                <p className="mt-1.5 text-[13px] font-semibold leading-snug">{story.hypothesis.message ?? story.hypothesis.positioning}</p>
                {story.hypothesis.main_feature_key && <p className="mt-0.5 text-[11px] text-subtle">Leads with: {humanize(story.hypothesis.main_feature_key)}</p>}
                <p className="mt-1.5 text-[10.5px] leading-snug text-muted">{story.hypothesis.note}</p>
              </div>
            ) : (
              <EmptyNode text="No campaign hypothesis for this audience and city yet." />
            )}
          </div>

          {/* creative */}
          <div className="self-center">
            {story.creative ? (
              <div data-node={`brief:${story.creative.brief_id}`} className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/40 p-2.5 dark:border-violet-800 dark:bg-violet-950/20" data-generated="true">
                <GeneratedBadge className="whitespace-normal" />
                {story.creative.preview_url && (
                  <InteractiveMedia
                    className="mt-2"
                    aspect="aspect-[4/5]"
                    items={[{ src: story.creative.preview_url, alt: `Creative preview · ${story.creative.headline ?? ''}`, meta: 'Generated by LaunchLens · a campaign hypothesis, not a result' }]}
                    showCaption={false}
                    badge={story.creative.preview_stale ? <Badge tone="warn">Stale</Badge> : undefined}
                  />
                )}
                <p lang={story.creative.language} className="mt-1.5 line-clamp-3 text-[12px] font-semibold leading-snug">
                  {story.creative.headline}
                </p>
                <p className="text-[10.5px] text-subtle">{LANG_LABEL[story.creative.language] ?? story.creative.language}</p>
              </div>
            ) : (
              <EmptyNode text="No creative written from this hypothesis yet." />
            )}
          </div>
        </div>
        {story.creative?.decision.text && (
          <div className="ml-auto mt-4 max-w-[560px] rounded-xl border border-dashed border-violet-300 bg-violet-50/30 px-3 py-2 text-[12px] dark:border-violet-800 dark:bg-violet-950/20">
            <span className="font-semibold">Creative decision: </span>
            {story.creative.decision.text}
            {story.creative.decision.rationale && <span className="block text-muted">{story.creative.decision.rationale}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ColHead({ icon, title, sub, generated }: { icon: ReactNode; title: string; sub: string; generated?: boolean }) {
  return (
    <div className="mb-3">
      <p className={cn('flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider', generated ? 'text-violet-700 dark:text-violet-300' : 'text-subtle')}>
        {icon}
        {title}
      </p>
      <p className="text-[11px] text-subtle">{sub}</p>
    </div>
  );
}

function EmptyNode({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-subtle">{text}</div>;
}

function EdgeButton({ x, y, kind, label, disabled, onClick }: { x: number; y: number; kind: EdgeKind; label: string; disabled: boolean; onClick: () => void }) {
  const gen = kind === 'generated_hypothesis';
  return (
    <span className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
      <Tooltip content={disabled ? `${label} — no evidence cited` : `${label}. Opens the evidence.`}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={`Evidence: ${label}`}
          data-edge-kind={kind}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border bg-surface shadow-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9',
            gen ? 'border-dashed border-violet-400 text-violet-700' : kind === 'app_derived' ? 'border-line text-muted hover:border-fg/40' : 'border-accent/40 text-accent-ink hover:border-accent hover:shadow-ring',
          )}
        >
          <FileSearch className="h-3 w-3" aria-hidden />
        </button>
      </Tooltip>
    </span>
  );
}

/* ------------------------------------------------------------------ list layout */
function ListLayout({ story, selected, onSelect }: { story: Story; selected?: string; onSelect: (id: string) => void }) {
  const { open } = useEvidenceDrawer();
  const [allInterests, setAllInterests] = useState(false);
  const combined = story.attribution !== 'per_input';
  const ordered = [...story.interests.filter((i) => i.used_as_signal), ...story.interests.filter((i) => !i.used_as_signal)];
  const shown = allInterests ? ordered : ordered.slice(0, MAX_INTERESTS);
  const combinedEv = Array.from(new Set(story.edges.filter((e) => e.kind === 'qloo_combined_set').flatMap((e) => e.evidence_ids)));
  const placementEdge = story.edges.find((e) => e.kind === 'app_derived');
  const stratEdge = story.edges.find((e) => e.kind === 'generated_hypothesis' && e.to.startsWith('strategy:'));
  return (
    <ol className="space-y-3" data-testid="taste-list">
      <Step n={1} title="Your interests" sub="Resolved to Qloo">
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((i) => (
            <li key={i.entity_row_id ?? i.label} className={cn('rounded-lg border px-2 py-1 text-[12.5px]', i.used_as_signal ? 'border-line' : 'border-dashed border-line text-muted')}>
              <b className="font-semibold">{i.label}</b> <span className="text-[11px] text-subtle">· {i.status === 'proxy' ? `proxy for “${i.proxy_for}”` : humanize(i.status)}{i.used_as_signal ? '' : ' · not used'}</span>
            </li>
          ))}
        </ul>
        {ordered.length > MAX_INTERESTS && (
          <button type="button" className="mt-1.5 text-xs font-semibold text-accent-ink hover:underline" onClick={() => setAllInterests((v) => !v)} aria-expanded={allInterests}>
            {allInterests ? 'Show fewer' : `Show ${ordered.length - MAX_INTERESTS} more`}
          </button>
        )}
      </Step>
      <Step n={2} title="Qloo recommendations" sub={combined ? 'Recommended for this combined interest set' : 'Qloo attributed each place to an input'}>
        {combined && (
          <button type="button" onClick={() => open(combinedEv, 'Qloo · recommended for this combined interest set')} className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink hover:border-accent" data-testid="combined-edge">
            <FileSearch className="h-3 w-3" aria-hidden /> recommended for this combined interest set · evidence
          </button>
        )}
        <ul className="space-y-1.5">
          {story.recommendations.map((r) => {
            const attrs = story.edges.filter((e) => e.kind === 'qloo_explainability' && e.to === placeKey(r.id));
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  aria-pressed={selected === r.id}
                  className={cn('min-h-[36px] flex-1 rounded-xl border px-3 py-1.5 text-left text-[13px] [@media(pointer:coarse)]:min-h-[44px]', selected === r.id ? 'border-accent bg-accent-soft/40' : 'border-line hover:border-accent/50')}
                >
                  <b className="font-semibold">{r.name}</b> <span className="text-[11px] text-subtle">· rank {r.affinity_rank} of {r.of}</span>
                </button>
                {attrs.map((e) => (
                  <button key={e.from} type="button" onClick={() => open(e.evidence_ids, `${r.name} ← ${story.interests.find((i) => `interest:${i.id}` === e.from)?.label ?? 'interest'}`)} className="inline-flex items-center gap-1 rounded-full border border-accent/40 px-2 py-1 text-[11px] font-semibold text-accent-ink" aria-label={`Evidence: Qloo attributed ${r.name} to ${story.interests.find((i) => `interest:${i.id}` === e.from)?.label ?? 'an interest'}`}>
                    <FileSearch className="h-3 w-3" aria-hidden /> ← {story.interests.find((i) => `interest:${i.id}` === e.from)?.label ?? 'interest'}
                  </button>
                ))}
              </li>
            );
          })}
        </ul>
      </Step>
      <Step n={3} title="Placement" sub="Computed by LaunchLens: practical fit plus taste">
        {story.placement ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <b>{story.placement.name}</b>
            <Badge tone={story.placement.shortlisted ? 'ok' : 'neutral'}>{story.placement.shortlisted ? 'Shortlisted' : 'Top candidate'}</Badge>
            <span className="text-[11.5px] text-warn">{humanize(story.placement.status)}</span>
            {placementEdge && (
              <button type="button" onClick={() => open(placementEdge.evidence_ids, `Why ${story.placement!.name} is the placement`)} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[11px] font-semibold text-muted hover:text-fg">
                <FileSearch className="h-3 w-3" aria-hidden /> formula & evidence
              </button>
            )}
            <p className="w-full text-[11.5px] text-subtle">{story.placement.formula}</p>
          </div>
        ) : (
          <p className="text-[12.5px] text-subtle">No placement derived from these places yet.</p>
        )}
      </Step>
      <Step n={4} title="Campaign hypothesis" sub={stratEdge?.label ?? 'Generated'} generated>
        {story.hypothesis ? (
          <div className="rounded-xl border-2 border-dashed border-violet-300 p-3 dark:border-violet-800" data-generated="true">
            <GeneratedBadge />
            <p className="mt-1 text-[13px] font-semibold">{story.hypothesis.message ?? story.hypothesis.positioning}</p>
            <p className="mt-1 text-[11px] text-muted">{story.hypothesis.note}</p>
          </div>
        ) : (
          <p className="text-[12.5px] text-subtle">No campaign hypothesis yet.</p>
        )}
      </Step>
      <Step n={5} title="Creative preview" sub="Generated" generated last>
        {story.creative ? (
          <div className="flex gap-3 rounded-xl border-2 border-dashed border-violet-300 p-3 dark:border-violet-800" data-generated="true">
            {story.creative.preview_url && (
              <InteractiveMedia className="w-20 shrink-0" aspect="aspect-[4/5]" items={[{ src: story.creative.preview_url, alt: `Creative preview · ${story.creative.headline ?? ''}`, meta: 'Generated by LaunchLens' }]} showCaption={false} />
            )}
            <div className="min-w-0">
              <GeneratedBadge />
              <p lang={story.creative.language} className="mt-1 text-[13px] font-semibold">{story.creative.headline}</p>
              {story.creative.decision.text && <p className="mt-1 text-[11.5px] text-muted">Decision: {story.creative.decision.text}</p>}
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-subtle">No creative yet.</p>
        )}
      </Step>
    </ol>
  );
}

function Step({ n, title, sub, generated, last, children }: { n: number; title: string; sub: string; generated?: boolean; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-3">
      <span className="flex flex-col items-center">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', generated ? 'border-2 border-dashed border-violet-400 text-violet-700' : 'bg-accent-soft text-accent-ink')}>{n}</span>
        {!last && <span aria-hidden className={cn('mt-1 w-px flex-1', generated ? 'border-l-2 border-dashed border-violet-300' : 'bg-line')} />}
      </span>
      <div className="min-w-0 flex-1 pb-2">
        <p className="text-[13px] font-semibold">
          {title} <span className="font-normal text-subtle">· {sub}</span>
        </p>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ selected place */
export function PlaceExplain({ story, r }: { story: Story; r: StoryRecommendation }) {
  const { open } = useEvidenceDrawer();
  const ex = r.explanation;
  const isLead = story.placement?.place_id === r.id;
  const contributions = ex.contributions ?? [];
  const label = (id: string) => story.interests.find((i) => i.id === id)?.label ?? id;
  const unknowns = isLead ? Object.entries(story.placement!.verification ?? {}).filter(([, v]) => v === 'unknown').map(([k]) => k) : [];
  return (
    <motion.section
      key={r.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-line bg-surface2/40 p-4"
      aria-label={`Why ${r.name}`}
      data-testid="place-explain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <QlooBadge />
        <h3 className="font-display text-[15px] font-bold">{r.name}</h3>
        <span className="text-xs text-subtle">{humanize(r.category)}</span>
        {ex.evidence_ids.length > 0 && (
          <button type="button" onClick={() => open(ex.evidence_ids, `Qloo evidence · ${r.name}`)} className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent/40 bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink hover:border-accent">
            <FileSearch className="h-3 w-3" aria-hidden /> Qloo evidence
          </button>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-subtle">Affinity rank</dt>
          <dd>
            <b className="num font-display text-[17px]">#{r.affinity_rank}</b> <span className="text-muted">of {r.of}</span>
            <span className="block text-[11px] text-subtle">for this audience’s interests in {story.area.name}</span>
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Popularity (separate number)</dt>
          <dd>
            <b className="num font-display text-[17px]">{r.popularity != null ? r.popularity.toFixed(2) : 'unknown'}</b>
            <span className="block text-[11px] text-subtle">Qloo’s general popularity percentile — not demand or footfall</span>
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Retrieved</dt>
          <dd>{fmtDate(ex.retrieved_at ?? r.retrieved_at)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Accessibility</dt>
          <dd>{r.accessibility === 'unknown' ? 'Unknown (not verified)' : humanize(r.accessibility)}</dd>
        </div>
      </dl>
      <div className="mt-3 rounded-xl bg-surface px-3 py-2 text-[12.5px]">
        <p className="font-semibold">Why Qloo recommended it</p>
        {contributions.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {contributions.map((c) => (
              <li key={c.id}>
                Attributed to <b>{label(c.id)}</b>
                {typeof c.score === 'number' && <span className="text-muted"> · Qloo score {c.score.toFixed(2)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-0.5 text-muted">
            {story.attribution === 'combined_set' || ex.status !== 'provided'
              ? 'Recommended for this combined interest set. Qloo did not say which input drove it, so none is implied.'
              : 'No per-input explanation was returned.'}
            {ex.warnings.length > 0 && <span className="block text-[11.5px] text-subtle">{ex.warnings.join(' ')}</span>}
          </p>
        )}
      </div>
      {isLead ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]">
            <p className="font-semibold">Next action for this placement</p>
            <p className="mt-0.5 text-muted">{story.placement!.next_action}</p>
            {story.placement!.evidence_needed && <p className="mt-1 text-[11.5px] text-subtle">Evidence needed: {story.placement!.evidence_needed}</p>}
          </div>
          <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px]">
            <p className="font-semibold">Still unknown (verify before booking)</p>
            {unknowns.length ? (
              <ul className="mt-1 flex flex-wrap gap-1">
                {unknowns.map((u) => (
                  <li key={u}>
                    <Badge tone="warn" icon={<CircleHelp className="h-3 w-3" />}>
                      {humanize(u)}: unknown
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-muted">Nothing recorded as unknown.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden /> This story leads to {story.placement ? <b className="text-fg">{story.placement.name}</b> : 'no placement yet'}; select it to see its next action.
        </p>
      )}
    </motion.section>
  );
}
