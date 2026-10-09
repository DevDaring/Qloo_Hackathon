import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, CheckCircle2, CircleDashed, Cloud, Database, Fingerprint, Gauge, Globe2, Languages, Map as MapIcon, Mic, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProviders, useUsage } from '../api/hooks';
import type { ProviderProbe } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { Badge, Button, Callout, Card, CardHeader, ErrorState, Meter, PageHeader, SkeletonCard, Table, Tabs, Td, Th, Tooltip, fadeUp, stagger } from '../components/ui';
import { cn, fmtDate, fmtUsd, humanize } from '../lib/format';

function Tri({ label, v, legend }: { label: string; v: boolean | null | undefined; legend?: string }) {
  const meta =
    v === true
      ? { icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: 'bg-ok-soft text-ok border-ok/25', t: 'yes' }
      : v === false
        ? { icon: <XCircle className="h-3.5 w-3.5" />, cls: 'bg-bad-soft text-bad border-bad/25', t: 'no' }
        : { icon: <CircleDashed className="h-3.5 w-3.5" />, cls: 'border-dashed border-line text-subtle', t: 'not checked' };
  return (
    <Tooltip content={legend ?? label}>
      <span tabIndex={0} className={cn('inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold', meta.cls)}>
        {meta.icon}
        {label}: {meta.t}
      </span>
    </Tooltip>
  );
}

function ProviderCard({
  icon,
  name,
  p,
  legend,
  children,
}: {
  icon: JSX.Element;
  name: string;
  p: ProviderProbe;
  legend: Record<string, string>;
  children?: React.ReactNode;
}) {
  const ops = Object.entries(p.operations ?? {});
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[16px] font-bold">{name}</p>
          {p.model && <p className="truncate text-xs text-muted">model {p.model}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Tri label="Configured" v={p.configured} legend={legend.configured} />
        <Tri label="Reachable" v={p.reachable} legend={legend.reachable} />
        <Tri label="Authorized" v={p.authorized} legend={legend.authorized} />
      </div>
      <div className="mt-3">
        <p className="eyebrow mb-1.5">Operations</p>
        {ops.length === 0 ? (
          <p className="text-xs text-subtle">No operation verified{p.configured === false ? ' (not configured)' : ''}.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ops.map(([k, v]) => {
              const val = typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'supported' : 'unsupported') : v == null ? 'unknown' : JSON.stringify(v);
              const tone: 'ok' | 'warn' | 'bad' | 'neutral' = /^(supported|ok|verified|yes)$/i.test(val) ? 'ok' : /^(unsupported|not_enabled|disabled|forbidden)/i.test(val) ? 'warn' : /error|fail/i.test(val) ? 'bad' : 'neutral';
              return (
                <Tooltip key={k} content={tone === 'warn' ? `${humanize(k)} is not available with this credential or plan. LaunchLens treats it as unavailable (unknown, not zero) and never substitutes other data.` : `${humanize(k)}: ${val}`}>
                  <span tabIndex={0}>
                    <Badge tone={tone}>
                      {humanize(k)}: {val.replace(/_/g, ' ').slice(0, 60)}
                    </Badge>
                  </span>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
      {(p.message || p.error) && <p className="mt-3 rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">{String(p.message ?? p.error).slice(0, 300)}</p>}
      {children && <div className="mt-3 text-xs text-muted">{children}</div>}
    </Card>
  );
}

export default function SettingsStatus() {
  const { pid } = useParams();
  const [refresh, setRefresh] = useState(false);
  const q = useProviders(refresh);
  const qc = useQueryClient();
  const [scope, setScope] = useState<'project' | 'workspace'>(pid ? 'project' : 'workspace');
  const [allRows, setAllRows] = useState(false);
  const usage = useUsage(scope === 'project' ? pid : undefined);
  const s = q.data;
  const legend = s?.legend ?? {};
  const cats = ['research', 'reasoning', 'image', 'video', 'audio'];
  const today = Number(usage.data?.today_usd ?? 0);
  const cap = Number(usage.data?.daily_cap_usd ?? 0);
  return (
    <PageWrap>
      <PageHeader
        eyebrow="System"
        title="Settings / status"
        description="Non-secret provider configuration and verified capabilities. Keys live only in the server’s .env — there is no secret entry here."
        actions={
          <Button
            variant="outline"
            icon={<RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} />}
            onClick={() => {
              setRefresh(true);
              qc.invalidateQueries({ queryKey: ['providers', true] });
            }}
          >
            Re-probe providers
          </Button>
        }
      />
      {q.isLoading && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={5} />
          ))}
        </div>
      )}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {s && (
        <>
          <div className="mb-5 flex flex-wrap gap-3 text-xs text-muted">
            {Object.entries(legend).map(([k, v]) => (
              <span key={k}>
                <b className="text-fg">{humanize(k)}</b> = {v}
              </span>
            ))}
          </div>
          <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <motion.div variants={fadeUp} data-testid="provider-qloo">
              <ProviderCard icon={<Fingerprint className="h-5 w-5" />} name="Qloo Taste AI" p={s.qloo} legend={legend}>
                <p>Base URL: {s.qloo.base_url}</p>
                {s.qloo.configured && s.qloo.authorized && (
                  <p className="mt-2 rounded-xl bg-ok-soft/70 px-3 py-2 text-xs text-fg">Live: taste signals, entity resolution, place insights and the heatmap layer use this key. Affinity is a relative taste signal — never demand.</p>
                )}
                {!s.qloo.configured && (
                  <Callout tone="warn" className="mt-2 text-xs">
                    <b className="text-fg">Qloo is not configured.</b> Add <code className="font-mono">QLOO_2009_API_KEY</code> or <code className="font-mono">QLOO_API_KEY</code> to the server’s <code>.env</code> and restart. Until then entity resolution, taste signals and the cultural-fit component are unavailable, and rankings stay incomplete — never filled with substitute data.
                  </Callout>
                )}
              </ProviderCard>
            </motion.div>
            <motion.div variants={fadeUp}>
              <ProviderCard icon={<Brain className="h-5 w-5" />} name="Reasoning (LLM)" p={{ ...s.reasoning, message: undefined }} legend={legend}>
                {s.reasoning.served_by && (
                  <div className="mb-2 rounded-xl border border-accent/25 bg-accent-soft/60 p-2.5" data-testid="reasoning-served-by">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Currently served by</p>
                    <p className="font-mono text-[13px] font-semibold text-fg">{s.reasoning.served_by}</p>
                    {s.reasoning.served_by !== s.reasoning.model && <p className="mt-0.5 text-[11.5px]">Fallback in use — primary {s.reasoning.model} is unavailable.</p>}
                  </div>
                )}
                {s.reasoning.message && <p className="mb-2 rounded-xl bg-warn-soft/70 px-3 py-2 text-xs text-fg">{String(s.reasoning.message)}</p>}
                <p>
                  Primary: <b className="text-fg">{s.reasoning.primary}</b> · fallback: {s.reasoning.fallback} ({s.reasoning.fallback_configured ? 'configured' : 'not configured'}
                  {s.reasoning.fallback_enabled === false ? ', disabled' : ''})
                </p>
              </ProviderCard>
            </motion.div>
            <motion.div variants={fadeUp}>
              <ProviderCard icon={<Sparkles className="h-5 w-5" />} name="xAI Grok Imagine (images & video)" p={s.media} legend={legend}>
                <p>
                  Image model <b className="text-fg">{s.media.image_model ?? '—'}</b> · video model <b className="text-fg">{s.media.video_model ?? '—'}</b>
                </p>
                {s.media.available_models && (
                  <p className="mt-1">Available: {Object.entries(s.media.available_models).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ')}</p>
                )}
              </ProviderCard>
            </motion.div>
            <motion.div variants={fadeUp}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">
                    <Mic className="h-5 w-5" />
                  </span>
                  <p className="font-display text-[16px] font-bold">Narration (optional)</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Tri label="Configured" v={s.narration.configured} legend={legend.configured} />
                  {s.narration.sarvam !== undefined && <Badge>Sarvam key: {s.narration.sarvam ? 'present' : 'absent'}</Badge>}
                  <Badge>Fish TTS key: {s.narration.fish ? 'present' : 'absent'}</Badge>
                  <Badge>fal key: {s.narration.fal ? 'present' : 'absent'}</Badge>
                </div>
                {s.narration.order && (
                  <div className="mt-3 space-y-1.5">
                    <p className="eyebrow">Provider order (first available wins)</p>
                    {Object.entries(s.narration.order).map(([lang, order]) => (
                      <div key={lang} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="w-12 font-semibold uppercase text-muted">{lang}</span>
                        {order.map((o, i) => (
                          <span key={o} className="inline-flex items-center gap-1.5">
                            {i > 0 && <span className="text-subtle">→</span>}
                            <Badge tone={i === 0 ? 'accent' : 'neutral'}>{o}</Badge>
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-muted">{s.narration.note} TTS narration is always labelled “needs review”.</p>
              </Card>
            </motion.div>
            {s.indic_language && (
              <motion.div variants={fadeUp} data-testid="provider-sarvam">
                <Card className="h-full p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">
                      <Languages className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-[16px] font-bold">Indian languages ({s.indic_language.provider})</p>
                      <p className="truncate text-xs text-muted" lang="hi">हिन्दी · <span lang="bn">বাংলা</span> translation &amp; narration</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Tri label="Configured" v={s.indic_language.configured} legend={legend.configured} />
                    {s.indic_language.translation_model && <Badge tone="accent">Translation: {s.indic_language.translation_model}</Badge>}
                    {s.indic_language.tts_model && <Badge tone="accent">TTS: {s.indic_language.tts_model}</Badge>}
                  </div>
                  {s.indic_language.verified && (
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                      {typeof s.indic_language.verified === 'string' ? s.indic_language.verified : 'Verified'}
                    </p>
                  )}
                  {s.indic_language.note && <p className="mt-2 rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">{s.indic_language.note}</p>}
                </Card>
              </motion.div>
            )}
            <motion.div variants={fadeUp}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">
                    <Globe2 className="h-5 w-5" />
                  </span>
                  <p className="font-display text-[16px] font-bold">Geography & climate</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Tri label="Geocoding reachable" v={s.geo.geocoding?.reachable} legend={legend.reachable} />
                  {s.geo.geocoding && <Badge tone="ok">{s.geo.geocoding.provider}: {s.geo.geocoding.operation}</Badge>}
                </div>
                <ul className="mt-3 space-y-1 text-xs text-muted">
                  {s.geo.places && <li><b className="text-fg">Places ({s.geo.places.provider}):</b> {s.geo.places.note}</li>}
                  {s.geo.climate && <li><b className="text-fg">Climate ({s.geo.climate.provider}):</b> {s.geo.climate.note}</li>}
                </ul>
              </Card>
            </motion.div>
            <motion.div variants={fadeUp}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">
                    <MapIcon className="h-5 w-5" />
                  </span>
                  <p className="font-display text-[16px] font-bold">Map & storage</p>
                </div>
                <ul className="mt-4 space-y-1.5 text-xs text-muted">
                  <li className="truncate"><b className="text-fg">Style:</b> {s.map.style_url}</li>
                  <li><b className="text-fg">Attribution:</b> {s.map.attribution}</li>
                  <li className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> <b className="text-fg">Asset storage:</b> {s.storage.backend}</li>
                </ul>
              </Card>
            </motion.div>
          </motion.div>

          <Card className="mt-6">
            <CardHeader icon={<Gauge className="h-4 w-4" />} title="Limits" subtitle="Bounded agent activity and spending controls (server configuration)." />
            <div className="grid gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(s.limits).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface2/70 p-3">
                  <p className="text-[11px] text-subtle">{humanize(k)}</p>
                  <p className="num font-display text-lg font-bold">{k.includes('usd') ? fmtUsd(v) : String(v)}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card className="mt-6">
        <CardHeader
          icon={<Cloud className="h-4 w-4" />}
          title="Usage & cost"
          subtitle="Estimated (pricing file), actual (provider-reported) and reserved (in-flight) amounts are kept separate."
          action={pid ? <Tabs<'project' | 'workspace'> size="sm" value={scope} onChange={setScope} tabs={[{ key: 'project', label: 'This project' }, { key: 'workspace', label: 'Workspace' }]} /> : undefined}
        />
        <div className="space-y-5 p-5">
          {usage.isLoading && <SkeletonCard lines={4} />}
          {usage.error && <ErrorState error={usage.error} onRetry={() => usage.refetch()} />}
          {usage.data && (
            <>
              <div className="max-w-xl">
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-semibold">Today’s spend (workspace)</span>
                  <span className="num">
                    <b className="font-display text-lg">{fmtUsd(today)}</b> <span className="text-muted">of {fmtUsd(cap)} daily cap</span>
                  </span>
                </div>
                <Meter value={cap ? Math.min(1, today / cap) : 0} tone="brand" label="Daily spend against cap" />
              </div>
              <Table caption="Usage by category">
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th className="text-right">Calls</Th>
                    <Th className="text-right">Estimated</Th>
                    <Th className="text-right">Actual</Th>
                    <Th className="text-right">Reserved</Th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => {
                    const r = usage.data!.by_category[c];
                    return (
                      <tr key={c}>
                        <Td className="font-medium capitalize">{c}</Td>
                        <Td className="num text-right">{r?.calls ?? 0}</Td>
                        <Td className="num text-right">{r ? fmtUsd(r.estimated_usd, 3) : '—'}</Td>
                        <Td className="num text-right">{r ? fmtUsd(r.actual_usd, 3) : '—'}</Td>
                        <Td className="num text-right">{r ? fmtUsd(r.reserved_usd, 3) : '—'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <div>
                <p className="eyebrow mb-2">Recent ledger entries (workspace)</p>
                {usage.data.recent.length === 0 ? (
                  <p className="text-sm text-subtle">No paid calls recorded yet.</p>
                ) : (
                  <Table caption="Recent ledger rows">
                    <thead>
                      <tr>
                        <Th>When</Th>
                        <Th>Provider · model</Th>
                        <Th>Operation</Th>
                        <Th>State</Th>
                        <Th className="text-right">Estimated</Th>
                        <Th className="text-right">Actual</Th>
                        <Th>Pricing source</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.data.recent.slice(0, allRows ? undefined : 8).map((r, i) => (
                        <tr key={i}>
                          <Td className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</Td>
                          <Td className="text-xs">{r.provider} · {r.model}</Td>
                          <Td className="text-xs">{r.operation} <Badge className="ml-1">{r.category}</Badge></Td>
                          <Td><Badge tone={r.state === 'committed' ? 'ok' : r.state === 'reserved' ? 'warn' : 'neutral'}>{r.state}</Badge></Td>
                          <Td className="num text-right text-xs">{fmtUsd(r.estimated_usd, 4)}</Td>
                          <Td className="num text-right text-xs">{r.actual_usd != null ? fmtUsd(r.actual_usd, 4) : 'not reported'}</Td>
                          <Td className="max-w-[200px] truncate text-xs text-muted" title={r.pricing_source}>{r.pricing_source || '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                {usage.data.recent.length > 8 && (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAllRows((v) => !v)}>
                    {allRows ? 'Show fewer' : `Show all ${usage.data.recent.length} entries`}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
    </PageWrap>
  );
}
