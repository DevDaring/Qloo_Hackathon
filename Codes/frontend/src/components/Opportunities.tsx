/**
 * Feature E — underexplored opportunities: taste-relevant practical candidates
 * that are not yet shortlisted, in eligible cities. Affinity and popularity are
 * separate numbers; nothing here is called "low competition".
 */
import { Compass, FileText, HelpCircle } from 'lucide-react';
import { useOpportunities } from '../api/hooks';
import { cn, humanize } from '../lib/format';
import { Badge, Card, CardHeader, ErrorState, SkeletonCard, Tooltip } from './ui';

export function OpportunitiesCard({ runId, className }: { runId?: string; className?: string }) {
  const q = useOpportunities(runId);
  const items = q.data?.items ?? [];
  return (
    <Card className={className} data-testid="opportunities">
      <CardHeader
        icon={<Compass className="h-4 w-4" />}
        title="Underexplored opportunities"
        subtitle="Taste-relevant venues not yet shortlisted. Affinity is relevance to the audience’s interests; popularity is a separate, general number. Neither measures competition or willingness to partner."
      />
      <div className="p-5">
        {!runId && <p className="text-sm text-muted">Appears after a research run with Qloo signals.</p>}
        {q.isLoading && <SkeletonCard lines={3} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
        {q.data && items.length === 0 && <p className="text-sm text-muted">{q.data.message ?? 'Nothing to suggest for this run.'}</p>}
        <ul className="space-y-3">
          {items.map((o) => (
            <li key={o.placement_id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-snug">{o.name}</p>
                  <p className="text-[11.5px] text-subtle">
                    {humanize(o.category)} · {o.area} · for {o.audience.name?.replace(/\s*\(hypothetical persona\)/i, '')}
                    {o.constraints.distance_m != null && ` · ${(o.constraints.distance_m / 1000).toFixed(1)} km from centre`}
                  </p>
                </div>
                <Tooltip content={o.signal.meaning}>
                  <span tabIndex={0} className="inline-flex cursor-help items-center gap-1 text-[11px] text-subtle">
                    <HelpCircle className="h-3 w-3" /> what these mean
                  </span>
                </Tooltip>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Num label="Affinity" value={o.signal.affinity} />
                <div className="rounded-lg bg-surface2/60 px-2 py-1.5" title="Position by Qloo affinity among this audience’s candidates in this city">
                  <dd className="num font-display text-[15px] font-bold">
                    {o.signal.affinity_rank != null ? `#${o.signal.affinity_rank} of ${o.signal.affinity_rank_of}` : 'unknown'}
                  </dd>
                  <dt className="text-[10.5px] leading-tight text-subtle">Affinity rank in candidates</dt>
                </div>
                <Num label="Popularity" value={o.signal.popularity} />
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone="warn">{humanize(o.constraints.status)}</Badge>
                {o.constraints.unknown.map((u) => (
                  <Badge key={u} tone="neutral">
                    {humanize(u)}: unknown
                  </Badge>
                ))}
                <Badge tone="neutral">Accessibility: {o.constraints.accessibility === 'unknown' ? 'unknown' : humanize(o.constraints.accessibility)}</Badge>
              </div>
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface2/70 px-2.5 py-1.5 text-[12px] text-muted">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <b className="font-semibold text-fg">Pilot idea (from a template, not a result): </b>
                  {o.pilot_proposal.text}
                </span>
              </p>
              <p className="mt-1.5 text-[12px]">
                <b className="font-semibold">Next: </b>
                <span className="text-muted">{o.next_action}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Num({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className={cn('rounded-lg bg-surface2/60 px-2 py-1.5')} title={hint}>
      <dd className="num font-display text-[15px] font-bold">{value != null ? value.toFixed(2) : 'unknown'}</dd>
      <dt className="text-[10.5px] leading-tight text-subtle">{label}</dt>
    </div>
  );
}
