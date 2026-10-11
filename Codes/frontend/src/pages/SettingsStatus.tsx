import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Brain, CheckCircle2, CircleDashed, Cloud, Database, Fingerprint, Gauge, Globe2, Languages, Mic, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProviders, useUsage } from '../api/hooks';
import type { ProviderPlain, ProviderPlainState, ProviderProbe } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { Badge, Button, Card, CardHeader, ErrorState, Meter, PageHeader, SkeletonCard, Table, Tabs, Td, Th, Tooltip, fadeUp, stagger } from '../components/ui';
import { cn, fmtDate, fmtUsd, humanize, timeAgo } from '../lib/format';

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

type Health = { level: 'ok' | 'warn' | 'bad'; headline: string; detail: string; steps?: string[] };

/** Plain-language health for a probed provider. Technical facts stay in the expander. */
function healthOf(p: ProviderProbe, name: string, whenMissing: string): Health {
  const ops = Object.values(p.operations ?? {}).map(String);
  if (p.configured === false)
    return { level: 'bad', headline: 'Not set up', detail: whenMissing, steps: ['Ask the administrator to add the service key to the server configuration and restart the app.', 'Everything else keeps working; affected results are marked as unknown.'] };
  if (p.reachable === false)
    return { level: 'bad', headline: 'Not reachable right now', detail: `${name} did not answer the last check.`, steps: ['Use “Check again” in a few minutes.', 'Research continues with the evidence that is available and marks the gaps.'] };
  if (p.authorized === false)
    return { level: 'bad', headline: 'Key rejected', detail: `${name} refused the configured credential.`, steps: ['Ask the administrator to renew or replace the key on the server.'] };
  if (ops.some((v) => /unsupported|not_enabled|disabled|forbidden/i.test(v)))
    return { level: 'warn', headline: 'Partly available', detail: 'Some features are not enabled for this account; they are shown as unavailable rather than filled with other data.' };
  if (p.served_by && p.model && p.served_by !== p.model)
    return { level: 'warn', headline: 'Working via backup', detail: `The primary model is unavailable, so requests are answered by the backup (${p.served_by}).`, steps: ['No action needed for the demo; the administrator can restore the primary provider later.'] };
  return { level: 'ok', headline: 'Working', detail: `${name} answered the last check and the credential was accepted.` };
}

const PLAIN_HEADLINE: Record<ProviderPlainState, { level: Health['level']; headline: string }> = {
  working: { level: 'ok', headline: 'Working' },
  backup: { level: 'warn', headline: 'Working via backup' },
  partial: { level: 'warn', headline: 'Partly available' },
  busy: { level: 'warn', headline: 'Busy — try again shortly' },
  not_set_up: { level: 'bad', headline: 'Not set up' },
  key_rejected: { level: 'bad', headline: 'Key rejected' },
  unreachable: { level: 'bad', headline: 'Not reachable right now' },
};

/** Server-provided plain-language status (GET /providers/status → plain[]). */
function healthFromPlain(pl: ProviderPlain, optional = false): Health {
  const h = PLAIN_HEADLINE[pl.state] ?? { level: 'warn' as const, headline: humanize(pl.state) };
  const level = optional && h.level === 'bad' ? 'warn' : h.level;
  return { level, headline: optional && pl.state === 'not_set_up' ? 'Not set up (optional)' : h.headline, detail: [pl.summary, pl.impact].filter(Boolean).join(' '), steps: pl.recovery };
}

function ServiceCard({
  icon,
  name,
  purpose,
  health,
  checkedAt,
  children,
  testId,
  plain,
  optional,
}: {
  icon: JSX.Element;
  name: string;
  purpose: string;
  health: Health;
  checkedAt?: number;
  children?: React.ReactNode;
  testId?: string;
  plain?: ProviderPlain;
  optional?: boolean;
}) {
  if (plain) {
    health = healthFromPlain(plain, optional);
    name = plain.name || name;
    if (plain.checked_at) checkedAt = new Date(plain.checked_at).getTime();
  }
  const tone = health.level === 'ok' ? 'text-ok' : health.level === 'warn' ? 'text-warn' : 'text-bad';
  const Icon = health.level === 'ok' ? CheckCircle2 : health.level === 'warn' ? AlertTriangle : XCircle;
  return (
    <Card className="flex h-full flex-col p-5" data-testid={testId} data-state={plain?.state}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[16px] font-bold">{name}</p>
          <p className="text-xs text-muted">{purpose}</p>
        </div>
      </div>
      <div className="mt-4 flex items-start gap-2">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone)} aria-hidden />
        <div className="min-w-0">
          <p className={cn('text-[15px] font-semibold', tone)}>{health.headline}</p>
          <p className="text-[13px] text-muted">{health.detail}</p>
        </div>
      </div>
      {health.steps && health.steps.length > 0 && (
        <div className="mt-3 rounded-xl bg-surface2/70 px-3 py-2 text-[12.5px]">
          <p className="font-semibold">{health.level === 'ok' ? 'Note' : 'What to do'}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted">{health.steps.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-subtle">Last checked {checkedAt ? timeAgo(new Date(checkedAt).toISOString()) : '—'}</p>
      {children && (
        <details className="group mt-3 rounded-xl border border-line px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer select-none font-semibold text-fg [@media(pointer:coarse)]:py-2">Technical details</summary>
          <div className="mt-2 space-y-2">{children}</div>
        </details>
      )}
    </Card>
  );
}

function ProbeDetails({ p, legend }: { p: ProviderProbe; legend: Record<string, string> }) {
  const ops = Object.entries(p.operations ?? {});
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Tri label="Configured" v={p.configured} legend={legend.configured} />
        <Tri label="Reachable" v={p.reachable} legend={legend.reachable} />
        <Tri label="Authorized" v={p.authorized} legend={legend.authorized} />
      </div>
      <div>
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
      {p.model && <p>Model: <code className="font-mono">{p.model}</code></p>}
      {(p.message || p.error) && <p className="rounded-lg bg-surface2 px-2.5 py-1.5">{String(p.message ?? p.error).slice(0, 300)}</p>}
    </>
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
  const plain = (key: string) => s?.plain?.find((x) => x.key === key);
  const cats = ['research', 'reasoning', 'image', 'video', 'audio'];
  const today = Number(usage.data?.today_usd ?? 0);
  const cap = Number(usage.data?.daily_cap_usd ?? 0);
  return (
    <PageWrap>
      <PageHeader
        eyebrow="System"
        title="Settings / status"
        description="Whether each service LaunchLens relies on is working right now, what that means for your results, and what to do if it isn’t. Keys stay on the server — there is no secret entry here."
        actions={
          <Button
            variant="outline"
            icon={<RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} />}
            onClick={() => {
              setRefresh(true);
              qc.invalidateQueries({ queryKey: ['providers', true] });
            }}
          >
            Check again
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
          <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <motion.div variants={fadeUp}>
              <ServiceCard
                testId="provider-qloo"
                plain={plain('qloo')}
                icon={<Fingerprint className="h-5 w-5" />}
                name="Qloo Taste AI"
                purpose="Audience taste signals, interest matching, place affinity and the taste heatmap."
                health={healthOf(s.qloo, 'Qloo', 'Taste signals are unavailable, so cultural fit shows as unknown and rankings use practical evidence only.')}
                checkedAt={q.dataUpdatedAt}
              >
                <ProbeDetails p={s.qloo} legend={legend} />
                <p>Base URL: {s.qloo.base_url}</p>
                {!s.qloo.configured && (
                  <p>
                    Server setting: add <code className="font-mono">QLOO_2009_API_KEY</code> or <code className="font-mono">QLOO_API_KEY</code> to the server’s <code>.env</code> and restart.
                  </p>
                )}
              </ServiceCard>
            </motion.div>
            <motion.div variants={fadeUp}>
              <ServiceCard
                icon={<Brain className="h-5 w-5" />}
                name="Reasoning (language model)"
                plain={plain('reasoning')}
                purpose="Writes strategies and briefs, translates copy and answers questions — always checked against your claims."
                health={healthOf(s.reasoning, 'The reasoning model', 'Strategies fall back to clearly labelled templates and extraction is unavailable.')}
                checkedAt={q.dataUpdatedAt}
              >
                {s.reasoning.served_by && (
                  <div className="rounded-lg border border-accent/25 bg-accent-soft/60 p-2" data-testid="reasoning-served-by">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">Currently served by</p>
                    <p className="font-mono text-[12.5px] font-semibold text-fg">{s.reasoning.served_by}</p>
                  </div>
                )}
                <ProbeDetails p={s.reasoning} legend={legend} />
                <p>
                  Primary: <b className="text-fg">{s.reasoning.primary}</b> · fallback: {s.reasoning.fallback} ({s.reasoning.fallback_configured ? 'configured' : 'not configured'}
                  {s.reasoning.fallback_enabled === false ? ', disabled' : ''})
                </p>
              </ServiceCard>
            </motion.div>
            <motion.div variants={fadeUp}>
              <ServiceCard
                icon={<Sparkles className="h-5 w-5" />}
                name="Image & video generation (NanoGPT)"
                plain={plain('media')}
                purpose="Creates ad backgrounds and video clips — only after you approve a spending cap."
                health={healthOf(s.media, 'NanoGPT', 'Flyers and videos cannot be generated; briefs, copy and layout previews still work.')}
                checkedAt={q.dataUpdatedAt}
              >
                <ProbeDetails p={s.media} legend={legend} />
                <p>
                  Image model <b className="text-fg">{s.media.image_model ?? '—'}</b> · video model <b className="text-fg">{s.media.video_model ?? '—'}</b>
                </p>
                {s.media.available_models && <p>Available: {Object.entries(s.media.available_models).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ')}</p>}
              </ServiceCard>
            </motion.div>
            <motion.div variants={fadeUp}>
              <ServiceCard
                icon={<Mic className="h-5 w-5" />}
                name="Narration (optional)"
                plain={plain('narration')}
                optional
                purpose="Voice-over for videos. Without it, videos are silent with captions."
                health={
                  s.narration.configured
                    ? { level: 'ok', headline: 'Available', detail: 'Narration can be added to videos; it is always labelled “needs review”.' }
                    : { level: 'warn', headline: 'Not set up (optional)', detail: 'Videos are delivered silent with captions.' }
                }
                checkedAt={q.dataUpdatedAt}
              >
                <div className="flex flex-wrap gap-2">
                  <Tri label="Configured" v={s.narration.configured} legend={legend.configured} />
                  {s.narration.sarvam !== undefined && <Badge>Sarvam key: {s.narration.sarvam ? 'present' : 'absent'}</Badge>}
                  <Badge>Fish TTS key: {s.narration.fish ? 'present' : 'absent'}</Badge>
                  <Badge>fal key: {s.narration.fal ? 'present' : 'absent'}</Badge>
                </div>
                {s.narration.order && (
                  <div className="space-y-1.5">
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
                <p>{s.narration.note}</p>
              </ServiceCard>
            </motion.div>
            {s.indic_language && (
              <motion.div variants={fadeUp}>
                <ServiceCard
                  testId="provider-sarvam"
                  icon={<Languages className="h-5 w-5" />}
                  name={`Indian languages (${s.indic_language.provider})`}
                  plain={plain('indic_language')}
                  optional
                  purpose="Hindi and Bengali translation and narration; translations are always flagged for your review."
                  health={
                    s.indic_language.configured
                      ? { level: 'ok', headline: 'Working', detail: 'Hindi and Bengali copy is translated with brand names protected.' }
                      : { level: 'warn', headline: 'Not set up', detail: 'Hindi and Bengali copy uses the reasoning model instead and still needs review.' }
                  }
                  checkedAt={q.dataUpdatedAt}
                >
                  <div className="flex flex-wrap gap-2">
                    <Tri label="Configured" v={s.indic_language.configured} legend={legend.configured} />
                    {s.indic_language.translation_model && <Badge tone="accent">Translation: {s.indic_language.translation_model}</Badge>}
                    {s.indic_language.tts_model && <Badge tone="accent">TTS: {s.indic_language.tts_model}</Badge>}
                  </div>
                  {s.indic_language.verified && <p>{typeof s.indic_language.verified === 'string' ? s.indic_language.verified : 'Verified'}</p>}
                  {s.indic_language.note && <p>{s.indic_language.note}</p>}
                </ServiceCard>
              </motion.div>
            )}
            <motion.div variants={fadeUp}>
              <ServiceCard
                icon={<Globe2 className="h-5 w-5" />}
                name="Places, maps & climate"
                plain={plain('geo')}
                purpose="Finds cities and places (OpenStreetMap), map tiles and historical climate (Open-Meteo)."
                health={
                  s.geo.geocoding?.reachable === false
                    ? { level: 'bad', headline: 'Place search unavailable', detail: 'The geocoder did not answer the last check.', steps: ['Use “Check again” in a few minutes; saved cities keep working.'] }
                    : { level: 'ok', headline: 'Working', detail: 'Place search answered the last check; places and climate are fetched per research run and cached.' }
                }
                checkedAt={q.dataUpdatedAt}
              >
                <div className="flex flex-wrap gap-2">
                  <Tri label="Geocoding reachable" v={s.geo.geocoding?.reachable} legend={legend.reachable} />
                  {s.geo.geocoding && <Badge tone="ok">{s.geo.geocoding.provider}: {s.geo.geocoding.operation}</Badge>}
                </div>
                {s.geo.places && <p><b className="text-fg">Places ({s.geo.places.provider}):</b> {s.geo.places.note}</p>}
                {s.geo.climate && <p><b className="text-fg">Climate ({s.geo.climate.provider}):</b> {s.geo.climate.note}</p>}
                <p className="truncate"><b className="text-fg">Map style:</b> {s.map.style_url}</p>
                <p><b className="text-fg">Attribution:</b> {s.map.attribution}</p>
                <p className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> <b className="text-fg">Asset storage:</b> {s.storage.backend}</p>
              </ServiceCard>
            </motion.div>
          </motion.div>
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer font-semibold text-fg">What the technical status words mean</summary>
            <div className="mt-2 flex flex-wrap gap-3">
              {Object.entries(legend).map(([k, v]) => (
                <span key={k}>
                  <b className="text-fg">{humanize(k)}</b> = {v}
                </span>
              ))}
            </div>
          </details>

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
