/**
 * Feature D — "Why this message?": the ad copy traced back through the creative
 * decisions and the campaign hypothesis to the product fact and its evidence,
 * plus the pilot hypothesis card (planned, never a result) and a switcher
 * across the other audience/language variants for the same city.
 */
import { Link } from 'react-router-dom';
import { ArrowDown, BadgeCheck, BarChart3, CalendarRange, CircleHelp, FileSearch, FlaskConical, Languages, Package, Target, Users } from 'lucide-react';
import { useCreativeTrace } from '../api/hooks';
import type { CreativeTrace, EvidenceBrief } from '../api/types';
import { cn, humanize } from '../lib/format';
import { LANG_LABEL } from '../lib/labels';
import { EvidenceBadge, useEvidenceDrawer } from './Evidence';
import { useProjectCtx } from './ProjectContext';
import { GeneratedBadge } from './TasteStory';
import { Badge, Card, ErrorState, Skeleton } from './ui';

const short = (n?: string | null) => (n ?? '').replace(/\s*\(hypothetical persona\)/i, '');

function EvidenceRefs({ items: raw, title }: { items: EvidenceBrief[]; title: string }) {
  const { open } = useEvidenceDrawer();
  const items = raw.filter((e, i) => raw.findIndex((x) => x.id === e.id) === i);
  if (!items.length)
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-[3px] text-[11px] font-medium text-subtle">
        <FileSearch className="h-3 w-3" aria-hidden /> No evidence cited
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {items.map((e) => (
        <EvidenceBadge key={e.id} badge={e.badge} kind={e.kind} />
      ))}
      <button
        type="button"
        onClick={() => open(items.map((e) => e.id), title)}
        className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent-soft px-2 py-[3px] text-[11px] font-semibold text-accent-ink hover:border-accent/50"
        aria-label={`Show ${items.length} evidence item${items.length > 1 ? 's' : ''} for ${title}`}
      >
        <FileSearch className="h-3 w-3" aria-hidden /> {items.length} evidence
      </button>
    </span>
  );
}

function Link_({ last }: { last?: boolean }) {
  return last ? null : (
    <div className="flex justify-center py-1 text-subtle" aria-hidden>
      <ArrowDown className="h-3.5 w-3.5" />
    </div>
  );
}

export function WhyThisMessage({ bid, onSwitch }: { bid: string; onSwitch: (id: string) => void }) {
  const q = useCreativeTrace(bid);
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data!;
  const pf = t.chain.product_fact;
  const st = t.chain.strategy;
  return (
    <div className="space-y-4" data-testid="why-this-message">
      <VariantSwitcher t={t} onSwitch={onSwitch} />
      <Card className="p-4">
        <p className="eyebrow mb-2">The message</p>
        <div lang={t.language} className="space-y-1">
          <p className="font-display text-[16px] font-bold leading-snug">{t.copy.headline}</p>
          {t.copy.body && <p className="text-[13px] text-muted">{t.copy.body}</p>}
          {t.copy.cta && <p className="text-[13px] font-semibold text-brand-ink">{t.copy.cta}</p>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="violet" icon={<Languages className="h-3 w-3" />}>{LANG_LABEL[t.language] ?? t.language}</Badge>
          <Badge tone={t.translation_status === 'source' ? 'neutral' : 'warn'}>{humanize(t.translation_status)}</Badge>
        </div>
      </Card>
      <Link_ />
      <Card className="p-4">
        <p className="eyebrow mb-2">Creative decisions</p>
        <ul className="space-y-2.5">
          {t.chain.decisions.map((d, i) => (
            <li key={i} className={cn('rounded-xl border p-3', d.nature === 'generated_hypothesis' ? 'border-2 border-dashed border-violet-300 dark:border-violet-800' : 'border-line')} data-generated={d.nature === 'generated_hypothesis' || undefined}>
              <div className="flex flex-wrap items-center gap-2">
                {d.nature === 'generated_hypothesis' ? <GeneratedBadge /> : <Badge tone="ok">Backed by evidence</Badge>}
                <span className="text-[13px] font-semibold">{d.decision}</span>
              </div>
              <p className="mt-1 text-[12.5px] text-muted">{d.rationale}</p>
              <div className="mt-1.5">
                <EvidenceRefs items={d.evidence} title={d.decision} />
              </div>
            </li>
          ))}
          {t.chain.decisions.length === 0 && <li className="text-[12.5px] text-subtle">No decisions recorded for this brief.</li>}
        </ul>
      </Card>
      <Link_ />
      <Card className="border-2 border-dashed border-violet-300 p-4 dark:border-violet-800" data-generated="true">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Campaign hypothesis</p>
          <GeneratedBadge />
        </div>
        {st.positioning && <p className="mt-2 text-[13.5px] font-semibold">{st.positioning}</p>}
        {st.main_feature_rationale && (
          <div className="mt-2 text-[12.5px]">
            <span className="text-muted">Why this feature: </span>
            {st.main_feature_rationale}
            <div className="mt-1">
              <EvidenceRefs items={st.rationale_evidence} title="Why this feature" />
            </div>
          </div>
        )}
        {st.key_messages.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {st.key_messages.map((m) => (
              <li key={m.text} className="text-[12.5px]">
                <span>“{m.text}”</span>
                <div className="mt-0.5">
                  <EvidenceRefs items={m.evidence} title={m.text} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">Proposed by a language model from the cited evidence — not a Qloo fact or a result.</p>
      </Card>
      <Link_ />
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Product fact</p>
          <Badge tone="brand" icon={<Package className="h-3 w-3" />}>From your brief · {humanize(pf.evidence_status ?? 'unknown')}</Badge>
        </div>
        {pf.name ? (
          <>
            <p className="mt-2 text-[13.5px] font-semibold">{pf.name}</p>
            {pf.mechanism && <p className="text-[12.5px] text-muted">{pf.mechanism}</p>}
            {pf.operating_conditions && <p className="mt-1 text-[12px] text-subtle">Only when: {pf.operating_conditions}</p>}
            {pf.source && <p className="text-[11.5px] text-subtle">Source: {pf.source}</p>}
          </>
        ) : (
          <p className="mt-1 text-[12.5px] text-subtle">The strategy names no product feature.</p>
        )}
        {t.chain.approved_claims.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Approved claims the copy may use</p>
            <ul className="mt-1 space-y-1">
              {t.chain.approved_claims.map((c) => (
                <li key={c.id} className="flex items-start gap-1.5 text-[12.5px]">
                  <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                  <span>
                    {c.text} <span className="text-[11px] text-subtle">· {humanize(c.support_status)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      {t.unknown_evidence_ids.length > 0 && (
        <p className="flex items-center gap-1.5 text-[12px] text-warn">
          <CircleHelp className="h-3.5 w-3.5" /> {t.unknown_evidence_ids.length} cited evidence id(s) could not be found and are treated as unsupported.
        </p>
      )}
    </div>
  );
}

function VariantSwitcher({ t, onSwitch }: { t: CreativeTrace; onSwitch: (id: string) => void }) {
  const variants = [{ brief_id: t.brief_id, audience: t.pilot_card.audience.name, language: t.language, headline: t.copy.headline, same_audience: true, current: true }, ...t.variants.map((v) => ({ ...v, current: false }))];
  if (variants.length < 2) return null;
  return (
    <nav aria-label="Other variants for this city" className="rounded-2xl border border-line bg-surface p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <Users className="h-3 w-3" /> Same city · switch audience or language
      </p>
      <ul className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {variants.map((v) => (
          <li key={v.brief_id} className="shrink-0">
            <button
              type="button"
              onClick={() => !v.current && onSwitch(v.brief_id)}
              aria-current={v.current ? 'true' : undefined}
              className={cn('w-[210px] rounded-xl border px-3 py-2 text-left transition [@media(pointer:coarse)]:min-h-[44px]', v.current ? 'border-brand bg-brand-soft/40' : 'border-line hover:border-fg/30 hover:bg-surface2')}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                <Badge tone="violet">{v.language.toUpperCase()}</Badge>
                <span className="truncate">{short(v.audience)}</span>
              </span>
              <span lang={v.language} className="mt-1 line-clamp-2 block text-[12.5px] font-semibold leading-snug">
                {v.headline}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PilotCard({ bid }: { bid: string }) {
  const { pid } = useProjectCtx();
  const q = useCreativeTrace(bid);
  if (!q.data) return null;
  const p = q.data.pilot_card;
  const m = p.measurement;
  return (
    <Card className="border-2 border-dashed border-violet-300 p-4 dark:border-violet-800" data-testid="pilot-card" data-generated="true">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-4 w-4 text-violet-700 dark:text-violet-300" aria-hidden />
        <p className="font-display text-[15px] font-bold">{p.label}</p>
        <GeneratedBadge className="ml-auto" />
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-2.5 text-[12.5px] sm:grid-cols-2">
        <Row icon={<Users className="h-3.5 w-3.5" />} k="Who">
          {short(p.audience.name)} {p.area && <span className="text-muted">in {p.area}</span>}
        </Row>
        <Row icon={<Target className="h-3.5 w-3.5" />} k="Where">
          {p.placement ? (
            <>
              {p.placement.name} <span className="text-warn">· {humanize(p.placement.status)}</span>
              <span className="block text-[11.5px] text-muted">Next: {p.placement.next_action}</span>
            </>
          ) : (
            <span className="text-subtle">No placement chosen yet</span>
          )}
        </Row>
        <Row icon={<BarChart3 className="h-3.5 w-3.5" />} k="Measure">
          {m.metric ?? 'Not set'}
          {m.target_to_test && <span className="block text-[11.5px] text-muted">Target to test: {m.target_to_test}</span>}
        </Row>
        <Row icon={<CalendarRange className="h-3.5 w-3.5" />} k="Duration">
          {m.duration_weeks ? `${m.duration_weeks} weeks` : 'Not set'}
        </Row>
      </dl>
      {m.objective && <p className="mt-2.5 text-[12.5px] text-muted">{m.objective}</p>}
      <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface2/70 px-3 py-2 text-[12px]">
        <b className="font-semibold">{p.results_recorded ? `${p.results_recorded} measured result(s) recorded` : 'No measured results yet'}</b>
        <span className="text-muted">{p.results_note}</span>
        <Link to={`/projects/${pid}/results`} className="link ml-auto">
          Results
        </Link>
      </p>
    </Card>
  );
}

function Row({ icon, k, children }: { icon: React.ReactNode; k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-subtle" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{k}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
