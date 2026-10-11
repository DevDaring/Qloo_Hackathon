import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clapperboard,
  Copy,
  Download,
  Film,
  ImagePlus,
  Languages,
  Layers,
  ListChecks,
  Palette,
  Plus,
  RefreshCw,
  Route,
  Save,
  ScanEye,
  ThumbsDown,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import { ApiError, downloadUrl } from '../api/client';
import { mutations, useApiMutation, useBrief, useBriefs, useEstimate, useProduct, useProviders, useStrategies } from '../api/hooks';
import type { ApprovalState, Asset, AssetQuality, BriefDetail, BriefListItem, Orientation, Preset } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { ActionPreview } from '../components/ActionPreview';
import { InteractiveMedia } from '../components/InteractiveMedia';
import { EvidenceBadge, EvidenceChip } from '../components/Evidence';
import { JobCard } from '../components/JobCard';
import { PilotCard, WhyThisMessage } from '../components/CreativeTrace';
import { Editable, LockNote, useLocked } from '../components/Locked';
import { Modal } from '../components/Overlay';
import { useProjectCtx } from '../components/ProjectContext';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SkeletonCard,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui';
import { VideoPlayer } from '../components/VideoPlayer';
import { cn, fmtUsd, humanize, timeAgo } from '../lib/format';
import { angleOptions, LANG_LABEL, PRESETS } from '../lib/labels';

const TRANSLATION: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'accent' }> = {
  source: { label: 'Source language', tone: 'neutral' },
  machine_translated_needs_review: { label: 'Machine-translated · needs review', tone: 'warn' },
  reviewed_by_owner: { label: 'Translation reviewed', tone: 'ok' },
  owner_edited: { label: 'Owner-edited copy', tone: 'accent' },
};
const APPROVAL_TONE: Record<string, 'ok' | 'bad' | 'accent' | 'neutral'> = { approved: 'ok', rejected: 'bad', needs_review: 'accent', draft: 'neutral' };

function latest(assets: Asset[], kind: string, preset?: string) {
  return assets
    .filter((a) => a.kind === kind && (!preset || a.preset === preset))
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
}

export default function AdStudio() {
  const { pid, sel } = useProjectCtx();
  const q = useBriefs(pid);
  const [params, setParams] = useSearchParams();
  const items = q.data?.items ?? [];
  // default: a brief in the working context, preferring one that already has a flyer to look at
  const inCtx = items.filter((b) => (!sel.areaId || b.area_id === sel.areaId) && (!sel.audienceId || b.audience_version_id === sel.audienceId));
  const ctxBrief = (inCtx.find((b) => !b.stale && b.assets.some((a) => a.kind === 'flyer')) ?? inCtx[0])?.id;
  const bid = params.get('b') && items.some((b) => b.id === params.get('b')) ? params.get('b')! : ctxBrief ?? items[0]?.id;
  const [newOpen, setNewOpen] = useState(false);
  return (
    <PageWrap className="max-w-[1600px]">
      <PageHeader
        eyebrow="Create"
        title="Ad studio"
        description="Audience-specific flyers and videos. Copy is rendered deterministically on top of Grok Imagine imagery (via NanoGPT), checked for quality and claims, and never auto-approved."
        actions={
          <Editable note>
            <Button variant="brand" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
              New brief from strategy
            </Button>
          </Editable>
        }
      />
      {q.isLoading && (
        <div className="space-y-4">
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-64" />
            ))}
          </div>
          <Skeleton className="h-[520px] w-full" />
        </div>
      )}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <EmptyState icon={<WandSparkles className="h-5 w-5" />} title="No creative briefs yet" action={<Editable note><Button onClick={() => setNewOpen(true)}>Create a brief</Button></Editable>}>
          Briefs are drafted by the workflow after strategies are written, or you can create one from any current strategy.
        </EmptyState>
      )}
      {items.length > 0 && (
        <>
          <section aria-label="Audience variants" className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="eyebrow">Audience variants · {items.length}</p>
              <p className="text-xs text-subtle">Each variant is its own campaign identity: product version × location × audience × language × angle.</p>
            </div>
            <div className="scroll-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
              {items.map((b) => (
                <VariantCard key={b.id} b={b} active={b.id === bid} onClick={() => setParams({ b: b.id })} />
              ))}
            </div>
          </section>
          <AnimatePresence mode="wait">
            <motion.div key={bid} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {bid && <BriefWorkspace bid={bid} onSwitch={(id) => setParams({ b: id })} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
      <NewBriefModal open={newOpen} onClose={() => setNewOpen(false)} />
    </PageWrap>
  );
}

function VariantCard({ b, active, onClick }: { b: BriefListItem; active: boolean; onClick: () => void }) {
  const thumb = latest(b.assets, 'flyer') ?? latest(b.assets, 'thumbnail');
  const videos = b.assets.filter((a) => a.kind === 'video_final').length;
  const tr = TRANSLATION[b.translation_status] ?? { label: humanize(b.translation_status), tone: 'neutral' as const };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group flex w-[300px] shrink-0 gap-3 rounded-2xl border p-3 text-left transition',
        active ? 'border-brand bg-surface shadow-glow' : 'border-line bg-surface hover:-translate-y-0.5 hover:shadow-lift',
      )}
    >
      <div className="h-[88px] w-[70px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft">
        {thumb ? <img src={thumb.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Palette className="m-auto mt-8 h-5 w-5 text-brand-ink" />}
      </div>
      <div className="min-w-0 flex-1">
        <p lang={b.language} className="line-clamp-2 text-[13px] font-semibold leading-snug">{b.content.headline}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge tone="violet">{b.language.toUpperCase()}</Badge>
          {b.angle && <Badge tone="brand">{humanize(b.angle)}</Badge>}
          <Badge tone={APPROVAL_TONE[b.approval_state] ?? 'neutral'}>{humanize(b.approval_state)}</Badge>
          {b.stale && <Badge tone="warn">Stale</Badge>}
        </div>
        <p className="mt-1 truncate text-[11px] text-subtle">
          {tr.label} · {b.assets.filter((a) => a.kind === 'flyer').length} flyers · {videos} videos
        </p>
      </div>
    </button>
  );
}

type Tab = 'why' | 'copy' | 'storyboard' | 'video' | 'decisions' | 'jobs';

function BriefWorkspace({ bid, onSwitch }: { bid: string; onSwitch: (id: string) => void }) {
  const { pid } = useProjectCtx();
  const q = useBrief(bid);
  const [preset, setPreset] = useState<Preset>('square');
  const [tab, setTab] = useState<Tab>('why');
  const [imgOpen, setImgOpen] = useState<{ presets: Preset[]; regen: boolean } | null>(null);
  const [vidOpen, setVidOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const providers = useProviders().data;
  const toast = useToast();
  const approve = useApiMutation((s: ApprovalState) => mutations.approveBrief(bid, s), [['brief', bid], ['briefs', pid]]);
  const locked = useLocked();
  const imgEst = useEstimate(bid, { presets: [preset], mode: 'animatic', narration: false });
  const vidEst = useEstimate(bid, { mode: 'full', narration: false }, tab === 'video');
  if (q.isLoading) return <SkeletonCard lines={12} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data!;
  const flyer = latest(b.assets, 'flyer', preset);
  const flyerItems = PRESETS.map((p) => latest(b.assets, 'flyer', p.key))
    .filter((a): a is Asset => !!a)
    .map((a) => ({ src: a.url, alt: `${humanize(a.preset ?? 'flyer')} flyer · ${b.content.headline}`, caption: `${a.width}×${a.height} · v${a.version} · ${humanize(a.approval_state)}`, meta: 'Generated by LaunchLens' }));
  const blocked = Object.values(b.content.claim_issues ?? {}).some((v) => v.some((i) => i.severity === 'block'));
  const genBlock = b.stale ? `Brief is stale (${b.stale_reason}). Create a fresh brief first.` : blocked ? 'Remove unsupported claims from the copy first.' : providers && !providers.media.configured ? 'Image and video generation is not set up on the server.' : null;
  const tr = TRANSLATION[b.translation_status] ?? { label: humanize(b.translation_status), tone: 'neutral' as const };
  const videos = b.assets.filter((a) => a.kind === 'video_final' || a.kind === 'video_animatic');

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{b.strategy.area}</Badge>
          <Badge tone="accent">{b.strategy.audience}</Badge>
          <Badge tone="violet" icon={<Languages className="h-3 w-3" />}>{LANG_LABEL[b.language]}</Badge>
          {b.angle && <Badge>{humanize(b.angle)}</Badge>}
          <Badge>{b.channel} · {b.objective}</Badge>
          <Badge tone={tr.tone}>{tr.label}</Badge>
          <Badge tone={APPROVAL_TONE[b.approval_state] ?? 'neutral'}>Brief: {humanize(b.approval_state)}</Badge>
          <span className="text-xs text-subtle">v{b.version} · lock {b.lock_version} · {timeAgo(b.updated_at)}</span>
          {locked ? (
            <LockNote className="ml-auto">Read-only sample — approval and edits are off. Duplicate the project to edit.</LockNote>
          ) : (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => setDupOpen(true)}>
              Duplicate for another audience
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<ThumbsDown className="h-3.5 w-3.5" />}
              onClick={() => approve.mutate('rejected', { onSuccess: () => toast.info('Brief rejected'), onError: (e) => toast.error('Could not update', e) })}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<BadgeCheck className="h-3.5 w-3.5" />}
              loading={approve.isPending}
              onClick={() =>
                approve.mutate('approved', {
                  onSuccess: () => toast.success('Brief approved', b.language !== 'en' ? 'Approving also marks the translation as reviewed by you.' : undefined),
                  onError: (e) => toast.error('Could not approve', e),
                })
              }
            >
              Approve brief
            </Button>
          </div>
          )}
        </div>
        {b.stale && (
          <Callout tone="warn" className="mt-3" icon={<AlertTriangle className="h-4 w-4 text-warn" />}>
            Stale: {b.stale_reason}. Generation is disabled for stale briefs.
          </Callout>
        )}
        {b.strategy.stale && <p className="mt-2 text-xs text-warn">The strategy behind this brief is stale.</p>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]" data-tour="studio">
        {/* canvas */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <Tabs<Preset>
                size="sm"
                value={preset}
                onChange={setPreset}
                tabs={PRESETS.map((p) => ({ key: p.key, label: `${p.label} ${p.w}×${p.h}`, count: b.assets.filter((a) => a.kind === 'flyer' && a.preset === p.key).length || undefined }))}
              />
              <div className="ml-auto flex gap-2">
                {flyer && (
                  <a href={downloadUrl(flyer.id, true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-surface2">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                )}
              </div>
            </div>
            <div className="relative flex min-h-[420px] items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgb(var(--primary)/0.10),transparent_50%),radial-gradient(circle_at_80%_80%,rgb(var(--secondary)/0.10),transparent_50%)] p-6">
              <div className="grid-bg absolute inset-0 opacity-50" aria-hidden />
              <AnimatePresence mode="wait">
                {flyer ? (
                  <motion.div
                    key={flyer.id}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn('relative w-full', preset === 'vertical' ? 'max-w-[320px]' : preset === 'portrait' ? 'max-w-[400px]' : 'max-w-[460px]')}
                  >
                    <InteractiveMedia
                      items={flyerItems}
                      index={Math.max(0, flyerItems.findIndex((x) => x.src === flyer.url))}
                      aspect={preset === 'vertical' ? 'aspect-[9/16]' : preset === 'portrait' ? 'aspect-[4/5]' : 'aspect-square'}
                      frameClassName="shadow-lift"
                      showCaption={false}
                    />
                  </motion.div>
                ) : (
                  <motion.div key={`mock-${preset}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative w-full max-w-[360px]">
                    <MockFlyer b={b} preset={preset} />
                    <p className="mt-3 text-center text-xs text-muted">Layout preview from the brief copy — not a generated asset.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
              {flyer ? (
                <>
                  <Badge tone={APPROVAL_TONE[flyer.approval_state] ?? 'neutral'}>{humanize(flyer.approval_state)}</Badge>
                  {flyer.stale && <Badge tone="warn">Stale</Badge>}
                  <span className="text-xs text-subtle">
                    v{flyer.version} · {flyer.width}×{flyer.height} · {timeAgo(flyer.created_at)}
                  </span>
                  <AssetApproval asset={flyer} />
                </>
              ) : (
                <span className="text-xs text-muted">No {preset} flyer yet.</span>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <ActionPreview
                  tipKey="regenerate-background"
                  disabledReason={genBlock ?? (!flyer ? 'Generate this format once before regenerating its background.' : undefined)}
                  inlineReason={false}
                  edit
                >
                  <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={!!genBlock || !flyer} onClick={() => setImgOpen({ presets: [preset], regen: true })}>
                    Regenerate background
                  </Button>
                </ActionPreview>
                <ActionPreview
                  tipKey="generate-flyers"
                  extra={`Format: ${preset}.${imgEst.data ? ` Current estimate ≤ ${imgEst.data.images.usd === 'unknown' ? 'unknown' : `$${Number(imgEst.data.images.usd).toFixed(3)}`}.` : ''}`}
                  title="Generate flyers"
                  details={
                    <>
                      <p>Creates the selected format: a Grok Imagine background with the real product photo, logo and exact copy composed on top.</p>
                      <p>
                        <b className="text-fg">Current estimate:</b> {imgEst.data ? (imgEst.data.images.usd === 'unknown' ? 'unknown' : `≤ $${Number(imgEst.data.images.usd).toFixed(3)} for ${imgEst.data.images.count} image(s)`) : '…'}
                        {imgEst.data && <span className="block text-xs text-subtle">Source: {imgEst.data.images.source}</span>}
                      </p>
                      <p>Every result is checked automatically and needs your review before approval. Clicking opens the cost review with a spending cap — nothing is spent until you confirm.</p>
                    </>
                  }
                  disabledReason={genBlock ?? undefined}
                  edit
                >
                  <Button size="sm" variant="brand" icon={<ImagePlus className="h-3.5 w-3.5" />} disabled={!!genBlock} onClick={() => setImgOpen({ presets: [preset], regen: false })}>
                    Generate {flyer ? 'again' : preset}
                  </Button>
                </ActionPreview>
              </div>
            </div>
          </Card>
          <PilotCard bid={b.id} />
          {flyer && <QualityPanel q={flyer.quality} />}
        </div>

        {/* side panel */}
        <div className="min-w-0">
          <Tabs<Tab>
            className="mb-4"
            size="sm"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'why', label: 'Why this message?', icon: <Route className="h-3.5 w-3.5" />, tip: 'why-message' },
              { key: 'copy', label: 'Copy', icon: <Palette className="h-3.5 w-3.5" /> },
              { key: 'storyboard', label: 'Storyboard', icon: <Layers className="h-3.5 w-3.5" />, count: b.storyboard?.scenes.length },
              { key: 'video', label: 'Video', icon: <Film className="h-3.5 w-3.5" />, count: videos.length },
              { key: 'decisions', label: 'Decisions', icon: <ListChecks className="h-3.5 w-3.5" />, count: b.decisions.length },
              { key: 'jobs', label: 'Jobs', icon: <Clapperboard className="h-3.5 w-3.5" />, count: b.jobs.length },
            ]}
          />
          {tab === 'why' && <WhyThisMessage bid={b.id} onSwitch={onSwitch} />}
          {tab === 'copy' && <CopyForm b={b} onSaved={onSwitch} />}
          {tab === 'storyboard' && <Storyboard b={b} />}
          {tab === 'video' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <ActionPreview
                  tipKey="generate-video"
                  extra={vidEst.data ? `Current estimate ≈ ${vidEst.data.video.clips_list_usd === 'unknown' ? 'unknown' : `$${(Number(vidEst.data.video.frames_usd) + Number(vidEst.data.video.clips_list_usd)).toFixed(2)}`}.` : undefined}
                  title="Generate video"
                  details={
                    <>
                      <p>Creates the selected formats: Grok Imagine clips for each storyboard scene, assembled into vertical and landscape MP4s with captions and a product end card.</p>
                      {vidEst.data && (
                        <p>
                          <b className="text-fg">Current estimate:</b> frames {vidEst.data.video.frames_usd === 'unknown' ? 'unknown' : `$${Number(vidEst.data.video.frames_usd).toFixed(3)}`} + clips{' '}
                          {vidEst.data.video.clips_list_usd === 'unknown' ? 'unknown' : `$${Number(vidEst.data.video.clips_list_usd).toFixed(3)}`} ({vidEst.data.video.generated_seconds}s).{' '}
                          <span className="block text-xs text-subtle">Held against your cap: {vidEst.data.video.clips_held_usd === 'unknown' ? 'unknown' : `$${Number(vidEst.data.video.clips_held_usd).toFixed(3)}`} for clips (headroom).</span>
                        </p>
                      )}
                      <p>Videos need your review before approval; an animatic draft is never presented as generated video. Clicking opens the cost review — nothing is spent until you confirm.</p>
                    </>
                  }
                  disabledReason={genBlock ?? (!b.storyboard ? 'This brief has no storyboard yet.' : undefined)}
                  edit
                >
                  <Button variant="brand" icon={<Clapperboard className="h-4 w-4" />} disabled={!!genBlock || !b.storyboard} onClick={() => setVidOpen(true)}>
                    Generate video…
                  </Button>
                </ActionPreview>
                <span className="text-xs text-muted">Animatic drafts are stills only and are never presented as generated video.</span>
              </div>
              <VideoList assets={videos} lang={b.language} />
            </div>
          )}
          {tab === 'decisions' && (
            <Card>
              <ul className="divide-y divide-line">
                {b.decisions.map((d, i) => (
                  <li key={i} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <EvidenceBadge kind={d.kind === 'evidence' ? 'derived_metric' : d.kind === 'owner_edit' ? 'owner_fact' : 'hypothesis'} badge={d.kind === 'evidence' ? 'Supported' : d.kind === 'owner_edit' ? 'Owner-provided' : 'Hypothesis'} />
                      <span className="text-sm font-semibold">{d.decision}</span>
                      <EvidenceChip ids={d.evidence_ids} title={d.decision} className="ml-auto" />
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{d.rationale}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {tab === 'jobs' && (
            <div className="space-y-3">
              {b.jobs.length === 0 && <EmptyState title="No generation jobs for this brief" />}
              {b.jobs.map((j) => (
                <JobCard key={j.id} job={j} pid={pid} />
              ))}
            </div>
          )}
        </div>
      </div>
      <ImagesDialog b={b} state={imgOpen} onClose={() => setImgOpen(null)} onQueued={() => setTab('jobs')} />
      <VideoDialog b={b} open={vidOpen} onClose={() => setVidOpen(false)} onQueued={() => setTab('jobs')} />
      <DuplicateModal b={b} open={dupOpen} onClose={() => setDupOpen(false)} />
    </div>
  );
}

function MockFlyer({ b, preset }: { b: BriefDetail; preset: Preset }) {
  const ratio = preset === 'square' ? 'aspect-square' : preset === 'portrait' ? 'aspect-[4/5]' : 'aspect-[9/16]';
  return (
    <div lang={b.language} className={cn('relative mx-auto overflow-hidden rounded-xl border border-dashed border-line bg-gradient-to-br from-[#1F2A44] via-[#24345C] to-[#0E1320] p-5 text-white shadow-card', ratio, preset === 'vertical' && 'max-w-[260px]')}>
      <div className="absolute -right-10 bottom-0 h-1/2 w-2/3 rounded-tl-[80px] bg-white/10" />
      <p className="relative font-display text-lg font-bold leading-tight">{b.content.headline}</p>
      <p className="relative mt-2 text-[12px] leading-snug text-white/80">{b.content.body}</p>
      {b.content.price_text && <p className="relative mt-2 text-sm font-bold text-[#FFB088]">{b.content.price_text}</p>}
      <span className="absolute bottom-5 left-5 rounded-lg bg-[#FF7A45] px-3 py-1.5 text-xs font-bold text-[#1A0E08]">{b.content.cta}</span>
      {b.content.disclaimer && <p className="absolute bottom-1.5 left-5 right-5 text-[9px] text-white/60">{b.content.disclaimer}</p>}
    </div>
  );
}

function AssetApproval({ asset }: { asset: Asset }) {
  const { pid } = useProjectCtx();
  const locked = useLocked();
  const toast = useToast();
  const m = useApiMutation((s: ApprovalState) => mutations.setApproval(asset.id, s), [['brief'], ['briefs', pid], ['assets', pid]]);
  const set = (s: ApprovalState) =>
    m.mutate(s, {
      onSuccess: () => toast.success(`Asset marked ${humanize(s).toLowerCase()}`),
      onError: (e) =>
        toast.error(
          'Could not change approval',
          e instanceof ApiError && e.code === 'unresolved_quality' ? new Error('This asset has unresolved quality or fidelity findings, so it stays a draft. Fix and regenerate first.') : e,
        ),
    });
  if (locked) return null;
  return (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="ghost" onClick={() => set('approved')} loading={m.isPending && m.variables === 'approved'} icon={<CheckCircle2 className="h-3.5 w-3.5 text-ok" />}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => set('rejected')} icon={<XCircle className="h-3.5 w-3.5 text-bad" />}>
        Reject
      </Button>
    </span>
  );
}

export function QualityPanel({ q }: { q: AssetQuality | null }) {
  if (!q) return null;
  const rows: { label: string; ok: boolean | null | undefined; detail: string }[] = [];
  if (q.dimensions) rows.push({ label: 'Dimensions', ok: q.dimensions.ok, detail: `${q.dimensions.actual.join('×')} (expected ${q.dimensions.expected.join('×')})` });
  if ('text_overflow' in q) rows.push({ label: 'Text overflow', ok: !q.text_overflow, detail: q.text_overflow ? Object.keys(q.text_overflow).join(', ') : 'All copy fits its box' });
  if (q.contrast)
    rows.push({
      label: 'Contrast',
      ok: q.contrast_ok,
      detail: `headline ${q.contrast.headline?.toFixed(1)}:1 · body ${q.contrast.body?.toFixed(1)}:1 · CTA ${q.contrast.cta?.toFixed(1)}:1 (≥3 / 4.5 / 3)`,
    });
  if ('safe_area_ok' in q) rows.push({ label: 'Safe area', ok: q.safe_area_ok, detail: q.safe_area_ok ? 'Text, logo and price inside safe margins' : 'Element outside safe area' });
  if (q.product) {
    const p = q.product as { aspect_preserved?: boolean; aspect_source?: number; aspect_rendered?: number; cutout?: { method?: string; reliable?: boolean } };
    rows.push({ label: 'Product aspect preserved', ok: p.aspect_preserved, detail: `source ${p.aspect_source} → rendered ${p.aspect_rendered}${p.cutout ? ` · cutout ${p.cutout.method}${p.cutout.reliable ? '' : ' (unreliable)'}` : ''}` });
  }
  if (q.text_rendering) rows.push({ label: 'Script shaping', ok: q.text_rendering.complex_script_shaping, detail: `${q.text_rendering.engine} engine · deterministic typography` });
  const claims = q.claims && !Array.isArray(q.claims) ? Object.values(q.claims).flat() : (q.claims as unknown[] | null) ?? [];
  rows.push({ label: 'Claims', ok: claims.length === 0, detail: claims.length ? `${claims.length} issue(s)` : 'Only approved claims used' });
  const br = q.background_review;
  rows.push({ label: 'Background review', ok: br ? br.passed : null, detail: br ? (br.flags.length ? `Flags: ${br.flags.join(', ')}` : br.notes || 'No flags') : 'Not reviewed yet (runs in the quality reviewer)' });
  return (
    <Card>
      <CardHeader icon={<ScanEye className="h-4 w-4" />} title="Quality checks" subtitle="Computed on the rendered pixels. Any failure keeps the asset a draft." action={<Badge tone={q.passed ? 'ok' : q.passed === false ? 'bad' : 'neutral'}>{q.passed ? 'Passed' : q.passed === false ? 'Failed' : 'Pending'}</Badge>} />
      <ul className="grid gap-x-6 gap-y-0 p-4 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2.5 border-b border-line/60 py-2.5 last:border-0">
            {r.ok === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : r.ok === false ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-dashed border-subtle" />}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{r.label}</p>
              <p className="text-xs text-muted">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const LIMITS = { headline: 90, body: 260, cta: 40, disclaimer: 160, price_text: 40, setting: 400, visual_direction: 600, background_prompt: 1200, mood: 200 } as const;
type CopyKey = keyof typeof LIMITS;

function CopyForm({ b, onSaved }: { b: BriefDetail; onSaved: (id: string) => void }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const init = () => Object.fromEntries((Object.keys(LIMITS) as CopyKey[]).map((k) => [k, String(b.content[k] ?? '')])) as Record<CopyKey, string>;
  const [f, setF] = useState(init);
  const [conflict, setConflict] = useState(false);
  useEffect(() => setF(init()), [b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = (Object.keys(LIMITS) as CopyKey[]).filter((k) => f[k] !== String(b.content[k] ?? ''));
  const save = useApiMutation(
    () => mutations.editBrief(b.id, { lock_version: b.lock_version, ...Object.fromEntries(changed.map((k) => [k, f[k]])) }),
    [['briefs', pid], ['brief']],
  );
  const issues = Object.entries(b.content.claim_issues ?? {}).filter(([, v]) => v.length);
  const field = (k: CopyKey, label: string, rows = 1) => (
    <Field
      label={
        <span className="flex w-full justify-between">
          {label}
          <span className={cn('num text-[11px] font-normal', f[k].length > LIMITS[k] ? 'text-bad' : 'text-subtle')}>
            {f[k].length}/{LIMITS[k]}
          </span>
        </span>
      }
    >
      {rows > 1 ? (
        <Textarea lang={['headline', 'body', 'cta', 'disclaimer'].includes(k) ? b.language : undefined} rows={rows} value={f[k]} invalid={f[k].length > LIMITS[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <Input lang={['headline', 'body', 'cta', 'disclaimer'].includes(k) ? b.language : undefined} value={f[k]} invalid={f[k].length > LIMITS[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <Card className="p-5">
      {conflict && (
        <Callout
          tone="warn"
          className="mb-4"
          title="Someone else changed this brief"
          action={
            <Button size="sm" variant="outline" onClick={() => (setConflict(false), setF(init()))}>
              Reload latest
            </Button>
          }
        >
          Your edits were not saved to avoid overwriting theirs. Reload to see the latest version, then re-apply your changes.
        </Callout>
      )}
      {issues.length > 0 && (
        <Callout tone="bad" className="mb-4" title="Claim issues">
          <ul className="list-disc pl-5 text-xs">
            {issues.map(([k, v]) => v.map((i, n) => <li key={k + n}><b>{k}:</b> {i.message ?? i.rule ?? JSON.stringify(i)}</li>))}
          </ul>
        </Callout>
      )}
      <TranslationReview b={b} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field('headline', 'Headline')}</div>
        <div className="sm:col-span-2">{field('body', 'Body', 3)}</div>
        {field('cta', 'Call to action')}
        {field('price_text', 'Price text')}
        <div className="sm:col-span-2">{field('disclaimer', 'Disclaimer')}</div>
        <div className="sm:col-span-2">
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Visual direction (creative hypotheses)</summary>
            <div className="mt-3 grid gap-4">
              {field('setting', 'Setting', 2)}
              {field('visual_direction', 'Visual direction', 2)}
              {field('mood', 'Mood')}
              {field('background_prompt', 'Background prompt', 3)}
            </div>
          </details>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-muted">Saving creates brief v{b.version + 1}. A copy edit re-composes media only — research and strategy are untouched.</p>
        <Editable note>
        <Button
          variant="brand"
          icon={<Save className="h-4 w-4" />}
          disabled={!changed.length || changed.some((k) => f[k].length > LIMITS[k])}
          loading={save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: (r) => {
                toast.success(`Saved brief v${r.brief.version}`, 'Existing flyers built on the old copy are marked stale.');
                onSaved(r.brief.id);
              },
              onError: (e) => {
                if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true);
                else toast.error('Could not save copy', e);
              },
            })
          }
        >
          Save copy
        </Button>
        </Editable>
      </div>
    </Card>
  );
}

function TranslationReview({ b }: { b: BriefDetail }) {
  const c = b.content;
  const r = c.copy_review;
  const nonEn = b.language !== 'en';
  if (!nonEn && !r) return null;
  const issues = r?.issues ?? [];
  const needsReview = b.translation_status === 'machine_translated_needs_review';
  const fallback = c.translation_fallback_fields ?? [];
  const Flag = ({ ok, label }: { ok: boolean | null | undefined; label: string }) => (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', ok === true ? 'text-ok' : ok === false ? 'text-bad' : 'text-subtle')}>
      {ok === true ? <CheckCircle2 className="h-3.5 w-3.5" /> : ok === false ? <XCircle className="h-3.5 w-3.5" /> : <span className="h-3 w-3 rounded-full border-2 border-dashed border-current" />}
      {label}
    </span>
  );
  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface2/50 p-4" data-testid="translation-review">
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold">{nonEn ? 'Translation review' : 'Copy review'}</span>
        {nonEn && needsReview && <Badge tone="warn">Machine translation — needs review</Badge>}
        {nonEn && !needsReview && <Badge tone={b.translation_status === 'reviewed_by_owner' ? 'ok' : 'accent'}>{TRANSLATION[b.translation_status]?.label ?? humanize(b.translation_status)}</Badge>}
        {c.translation_model && <Badge tone="violet">{c.translation_model}</Badge>}
        {r?.model && <Badge>review: {r.model}</Badge>}
      </div>
      {r && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Flag ok={r.spelling_and_grammar_ok} label="Spelling & grammar" />
          {nonEn && <Flag ok={r.meaning_preserved} label="Meaning preserved" />}
          <span className="text-xs text-subtle">{issues.length} issue{issues.length === 1 ? '' : 's'} found</span>
        </div>
      )}
      {fallback.length > 0 && (
        <p className="mt-2 text-xs text-warn">Translation fell back to another provider for: {fallback.join(', ')}.</p>
      )}
      {issues.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {issues.map((i, n) => (
            <li key={n} className="rounded-lg border border-warn/30 bg-warn-soft/50 px-3 py-2 text-xs">
              <b>{humanize(i.field ?? 'copy')}:</b> {i.issue}
              {i.suggestion && <span className="mt-0.5 block text-muted" lang={b.language}>Suggestion: {i.suggestion}</span>}
            </li>
          ))}
        </ul>
      )}
      {nonEn && (
        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          {c.source_copy && (
            <div>
              <p className="eyebrow mb-1">English source</p>
              <p className="font-semibold">{c.source_copy.headline}</p>
              <p className="text-muted">{c.source_copy.body}</p>
            </div>
          )}
          {(c.back_translation?.headline || r?.back_translation) && (
            <div>
              <p className="eyebrow mb-1">Back-translation (to English)</p>
              {c.back_translation?.headline && <p className="font-semibold">{c.back_translation.headline}</p>}
              {r?.back_translation && <p className="text-muted">{r.back_translation}</p>}
            </div>
          )}
        </div>
      )}
      {nonEn && needsReview && <p className="mt-3 text-[11.5px] text-subtle">Approving the brief records that you reviewed the translation. Edit any field above to correct it.</p>}
    </div>
  );
}

function Storyboard({ b }: { b: BriefDetail }) {
  const sb = b.storyboard;
  if (!sb) return <EmptyState title="No storyboard for this brief" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge>{sb.total_seconds}s total</Badge>
        <Badge>{sb.aspect_ratio}</Badge>
        <Badge>Audio: {String(sb.audio_plan?.default ?? 'unknown').replace(/_/g, ' ')}</Badge>
        <span>Generated scenes never depict the product; the real product photo is composited as overlay and end card.</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface2" aria-hidden>
        {sb.scenes.map((s, i) => (
          <span key={s.id} style={{ width: `${(s.duration_s / Math.max(1, sb.total_seconds)) * 100}%`, background: s.kind === 'end_card' ? '#9AA1B2' : ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'][i % 4] }} className="border-r-2 border-surface" />
        ))}
      </div>
      {sb.scenes.map((s) => (
        <SceneEditor key={s.id} s={s} lang={b.language} />
      ))}
    </div>
  );
}

function SceneEditor({ s, lang }: { s: NonNullable<BriefDetail['storyboard']>['scenes'][number]; lang: string }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [f, setF] = useState({ shot_description: s.shot_description, duration_s: String(s.duration_s), spoken_copy: s.spoken_copy, on_screen_text: s.on_screen_text });
  const dirty = f.shot_description !== s.shot_description || Number(f.duration_s) !== s.duration_s || f.spoken_copy !== s.spoken_copy || f.on_screen_text !== s.on_screen_text;
  const save = useApiMutation(
    () =>
      mutations.editScene(s.id, {
        shot_description: f.shot_description !== s.shot_description ? f.shot_description : undefined,
        duration_s: Number(f.duration_s) !== s.duration_s ? Number(f.duration_s) : undefined,
        spoken_copy: f.spoken_copy !== s.spoken_copy ? f.spoken_copy : undefined,
        on_screen_text: f.on_screen_text !== s.on_screen_text ? f.on_screen_text : undefined,
      }),
    [['brief'], ['briefs', pid]],
  );
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-display text-xs font-bold text-white dark:bg-white dark:text-[#0E1320]">{s.idx + 1}</span>
        <span className="text-sm font-semibold">{s.purpose}</span>
        <Badge>{s.kind === 'end_card' ? 'Product end card' : 'Generated clip'}</Badge>
        <Badge tone={s.status === 'completed' || s.clip_asset_id ? 'ok' : 'neutral'}>{s.clip_asset_id ? 'clip ready' : humanize(s.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
        <Field label="Shot description">
          <Textarea rows={2} value={f.shot_description} onChange={(e) => setF({ ...f, shot_description: e.target.value })} disabled={s.kind === 'end_card'} />
        </Field>
        <Field label="Duration (3–8 s)">
          <Input type="number" min={3} max={8} value={f.duration_s} onChange={(e) => setF({ ...f, duration_s: e.target.value })} />
        </Field>
        <Field label="Spoken copy">
          <Textarea lang={lang} rows={2} value={f.spoken_copy} onChange={(e) => setF({ ...f, spoken_copy: e.target.value })} />
        </Field>
        <Field label="On-screen text">
          <Textarea lang={lang} rows={2} value={f.on_screen_text} onChange={(e) => setF({ ...f, on_screen_text: e.target.value })} />
        </Field>
      </div>
      {dirty && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {f.shot_description !== s.shot_description || Number(f.duration_s) !== s.duration_s ? 'Visual change: this scene’s clip must be regenerated; others are reused.' : 'Caption/narration change: re-assembly only, no new generation.'}
          </p>
          <Editable>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (r) => toast.success('Scene saved', r.note), onError: (e) => toast.error('Could not save scene', e) })}>
            Save scene
          </Button>
          </Editable>
        </div>
      )}
    </Card>
  );
}

function VideoList({ assets, lang }: { assets: Asset[]; lang: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, Asset[]>();
    assets.forEach((a) => m.set(`${a.kind}:${a.preset}`, [...(m.get(`${a.kind}:${a.preset}`) ?? []), a]));
    return Array.from(m.values()).map((xs) => xs.sort((a, b) => b.version - a.version));
  }, [assets]);
  if (!assets.length) return <EmptyState icon={<Film className="h-5 w-5" />} title="No videos for this brief yet">Generate a full video (vertical and landscape) or a cheap animatic draft first.</EmptyState>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((xs) => (
        <div key={xs[0].id}>
          <VideoPlayer asset={xs[0]} lang={lang} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <a className="link inline-flex items-center gap-1" href={downloadUrl(xs[0].id, true)}>
              <Download className="h-3.5 w-3.5" /> MP4
            </a>
            {xs.length > 1 && <span className="text-subtle">{xs.length - 1} earlier version{xs.length > 2 ? 's' : ''} kept</span>}
            <AssetApproval asset={xs[0]} />
          </div>
        </div>
      ))}
    </div>
  );
}

function usd(v?: string | null, d = 3) {
  return !v || v === 'unknown' ? 'unknown' : fmtUsd(v, d);
}

function EstimateNotes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11.5px] text-subtle">{notes.map((n) => <li key={n}>{n}</li>)}</ul>;
}

/** Click-to-set focal point for the crop of one preset (x, y in 0..1). */
function FocalPicker({ src, value, onChange, preset }: { src: string; value?: { x: number; y: number }; onChange: (v: { x: number; y: number } | undefined) => void; preset: Preset }) {
  const p = PRESETS.find((x) => x.key === preset)!;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold">{p.label} crop focus</span>
        {value ? (
          <button className="text-muted hover:text-fg" onClick={() => onChange(undefined)}>
            Reset to centre
          </button>
        ) : (
          <span className="text-subtle">centre (default)</span>
        )}
      </div>
      <button
        type="button"
        className="relative mt-1.5 block w-full overflow-hidden rounded-xl border border-line"
        aria-label={`Set ${p.label} crop focal point: click on the background`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onChange({ x: +((e.clientX - r.left) / r.width).toFixed(3), y: +((e.clientY - r.top) / r.height).toFixed(3) });
        }}
      >
        <img src={src} alt="" className="block max-h-44 w-full object-cover" />
        {value && (
          <span className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#FF7A45]/70 shadow-lg" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }} />
        )}
      </button>
    </div>
  );
}

function ImagesDialog({ b, state, onClose, onQueued }: { b: BriefDetail; state: { presets: Preset[]; regen: boolean } | null; onClose: () => void; onQueued: () => void }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [presets, setPresets] = useState<Preset[]>(['square']);
  const [cap, setCap] = useState('0.5');
  const [regen, setRegen] = useState(false);
  const [ack, setAck] = useState(false);
  const [focus, setFocus] = useState<Partial<Record<Preset, { x: number; y: number }>>>({});
  useEffect(() => {
    if (state) {
      setPresets(state.presets);
      setRegen(state.regen);
      setAck(false);
      setFocus({});
    }
  }, [state]);
  const est = useEstimate(b.id, { presets, mode: 'animatic', narration: false }, !!state && presets.length > 0);
  const bg = latest(b.assets, 'background');
  const capN = Number(cap);
  const capOk = capN > 0 && capN <= 20;
  const estUsd = Number(est.data?.images.usd);
  const gen = useApiMutation(
    () =>
      mutations.genImages(b.id, {
        presets,
        cap_usd: capN,
        regenerate_background: regen,
        ...(Object.keys(focus).length ? { crop_focus: focus as Record<string, { x: number; y: number }> } : {}),
      }),
    [['brief', b.id], ['briefs', pid], ['jobs', pid]],
  );
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      size="lg"
      icon={<ImagePlus className="h-4 w-4" />}
      title={regen ? 'Regenerate background' : 'Generate flyers'}
      description="Backgrounds come from Grok Imagine via NanoGPT; the real product photo, logo and exact copy are composited deterministically afterwards."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!presets.length || !capOk || !ack}
            loading={gen.isPending}
            onClick={() =>
              gen.mutate(undefined, {
                onSuccess: (r) => {
                  toast.success(r.created ? 'Image job queued' : 'Same job already exists', `Server estimate at queue time: ${usd(r.estimate.usd)}. ${r.estimate.note}`);
                  onClose();
                  onQueued();
                },
                onError: (e) => toast.error('Could not queue generation', e),
              })
            }
          >
            Spend up to {capOk ? fmtUsd(capN) : '…'} &amp; generate
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <Field label="Presets">
            <div className="flex flex-wrap gap-4">
              {PRESETS.map((p) => (
                <Checkbox key={p.key} checked={presets.includes(p.key)} onChange={(v) => setPresets((x) => (v ? [...x, p.key] : x.filter((y) => y !== p.key)))} label={`${p.label} ${p.w}×${p.h}`} />
              ))}
            </div>
          </Field>
          <Toggle checked={regen} onChange={setRegen} label="Regenerate background only" description="Forces a fresh background; copy, product and layout are preserved." />
          {bg && presets.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted">Optional: click the current background to choose what each crop keeps in frame.</p>
              {presets.map((p) => (
                <FocalPicker key={p} preset={p} src={bg.url} value={focus[p]} onChange={(v) => setFocus((f) => { const n = { ...f }; if (v) n[p] = v; else delete n[p]; return n; })} />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface2/60 p-4 text-sm" aria-live="polite" data-testid="image-estimate">
            <p className="eyebrow mb-1.5">Estimate before you confirm</p>
            {est.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : est.error ? (
              <ErrorState error={est.error} compact />
            ) : est.data ? (
              <>
                <p>
                  {est.data.images.count} background{est.data.images.count === 1 ? '' : 's'} · <b className="num font-display text-lg">≤ {usd(est.data.images.usd)}</b>
                </p>
                <p className="text-xs text-muted">
                  {est.data.images.model} · source: {est.data.images.source}
                </p>
                <EstimateNotes notes={est.data.notes} />
              </>
            ) : null}
          </div>
          <Field label="Spending cap (USD, max 20)" required error={!capOk ? 'Enter a cap between 0.01 and 20.' : undefined}>
            <Input type="number" min={0.01} max={20} step={0.1} value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          {capOk && Number.isFinite(estUsd) && estUsd > capN && <Callout tone="warn" className="text-xs">The estimate exceeds your cap — generation stops when the cap is reached.</Callout>}
          <Checkbox checked={ack} onChange={setAck} label={<span className="text-[13px]">I confirm this may spend real money on image and video generation, up to the cap.</span>} />
        </div>
      </div>
    </Modal>
  );
}

function VideoDialog({ b, open, onClose, onQueued }: { b: BriefDetail; open: boolean; onClose: () => void; onQueued: () => void }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [orients, setOrients] = useState<Orientation[]>(['vertical', 'landscape']);
  const [mode, setMode] = useState<'full' | 'animatic'>('full');
  const [cap, setCap] = useState('2');
  const [narration, setNarration] = useState(false);
  const [scene, setScene] = useState('');
  const [regen, setRegen] = useState(false);
  const [ack, setAck] = useState(false);
  const capN = Number(cap);
  const capOk = capN > 0 && capN <= 30;
  const est = useEstimate(b.id, { mode, only_scene: scene === '' ? null : Number(scene), narration }, open);
  const v = est.data?.video;
  const listTotal = v && v.frames_usd !== 'unknown' && v.clips_list_usd !== 'unknown' ? Number(v.frames_usd) + Number(v.clips_list_usd) : null;
  const heldTotal = v && v.frames_usd !== 'unknown' && v.clips_held_usd !== 'unknown' ? Number(v.frames_usd) + Number(v.clips_held_usd) : null;
  const gen = useApiMutation(
    () => mutations.genVideos(b.id, { orientations: orients, mode, cap_usd: capN, narration, only_scene: scene === '' ? null : Number(scene), regenerate: regen }),
    [['brief', b.id], ['briefs', pid], ['jobs', pid]],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Clapperboard className="h-4 w-4" />}
      title="Generate video"
      description="Full mode submits Grok Imagine video clips, polls them with a deadline and assembles a final MP4 with captions and a product end card."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!orients.length || !capOk || (mode === 'full' && !ack)}
            loading={gen.isPending}
            onClick={() =>
              gen.mutate(undefined, {
                onSuccess: (r) => {
                  toast.success(r.created ? 'Video job queued' : 'Same job already exists', `Server estimate at queue time: ${usd(r.estimate.usd)} for ${r.estimate.generated_seconds ?? 0}s generated.`);
                  onClose();
                  onQueued();
                },
                onError: (e) => toast.error('Could not queue video', e),
              })
            }
          >
            {mode === 'full' ? `Spend up to ${capOk ? fmtUsd(capN) : '…'} & generate` : 'Build animatic draft'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <Field label="Mode">
            <div className="grid gap-2">
              {(
                [
                  ['full', 'Full generated video', 'Real generated clips + deterministic assembly'],
                  ['animatic', 'Animatic draft', 'Stills and captions only — this is NOT a generated video'],
                ] as const
              ).map(([k, l, d]) => (
                <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={cn('rounded-xl border p-3 text-left text-xs transition', mode === k ? 'border-brand bg-brand-soft/60' : 'border-line hover:bg-surface2')}>
                  <span className="block text-sm font-semibold text-fg">{l}</span>
                  <span className="text-muted">{d}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Orientations">
            <div className="flex gap-4">
              <Checkbox checked={orients.includes('vertical')} onChange={(on) => setOrients((x) => (on ? [...x, 'vertical'] : x.filter((y) => y !== 'vertical')))} label="Vertical 9:16" />
              <Checkbox checked={orients.includes('landscape')} onChange={(on) => setOrients((x) => (on ? [...x, 'landscape'] : x.filter((y) => y !== 'landscape')))} label="Landscape 16:9" />
            </div>
          </Field>
          <Field label="Scope">
            <Select value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="">All scenes (reuses completed clips)</option>
              {b.storyboard?.scenes
                .filter((sc) => sc.kind === 'generated')
                .map((sc) => (
                  <option key={sc.id} value={sc.idx}>
                    Only scene {sc.idx + 1}: {sc.purpose.slice(0, 50)}
                  </option>
                ))}
            </Select>
          </Field>
          <Toggle checked={regen} onChange={setRegen} label="Force regeneration" description="Ignore cached clips for the chosen scope." />
          <Toggle checked={narration} onChange={setNarration} label="Narration (TTS)" description="Hindi/Bengali via Sarvam first; labelled ‘needs review’. Off = silent with captions." />
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface2/60 p-4 text-sm" aria-live="polite" data-testid="video-estimate">
            <p className="eyebrow mb-1.5">Estimate before you confirm</p>
            {est.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : est.error ? (
              <ErrorState error={est.error} compact />
            ) : v ? (
              <>
                {mode === 'animatic' ? (
                  <p className="text-muted">Animatics are assembled from stills — no video seconds are bought{v.frames_usd !== 'unknown' && Number(v.frames_usd) > 0 ? `; reference frames ≤ ${usd(v.frames_usd)}` : ''}.</p>
                ) : (
                  <dl className="space-y-1">
                    <div className="flex justify-between gap-3"><dt className="text-muted">Reference frames</dt><dd className="num">{usd(v.frames_usd)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Clips · {v.generated_seconds}s across {v.scenes} scene{v.scenes === 1 ? '' : 's'} (list price)</dt><dd className="num">{usd(v.clips_list_usd)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-line pt-1"><dt className="font-semibold">Estimate</dt><dd className="num font-display text-lg font-bold">{listTotal === null ? 'unknown' : fmtUsd(listTotal, 3)}</dd></div>
                    <div className="flex justify-between gap-3 text-xs">
                      <dt className="text-muted">Held against your cap — headroom, because observed provider charges exceeded list price</dt>
                      <dd className="num font-semibold">{usd(v.clips_held_usd)}{heldTotal !== null ? ` (+frames = ${fmtUsd(heldTotal, 3)})` : ''}</dd>
                    </div>
                  </dl>
                )}
                <p className="mt-1 text-xs text-muted">
                  {v.model} · {v.source}
                  {narration && v.narration_chars ? ` · ${v.narration_chars} narration characters` : ''}
                </p>
                <EstimateNotes notes={est.data?.notes} />
              </>
            ) : null}
          </div>
          <Field label="Spending cap (USD, max 30)" required error={!capOk ? 'Enter a cap between 0.01 and 30.' : undefined}>
            <Input type="number" min={0.01} max={30} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          {mode === 'full' && capOk && heldTotal !== null && heldTotal > capN && (
            <Callout tone="warn" className="text-xs">The held amount exceeds your cap, so some clips may not be produced. Raise the cap or narrow the scope.</Callout>
          )}
          {mode === 'full' && <Checkbox checked={ack} onChange={setAck} label={<span className="text-[13px]">I confirm this may spend real money on image and video generation, up to the cap.</span>} />}
          <Callout tone="neutral" className="text-xs">
            If native generation fails, the failure stays visible with a Retry. An animatic is never reported as a successful generated video.
          </Callout>
        </div>
      </div>
    </Modal>
  );
}

function DuplicateModal({ b, open, onClose }: { b: BriefDetail; open: boolean; onClose: () => void }) {
  const { pid } = useProjectCtx();
  const strategies = useStrategies(pid).data?.items.filter((s) => !s.stale) ?? [];
  const toast = useToast();
  const [sid, setSid] = useState('');
  const [lang, setLang] = useState<string>(b.language);
  const [angle, setAngle] = useState('');
  const angles = angleOptions(useProduct(pid).data?.current?.features);
  const dup = useApiMutation(() => mutations.duplicateBrief(b.id, { strategy_version_id: sid, language: lang as 'en', angle: angle || null }), [['briefs', pid], ['jobs', pid]]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Copy className="h-4 w-4" />}
      title="Duplicate for another audience"
      description="Creates a new campaign identity from the other audience’s strategy, so an incompatible ad is never reused."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!sid}
            loading={dup.isPending}
            onClick={() => dup.mutate(undefined, { onSuccess: () => (toast.success('Brief job queued', 'The new variant appears when the reasoning model finishes.'), onClose()), onError: (e) => toast.error('Could not duplicate', e) })}
          >
            Create variant
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Target strategy (location × audience)" required>
          <Select value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">Choose…</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === b.strategy_version_id}>
                {s.content.selected.area_name} × {s.content.selected.audience_name} (v{s.version})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language">
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              {Object.entries(LANG_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Angle">
            <Select value={angle} onChange={(e) => setAngle(e.target.value)}>
              <option value="">Default for the role</option>
              {angles.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function NewBriefModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pid } = useProjectCtx();
  const strategies = useStrategies(pid).data?.items ?? [];
  const toast = useToast();
  const [sid, setSid] = useState('');
  const [lang, setLang] = useState('en');
  const [channel, setChannel] = useState('social');
  const [angle, setAngle] = useState('');
  const angles = angleOptions(useProduct(pid).data?.current?.features);
  const create = useApiMutation(
    () => mutations.createBrief(pid, { strategy_version_id: sid, language: lang as 'en', channel: channel as 'social', objective: 'inquiries', angle: angle || null }),
    [['briefs', pid], ['jobs', pid]],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<WandSparkles className="h-4 w-4" />}
      title="New creative brief"
      description="Drafted by the reasoning model from the strategy, approved claims and enabled features — no images are generated yet."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!sid} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => (toast.success('Brief job queued', 'It appears in the variant strip when ready.'), onClose()), onError: (e) => toast.error('Could not create brief', e) })}>
            Draft brief
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Strategy" required hint="Stale strategies cannot receive new creative.">
          <Select value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">Choose…</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id} disabled={s.stale}>
                {s.content.selected.area_name} × {s.content.selected.audience_name} (v{s.version}){s.stale ? ' — stale' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Language">
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              {Object.entries(LANG_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Channel">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="social">Social</option>
              <option value="print">Print</option>
              <option value="stories">Stories</option>
            </Select>
          </Field>
          <Field label="Angle">
            <Select value={angle} onChange={(e) => setAngle(e.target.value)}>
              <option value="">Default</option>
              {angles.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-subtle">Language is your choice, never guessed from location. Hindi and Bengali copy is machine-translated and marked “needs review”.</p>
      </div>
    </Modal>
  );
}
