/**
 * Feature C — two audiences, same run, same city, same practical places,
 * product facts and budget: what changes is only the audience.
 */
import { ArrowLeftRight, Equal, Fingerprint, Lightbulb, MapPin, Store } from 'lucide-react';
import { ApiError } from '../api/client';
import { useAudienceCompare } from '../api/hooks';
import type { AudienceCompare as Cmp, CompareSide } from '../api/types';
import { cn, fmtMoney, humanize } from '../lib/format';
import { ROLE_LABEL } from '../lib/labels';
import { CitySignalChip, GeneratedBadge } from './TasteStory';
import { Badge, EmptyState, ErrorState, Select, Skeleton } from './ui';

const short = (n?: string | null) => (n ?? '').replace(/\s*\(hypothetical persona\)/i, '');

export function AudienceCompare({
  runId,
  areaId,
  audiences,
  a,
  b,
  onChange,
}: {
  runId?: string;
  areaId?: string;
  audiences: { id: string; name: string }[];
  a?: string;
  b?: string;
  onChange: (a: string, b: string) => void;
}) {
  const q = useAudienceCompare(runId, areaId, a, b);
  return (
    <div className="space-y-4" data-testid="audience-compare" data-tour="audience-compare">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="label">Audience A</span>
          <Select value={a ?? ''} onChange={(e) => onChange(e.target.value, b ?? '')}>
            {audiences.map((x) => (
              <option key={x.id} value={x.id} disabled={x.id === b}>
                {short(x.name)}
              </option>
            ))}
          </Select>
        </label>
        <button
          type="button"
          onClick={() => a && b && onChange(b, a)}
          className="mb-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-line text-muted hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          aria-label="Swap audiences"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <label className="min-w-[200px] flex-1">
          <span className="label">Audience B</span>
          <Select value={b ?? ''} onChange={(e) => onChange(a ?? '', e.target.value)}>
            {audiences.map((x) => (
              <option key={x.id} value={x.id} disabled={x.id === a}>
                {short(x.name)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {audiences.length < 2 && <EmptyState title="Add a second audience to compare">Comparison needs two audiences in the same research run.</EmptyState>}
      {q.isLoading && <Skeleton className="h-72 w-full" />}
      {q.error &&
        (q.error instanceof ApiError && q.error.code === 'audience_not_in_run' ? (
          <EmptyState title="One of these audiences is not part of the selected run">It was added or changed after the run; a new research run includes it.</EmptyState>
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ))}
      {q.data && <CompareView c={q.data} />}
    </div>
  );
}

function CompareView({ c }: { c: Cmp }) {
  const d = c.differences;
  return (
    <div className="space-y-4">
      <div className={cn('flex flex-wrap items-start gap-3 rounded-2xl border p-3.5', c.changed ? 'border-accent/30 bg-accent-soft/30' : 'border-line bg-surface2/50')}>
        {c.changed ? <ArrowLeftRight className="mt-0.5 h-4 w-4 text-accent-ink" /> : <Equal className="mt-0.5 h-4 w-4 text-muted" />}
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-semibold">{c.summary}</p>
          <p className="text-muted">
            {c.shared.note} {c.area.name} · product v{c.shared.product_version ?? '?'} · constraints v{c.shared.constraints_version ?? '?'} · ad budget {fmtMoney(c.shared.ad_spend_budget)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          <Badge tone="accent">{d.only_a.length} only A</Badge>
          <Badge tone="violet">{d.only_b.length} only B</Badge>
          <Badge tone="neutral">{d.both.length} both</Badge>
          <Badge tone={d.main_feature_changed ? 'accent' : 'neutral'}>{d.main_feature_changed ? 'Lead feature differs' : 'Same lead feature'}</Badge>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Side tag="A" s={c.a} only={new Set(d.only_a)} onlyInterests={new Set(d.interests_only_a)} both={d.both} city={c.area.name} />
        <Side tag="B" s={c.b} only={new Set(d.only_b)} onlyInterests={new Set(d.interests_only_b)} both={d.both} city={c.area.name} />
      </div>
    </div>
  );
}

function Side({ tag, s, only, onlyInterests, both, city }: { tag: 'A' | 'B'; s: CompareSide; only: Set<string>; onlyInterests: Set<string>; both: { name: string; rank_a: number; rank_b: number }[]; city: string }) {
  const tone = tag === 'A' ? 'accent' : 'violet';
  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={`Audience ${tag}: ${short(s.audience.name)}`}>
      <div className="flex items-start gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white', tag === 'A' ? 'bg-accent' : 'bg-violet-600')}>{tag}</span>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold leading-snug">{short(s.audience.name)}</p>
          <p className="text-[11.5px] text-subtle">
            {ROLE_LABEL[s.audience.role as keyof typeof ROLE_LABEL] ?? humanize(s.audience.role)}
            {s.audience.needs?.length ? ` · needs: ${s.audience.needs.join(', ')}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
          <Fingerprint className="h-3 w-3" /> Interests used
        </p>
        <ul className="flex flex-wrap gap-1">
          {s.interests.length === 0 && <li className="text-[12px] text-subtle">None resolved</li>}
          {s.interests.map((i) => (
            <li key={i.entity_row_id ?? i.label}>
              <Badge tone={onlyInterests.has(i.label) ? tone : 'neutral'}>
                {i.label}
                {!i.used_as_signal && ' (not used)'}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3">
        <CitySignalChip s={s.city_signal} city={city} />
      </div>
      <div className="mt-3">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
          <Store className="h-3 w-3" /> Placement candidates (by suitability)
        </p>
        <ol className="space-y-1">
          {s.shortlist.map((p) => {
            const shared = both.find((x) => x.name === p.name);
            return (
              <li key={p.placement_id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]', only.has(p.name) ? (tag === 'A' ? 'border-accent/40 bg-accent-soft/30' : 'border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/30') : 'border-line')}>
                <span className="num w-5 shrink-0 text-right font-bold text-subtle">{p.rank}</span>
                <span className="min-w-0 flex-1 truncate font-medium" title={p.name}>
                  {p.name}
                </span>
                <span className="shrink-0 text-[11px] text-subtle">{humanize(p.category)}</span>
                <span className="num shrink-0 text-[11px]" title="Qloo affinity for this audience (separate from suitability)">
                  {p.affinity != null ? `aff ${p.affinity.toFixed(2)}` : 'aff —'}
                </span>
                {shared ? (
                  <Badge tone="neutral" title={`Also for the other audience (rank ${tag === 'A' ? shared.rank_b : shared.rank_a})`}>
                    both
                  </Badge>
                ) : only.has(p.name) ? (
                  <Badge tone={tone}>only {tag}</Badge>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mt-3">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
          <Lightbulb className="h-3 w-3" /> Campaign hypothesis
        </p>
        {s.strategy ? (
          <div className="rounded-xl border-2 border-dashed border-violet-300 p-2.5 text-[12.5px] dark:border-violet-800" data-generated="true">
            <GeneratedBadge />
            <p className="mt-1 font-semibold">{s.strategy.message ?? s.strategy.positioning}</p>
            {s.strategy.main_feature_key && <p className="text-[11px] text-subtle">Leads with: {humanize(s.strategy.main_feature_key)}</p>}
          </div>
        ) : (
          <p className="flex items-center gap-1 text-[12px] text-subtle">
            <MapPin className="h-3 w-3" /> No strategy for this audience in {city} yet.
          </p>
        )}
      </div>
    </section>
  );
}
