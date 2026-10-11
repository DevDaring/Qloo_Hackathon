import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, FileSpreadsheet, FlaskConical, Plus, ShieldAlert, Trash2, Upload } from 'lucide-react';
import type { Schemas } from '../api/client';
import { mutations, useApiMutation, useResults } from '../api/hooks';
import { PageWrap } from '../components/AppShell';
import { SERIES } from '../components/ExplorerCharts';
import { Dropzone, fieldErrors } from '../components/FormBits';
import { useProjectCtx } from '../components/ProjectContext';
import { LockNote, useLocked } from '../components/Locked';
import { useToast } from '../components/Toast';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonCard, Table, Tabs, Td, Th } from '../components/ui';
import { fmtMoney, fmtNum, fmtPct, humanize } from '../lib/format';

type Row = Schemas['ResultRow'];
const today = new Date().toISOString().slice(0, 10);
const blank = (currency: string): Row => ({
  period_start: today,
  period_end: today,
  area_name: '',
  channel: '',
  impressions: null,
  clicks: null,
  inquiries: null,
  leads: null,
  purchases: null,
  spend: null,
  currency,
  measurement_source: 'Manual entry (owner-reported)',
  notes: '',
});
const NUMS = ['impressions', 'clicks', 'inquiries', 'leads', 'purchases', 'spend'] as const;
const CSV_HEADER = 'period_start,period_end,area_name,channel,impressions,clicks,inquiries,leads,purchases,spend,currency,measurement_source,notes';

export default function Results() {
  const { pid, project } = useProjectCtx();
  const q = useResults(pid);
  const [mode, setMode] = useState<'form' | 'csv'>('form');
  const locked = useLocked();
  const currency = project?.currency ?? 'INR';
  const data = q.data;
  const chart = useMemo(
    () => (data?.summary ?? []).map((s) => ({ segment: s.segment, inquiries: s.inquiries, leads: s.leads, purchases: s.purchases })),
    [data],
  );
  return (
    <PageWrap>
      <PageHeader
        eyebrow="Learn"
        title="Results"
        description="Import measured pilot outcomes. Rates are computed by the server only where a valid denominator exists; missing values stay unknown. Actuals are kept apart from the strategy’s hypotheses."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {q.isLoading && <SkeletonCard lines={6} />}
          {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {data && data.items.length === 0 && (
            <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No measured results yet">
              Once your pilot runs, import impressions, clicks, inquiries, leads, purchases and spend with their measurement source.
            </EmptyState>
          )}
          {data && data.summary.length > 0 && (
            <>
              <Card>
                <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Pilot performance — actual measured outcomes" subtitle="Counts by area · channel. Unknown values are not drawn as zero." />
                <div className="h-[280px] p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap="25%">
                      <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="segment" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: 'rgb(var(--muted))' }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--subtle))' }} allowDecimals={false} />
                      <RTooltip cursor={{ fill: 'rgb(var(--surface-2))' }} contentStyle={{ borderRadius: 12, border: '1px solid rgb(var(--border))', background: 'rgb(var(--surface))', fontSize: 12 }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5 }} />
                      <Bar dataKey="inquiries" name="Inquiries" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="leads" name="Leads" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="purchases" name="Purchases" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <CardHeader title="Summary" subtitle="Rates from the API; blank denominators leave a rate unknown." />
                <div className="p-4">
                  <Table caption="Results summary">
                    <thead>
                      <tr>
                        <Th>Segment</Th>
                        <Th className="text-right">Rows</Th>
                        {NUMS.map((k) => (
                          <Th key={k} className="text-right">{humanize(k)}</Th>
                        ))}
                        <Th className="text-right">CTR</Th>
                        <Th className="text-right">Inq./click</Th>
                        <Th className="text-right">Purch./inq.</Th>
                        <Th className="text-right">Spend/inq.</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.summary.map((s) => (
                        <tr key={s.segment}>
                          <Td className="font-semibold">{s.segment}</Td>
                          <Td className="num text-right">{s.rows}</Td>
                          {NUMS.map((k) => (
                            <Td key={k} className="num text-right">
                              {s[k] == null ? <span className="text-subtle">Unknown</span> : k === 'spend' ? fmtMoney(s[k], currency) : fmtNum(s[k])}
                            </Td>
                          ))}
                          <Td className="num text-right">{s.rates.click_through_rate != null ? fmtPct(s.rates.click_through_rate, 2) : <span className="text-subtle">Unknown</span>}</Td>
                          <Td className="num text-right">{s.rates.inquiries_per_click != null ? fmtPct(s.rates.inquiries_per_click, 1) : <span className="text-subtle">Unknown</span>}</Td>
                          <Td className="num text-right">{s.rates.purchases_per_inquiry != null ? fmtPct(s.rates.purchases_per_inquiry, 1) : <span className="text-subtle">Unknown</span>}</Td>
                          <Td className="num text-right">{s.rates.spend_per_inquiry != null ? fmtMoney(s.rates.spend_per_inquiry, currency) : <span className="text-subtle">Unknown</span>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold">Imported rows ({data.items.length})</summary>
                    <Table caption="Imported rows" className="mt-2">
                      <thead>
                        <tr>
                          <Th>Period</Th>
                          <Th>Area · channel</Th>
                          <Th className="text-right">Inquiries</Th>
                          <Th className="text-right">Spend</Th>
                          <Th>Measurement source</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((r) => (
                          <tr key={r.id}>
                            <Td className="whitespace-nowrap text-xs">{r.period_start} → {r.period_end}</Td>
                            <Td className="text-xs">{r.area_name} · {r.channel}</Td>
                            <Td className="num text-right text-xs">{r.inquiries ?? 'Unknown'}</Td>
                            <Td className="num text-right text-xs">{r.spend != null ? fmtMoney(r.spend, r.currency) : 'Unknown'}</Td>
                            <Td className="text-xs text-muted">{r.measurement_source}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </details>
                </div>
              </Card>
            </>
          )}
          {data && (
            <Callout tone="warn" icon={<ShieldAlert className="h-4 w-4 text-warn" />} title="Attribution and causality">
              <ul className="list-disc space-y-0.5 pl-5">{data.limitations.map((l, li) => <li key={`${l}-${li}`}>{l}</li>)}</ul>
            </Callout>
          )}
          {data && data.hypotheses.length > 0 && (
            <Card>
              <CardHeader icon={<FlaskConical className="h-4 w-4" />} title="What the strategies set out to test" subtitle="Planning hypotheses and KPI targets — not results. Compare them with the actuals above yourself." />
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {data.hypotheses.map((h, hi) => (
                  <div key={`${h.strategy}-${hi}`} className="rounded-2xl border border-dashed border-warn/40 bg-warn-soft/30 p-4">
                    <p className="font-semibold">{h.strategy}</p>
                    <ul className="mt-2 space-y-1 text-[13px]">
                      {h.feature_hypotheses.map((f, i) => (
                        <li key={i}><Badge tone="warn">H{i + 1}</Badge> {f.text}</li>
                      ))}
                    </ul>
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {h.kpis_to_test.map((k, ki) => (
                        <li key={`${k.metric}-${ki}`}>• {k.metric}: <i>{k.target_to_test}</i> (target to test)</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card className="p-5">
            <p className="section-title">Import results</p>
            <Tabs<'form' | 'csv'> className="mt-3" size="sm" value={mode} onChange={setMode} tabs={[{ key: 'form', label: 'Form', icon: <Plus className="h-3.5 w-3.5" /> }, { key: 'csv', label: 'CSV upload', icon: <FileSpreadsheet className="h-3.5 w-3.5" /> }]} />
            {locked && <LockNote className="mt-3 max-w-none">Read-only sample: results can’t be imported here. Duplicate the project to record your own pilot.</LockNote>}
            <fieldset disabled={locked} className="m-0 mt-4 min-w-0 border-0 p-0">{mode === 'form' ? <ImportForm currency={currency} areas={project?.constraints?.candidate_regions.map((r) => r.name) ?? []} /> : <CsvImport />}</fieldset>
          </Card>
        </div>
      </div>
    </PageWrap>
  );
}

function ImportForm({ currency, areas }: { currency: string; areas: string[] }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([blank(currency)]);
  const imp = useApiMutation(() => mutations.importResults(pid, rows), [['results', pid]]);
  const errs = fieldErrors(imp.error);
  const set = (i: number, k: keyof Row, v: unknown) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Row {i + 1}</span>
            {rows.length > 1 && (
              <button className="rounded p-1 text-subtle hover:text-bad" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" error={errs[`rows.${i}.period_start`]}>
              <Input type="date" value={r.period_start} onChange={(e) => set(i, 'period_start', e.target.value)} />
            </Field>
            <Field label="To" error={errs[`rows.${i}.period_end`]}>
              <Input type="date" value={r.period_end} onChange={(e) => set(i, 'period_end', e.target.value)} />
            </Field>
            <Field label="Area">
              <Input list="result-areas" value={r.area_name ?? ''} onChange={(e) => set(i, 'area_name', e.target.value)} />
            </Field>
            <Field label="Channel">
              <Input value={r.channel ?? ''} onChange={(e) => set(i, 'channel', e.target.value)} placeholder="e.g. demo event" />
            </Field>
            {NUMS.map((k) => (
              <Field key={k} label={k === 'spend' ? `Spend (${r.currency})` : humanize(k)} error={errs[`rows.${i}.${k}`]}>
                <Input type="number" min={0} value={(r[k] as number | string | null) ?? ''} placeholder="Unknown" onChange={(e) => set(i, k, k === 'spend' ? (e.target.value === '' ? null : e.target.value) : num(e.target.value))} />
              </Field>
            ))}
            <Field label="Measurement source" required className="col-span-2" error={errs[`rows.${i}.measurement_source`]} hint="Where these numbers come from (e.g. Meta Ads Manager export, sign-in sheet).">
              <Input value={r.measurement_source} onChange={(e) => set(i, 'measurement_source', e.target.value)} />
            </Field>
          </div>
        </div>
      ))}
      <datalist id="result-areas">
        {areas.map((a, ai) => (
          <option key={`${a}-${ai}`} value={a} />
        ))}
      </datalist>
      <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((rs) => [...rs, blank(currency)])}>
        Add row
      </Button>
      <Button
        className="w-full"
        variant="brand"
        disabled={rows.some((r) => r.measurement_source.trim().length < 2)}
        loading={imp.isPending}
        onClick={() => imp.mutate(undefined, { onSuccess: (r) => (toast.success(`Imported ${r.imported} row(s)`), setRows([blank(currency)])), onError: (e) => toast.error('Import failed', e) })}
      >
        Import {rows.length} row{rows.length > 1 ? 's' : ''}
      </Button>
      <p className="text-xs text-subtle">Leave a field empty when it was not measured — it stays Unknown rather than zero.</p>
    </div>
  );
}

function CsvImport() {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const imp = useApiMutation((f: File) => mutations.importCsv(pid, f), [['results', pid]]);
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`${CSV_HEADER}\n2026-10-01,2026-10-07,Kolkata,demo event,,,12,4,1,5000,INR,Sign-in sheet at venue,\n`)}`;
  return (
    <div className="space-y-3">
      <Dropzone
        accept=".csv,text/csv"
        maxMb={2}
        busy={busy}
        label="Drop a CSV or browse"
        hint="Max 2 MB · 500 rows"
        onFiles={async (files) => {
          setBusy(true);
          try {
            const r = await imp.mutateAsync(files[0]);
            toast.success(`Imported ${r.imported} row(s)`);
          } catch (e) {
            toast.error('CSV import failed', e);
          } finally {
            setBusy(false);
          }
        }}
      />
      {imp.error && <ErrorState error={imp.error} compact />}
      <a href={template} download="launchlens-results-template.csv" className="link inline-flex items-center gap-1.5 text-sm">
        <Upload className="h-3.5 w-3.5" /> Download CSV template
      </a>
      <p className="font-mono text-[10.5px] text-subtle">{CSV_HEADER}</p>
    </div>
  );
}
