import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, CircleHelp, FlaskConical, Info, Table2 } from 'lucide-react';
import type { Analytics } from '../api/types';
import { cn, humanize } from '../lib/format';
import { EvidenceChip } from './Evidence';
import { Badge, Card, CardHeader, EmptyState, Table, Td, Th, Tooltip } from './ui';

/** Validated categorical palette (fixed order, entity-keyed — never by rank). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const CATEGORY_SLOT: Record<string, number> = {
  hospital: 0,
  clinic: 1,
  pharmacy: 2,
  medical_supply_store: 3,
  community_centre: 4,
  electronics_store: 5,
  shopping_mall: 6,
  social_facility: 7,
};
const OTHER = '#9AA1B2';
export const categoryColor = (c: string) => (c in CATEGORY_SLOT ? SERIES[CATEGORY_SLOT[c]] : OTHER);

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value);
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lift">
      <p className="mb-1 font-semibold text-fg">{label}</p>
      {rows.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="flex-1">{p.name}</span>
          <b className="num text-fg">{p.value}</b>
        </p>
      ))}
    </div>
  );
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!table)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface2 hover:text-fg" aria-pressed={table}>
      <Table2 className="h-3.5 w-3.5" /> {table ? 'Chart' : 'Table'}
    </button>
  );
}

export function CategoryDistribution({ a }: { a: Analytics }) {
  const [table, setTable] = useState(false);
  const { rows, cats } = useMemo(() => {
    const areas = Object.keys(a.category_distribution);
    const totals: Record<string, number> = {};
    areas.forEach((ar) => Object.entries(a.category_distribution[ar]).forEach(([c, n]) => (totals[c] = (totals[c] ?? 0) + n)));
    const known = Object.keys(totals).filter((c) => c in CATEGORY_SLOT).sort((x, y) => CATEGORY_SLOT[x] - CATEGORY_SLOT[y]);
    const hasOther = Object.keys(totals).some((c) => !(c in CATEGORY_SLOT));
    const cats = hasOther ? [...known, 'other'] : known;
    const rows = areas.map((ar) => {
      const r: Record<string, number | string> = { area: ar };
      Object.entries(a.category_distribution[ar]).forEach(([c, n]) => {
        const k = c in CATEGORY_SLOT ? c : 'other';
        r[k] = ((r[k] as number) ?? 0) + n;
      });
      return r;
    });
    return { rows, cats };
  }, [a]);
  return (
    <Card>
      <CardHeader title="Business category distribution" subtitle={a.caveats.counts} action={<ViewToggle table={table} onChange={setTable} />} />
      <div className="p-4">
        {rows.length === 0 ? (
          <EmptyState title="No retrieved places for this filter" />
        ) : table ? (
          <Table caption="Places by category and area">
            <thead>
              <tr>
                <Th>Area</Th>
                {cats.map((c) => (
                  <Th key={c} className="text-right">{humanize(c)}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.area)}>
                  <Td className="font-medium">{r.area}</Td>
                  {cats.map((c) => (
                    <Td key={c} className="num text-right">{(r[c] as number) ?? 0}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="area" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--subtle))' }} allowDecimals={false} />
                <RTooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5, color: 'rgb(var(--muted))' }} formatter={(v) => <span className="text-muted">{v}</span>} />
                {cats.map((c, i) => (
                  <Bar
                    key={c}
                    dataKey={c}
                    name={humanize(c)}
                    stackId="a"
                    fill={c === 'other' ? OTHER : categoryColor(c)}
                    stroke="rgb(var(--surface))"
                    strokeWidth={1.5}
                    radius={i === cats.length - 1 ? [4, 4, 0, 0] : 0}
                    maxBarSize={64}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}

export function Competitors({ a }: { a: Analytics }) {
  const rows = Object.entries(a.competitors).map(([area, v]) => ({ area, confirmed: v.confirmed, inferred: v.inferred_category_peers }));
  return (
    <Card>
      <CardHeader title="Competitor density" subtitle={a.caveats.competitors} />
      <div className="space-y-4 p-4">
        {rows.length === 0 ? (
          <EmptyState title="No competitors in the retrieved set">That is not the same as no competition — retrieval is bounded.</EmptyState>
        ) : (
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid horizontal={false} stroke="rgb(var(--border))" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--subtle))' }} />
                <YAxis type="category" dataKey="area" tickLine={false} axisLine={false} width={84} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} />
                <RTooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5 }} formatter={(v) => <span className="text-muted">{v}</span>} />
                <Bar dataKey="confirmed" name="Confirmed competitors" stackId="c" fill={SERIES[0]} stroke="rgb(var(--surface))" strokeWidth={1.5} />
                <Bar dataKey="inferred" name="Inferred category peers" stackId="c" fill={SERIES[1]} stroke="rgb(var(--surface))" strokeWidth={1.5} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {a.competitor_density.length > 0 && (
          <Table caption="Competitor density by area">
            <thead>
              <tr>
                <Th>Area</Th>
                <Th className="text-right">Count</Th>
                <Th className="text-right">Disclosed area</Th>
                <Th className="text-right">per 100 km²</Th>
              </tr>
            </thead>
            <tbody>
              {a.competitor_density.map((d) => (
                <tr key={d.area}>
                  <Td className="font-medium">{d.area}</Td>
                  <Td className="num text-right">{d.count}</Td>
                  <Td className="num text-right">{d.area_km2} km²</Td>
                  <Td className="num text-right font-semibold">{d.per_100_km2}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="text-[11.5px] text-subtle">{a.caveats.density}</p>
      </div>
    </Card>
  );
}

const COV: Record<string, { cls: string; icon: JSX.Element; label: string }> = {
  supported: { cls: 'bg-ok-soft text-ok border-ok/25', icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: 'Supported' },
  hypothesis: { cls: 'bg-warn-soft text-warn border-warn/30', icon: <FlaskConical className="h-3.5 w-3.5" />, label: 'Hypothesis' },
  unknown: {
    cls: 'border-dashed border-line text-subtle bg-[repeating-linear-gradient(135deg,rgb(var(--surface-2))_0_6px,transparent_6px_12px)]',
    icon: <CircleHelp className="h-3.5 w-3.5" />,
    label: 'Unknown',
  },
};

export function EvidenceCoverage({ a }: { a: Analytics }) {
  const topics = ['places', 'climate', 'taste', 'service', 'noise', 'footfall', 'income', 'accessibility', 'ad_inventory'];
  return (
    <Card>
      <CardHeader
        title="Evidence coverage"
        subtitle="What is supported, hypothesised or missing for each location."
        action={
          <Tooltip content={a.caveats.coverage}>
            <span tabIndex={0} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-1 text-[11px] font-semibold text-muted">
              <Info className="h-3 w-3" /> Unknown is not zero
            </span>
          </Tooltip>
        }
      />
      <div className="p-4">
        {a.evidence_coverage.length === 0 ? (
          <EmptyState title="No assessed locations in this run" />
        ) : (
          <Table caption="Evidence coverage by location and topic">
            <thead>
              <tr>
                <Th>Location</Th>
                {topics.map((t) => (
                  <Th key={t} className="text-center">{humanize(t)}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.evidence_coverage.map((row) => (
                <tr key={row.area}>
                  <Td className="font-semibold">{row.area}</Td>
                  {topics.map((t) => {
                    const s = COV[String(row[t])] ?? COV.unknown;
                    return (
                      <Td key={t} className="text-center">
                        <span className={cn('inline-flex min-w-[88px] items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold', s.cls)}>
                          {s.icon}
                          {s.label}
                        </span>
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}

export function FeatureRelevance({ a }: { a: Analytics }) {
  const areas = Array.from(new Set(a.feature_relevance.map((x) => x.area)));
  const feats = Array.from(new Set(a.feature_relevance.map((x) => x.feature)));
  return (
    <Card>
      <CardHeader title="Feature relevance matrix" subtitle="Validated relevance is kept separate from hypotheses. A hot climate suggests, but does not prove, that a fan matters." />
      <div className="p-4">
        {a.feature_relevance.length === 0 ? (
          <EmptyState title="No enabled features or assessed locations" />
        ) : (
          <Table caption="Feature relevance by location">
            <thead>
              <tr>
                <Th>Location</Th>
                {feats.map((f) => (
                  <Th key={f}>{f}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {areas.map((ar) => (
                <tr key={ar}>
                  <Td className="font-semibold">{ar}</Td>
                  {feats.map((f) => {
                    const c = a.feature_relevance.find((x) => x.area === ar && x.feature === f);
                    const s = COV[c?.status ?? 'unknown'] ?? COV.unknown;
                    return (
                      <Td key={f} className="min-w-[220px]">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold', s.cls)}>
                            {s.icon}
                            {s.label}
                          </span>
                          {c?.evidence_id && <EvidenceChip ids={[c.evidence_id]} title={`${f} in ${ar}`} label="evidence" />}
                        </div>
                        <p className="mt-1 text-[12px] leading-snug text-muted">{c?.note}</p>
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}

export function TasteProfile({ a, qlooConfigured }: { a: Analytics; qlooConfigured?: boolean }) {
  return (
    <Card>
      <CardHeader title="Taste profile (Qloo)" subtitle={a.caveats.taste} />
      <div className="p-4">
        {a.taste_profile.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-line p-4 text-sm">
            <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
            <div>
              <p className="font-semibold">No taste signals in this run — shown as Unknown, not zero.</p>
              <p className="mt-0.5 text-muted">
                {qlooConfigured === false
                  ? 'Qloo is not configured on the server (QLOO_API_KEY missing), so cultural fit is missing and rankings are incomplete.'
                  : 'The taste analyst returned no provider signals for these locations and audiences.'}
              </p>
            </div>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {a.taste_profile.map((t) => (
              <li key={t.evidence_id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{t.area}</span>
                  <EvidenceChip ids={[t.evidence_id]} title={t.title} />
                </div>
                <p className="mt-1 text-[13px] text-muted">{t.title}</p>
                {t.value !== null && (
                  <p className="mt-1 text-sm">
                    <b className="num">{t.value}</b> <span className="text-subtle">{t.units}</span>
                  </p>
                )}
                {t.top.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.top.map((x, i) => (
                      <Badge key={i} tone="violet">
                        {typeof x === 'string' ? x : String((x as { name?: string }).name ?? JSON.stringify(x))}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
