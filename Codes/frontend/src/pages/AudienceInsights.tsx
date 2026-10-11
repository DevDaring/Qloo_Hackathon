import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Archive, ArrowLeftRight, CircleHelp, Fingerprint, Languages, Link2, Network, Pencil, Plus, Search, UserRound, Users } from 'lucide-react';
import { ApiError, type Schemas } from '../api/client';
import { mutations, pickDefaultRun, useAnalytics, useApiMutation, useAudiences, useProviders, useRun, useRuns } from '../api/hooks';
import type { AudienceRole, AudienceWithEntities, EntityCandidate, Lang, ResolvedEntity } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { TasteProfile } from '../components/ExplorerCharts';
import { TagInput, fieldErrors } from '../components/FormBits';
import { ConfirmDialog, Modal } from '../components/Overlay';
import { useProjectCtx } from '../components/ProjectContext';
import { Editable, useLocked } from '../components/Locked';
import { TasteStory } from '../components/TasteStory';
import { AudienceCompare } from '../components/AudienceCompare';
import { useToast } from '../components/Toast';
import { Badge, Button, Callout, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonCard, Tabs, Textarea, Tooltip, fadeUp, stagger, type Tone } from '../components/ui';
import { cn, humanize } from '../lib/format';
import { LANG_LABEL, ROLE_LABEL } from '../lib/labels';

const ENTITY_TONE: Record<string, Tone> = { resolved: 'ok', proxy: 'violet', ambiguous: 'warn', pending: 'neutral', not_found: 'warn', unavailable: 'neutral' };
const shortType = (t?: string | null) => (t ? t.replace(/^urn:(entity|tag):/, '').replace(/[:_]/g, ' ') : '');
const isTag = (id?: string | null) => !!id && id.startsWith('urn:tag:');
const tagNames = (tags: unknown[]) =>
  (tags ?? [])
    .map((t) => (typeof t === 'string' ? t : (t as { name?: string })?.name))
    .filter(Boolean)
    .slice(0, 4) as string[];
const ROLE_TONE: Record<string, Tone> = { product_user: 'brand', purchaser: 'accent', institutional_buyer: 'ink', distribution_partner: 'violet' };

export default function AudienceInsights() {
  const { pid } = useProjectCtx();
  const q = useAudiences(pid);
  const providers = useProviders().data;
  const runs = useRuns(pid);
  const runId = pickDefaultRun(runs.data?.items)?.id;
  const analytics = useAnalytics(runId, {});
  const [edit, setEdit] = useState<AudienceWithEntities | 'new' | null>(null);
  const qlooOff = providers && !providers.qloo.configured;
  return (
    <PageWrap>
      <PageHeader
        eyebrow="Audiences"
        title="Audience insights"
        description="Who uses, buys, procures or distributes the product. Interests come only from voluntary inputs or research — never inferred from health, and personas are hypothetical."
        actions={
          <Editable note>
            <Button id="new-audience" variant="brand" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>
              New audience
            </Button>
          </Editable>
        }
      />
      {qlooOff && (
        <Callout tone="warn" className="mb-6" icon={<Fingerprint className="h-4 w-4 text-warn" />} title="Qloo is not configured — interests cannot be resolved to Qloo entities">
          {providers?.qloo.message} Interests stay listed but unresolved, and taste signals show as Unknown. Add <code className="font-mono">QLOO_API_KEY</code> to the server’s .env to enable resolution.
        </Callout>
      )}
      <ExplainSection />
      {q.isLoading && (
        <div className="grid gap-5 lg:grid-cols-2">
          <SkeletonCard lines={6} />
          <SkeletonCard lines={6} />
        </div>
      )}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState icon={<Users className="h-5 w-5" />} title="No audiences yet" action={<Button onClick={() => setEdit('new')}>Add an audience</Button>}>Define at least one audience before research.</EmptyState>}
      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="grid gap-5 lg:grid-cols-2" data-tour="interests">
        {q.data?.items.map((a) => (
          <motion.div key={a.id} variants={fadeUp}>
            <AudienceCard a={a} onEdit={() => setEdit(a)} qlooOff={!!qlooOff} />
          </motion.div>
        ))}
      </motion.div>
      {analytics.data && (
        <div className="mt-8">
          <TasteProfile a={analytics.data} qlooConfigured={providers?.qloo.configured} />
        </div>
      )}
      <AudienceForm open={edit !== null} audience={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
    </PageWrap>
  );
}

function AudienceCard({ a, onEdit, qlooOff }: { a: AudienceWithEntities; onEdit: () => void; qlooOff: boolean }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [archiving, setArchiving] = useState(false);
  const locked = useLocked();
  const archive = useApiMutation(() => mutations.archiveAudience(a.audience_id), [['audiences', pid], ['project', pid]]);
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start gap-4 border-b border-line p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-soft to-accent-soft">
          <UserRound className="h-6 w-6 text-brand-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-bold leading-snug">{a.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone={ROLE_TONE[a.role] ?? 'neutral'}>{ROLE_LABEL[a.role]}</Badge>
            {a.is_hypothetical_persona && (
              <Tooltip content="A planning persona. It does not describe or identify any real individual.">
                <span tabIndex={0}>
                  <Badge tone="neutral">Hypothetical persona</Badge>
                </span>
              </Tooltip>
            )}
            <Badge tone="neutral">v{a.version}</Badge>
          </div>
        </div>
        {!locked && (
          <div className="flex gap-1">
            <button className="rounded-lg p-2 text-muted hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:p-3" onClick={onEdit} aria-label={`Edit ${a.name}`}>
              <Pencil className="h-4 w-4" />
            </button>
            <button className="rounded-lg p-2 text-muted hover:bg-bad-soft hover:text-bad [@media(pointer:coarse)]:p-3" onClick={() => setArchiving(true)} aria-label={`Archive ${a.name}`}>
              <Archive className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-4 p-5">
        {a.description && <p className="text-sm text-muted">{a.description}</p>}
        <div>
          <p className="eyebrow mb-1.5">Needs (from brief or research)</p>
          <div className="flex flex-wrap gap-1.5">
            {a.needs.length ? a.needs.map((n) => <Badge key={n} tone="accent">{n}</Badge>) : <span className="text-sm text-subtle">None stated</span>}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-1.5 flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5" /> Languages
          </p>
          <div className="flex flex-wrap gap-1.5">
            {a.languages.map((l) => (
              <span key={l} lang={l} className="chip">
                {LANG_LABEL[l] ?? l}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-1.5">Voluntary interests → Qloo entities</p>
          {a.voluntary_interests.length === 0 ? (
            <p className="text-sm text-subtle">No interests supplied. Qloo taste signals need resolved interests or tags.</p>
          ) : (
            <ul className="space-y-2">
              {a.voluntary_interests.map((i) => {
                const e = a.entities.find((x) => x.query_text.toLowerCase() === i.text.toLowerCase());
                return <InterestRow key={i.text} text={i.text} entity={e} qlooOff={qlooOff} />;
              })}
            </ul>
          )}
        </div>
        {a.research_notes && <p className="rounded-xl bg-surface2/70 px-3 py-2 text-xs text-muted">{a.research_notes}</p>}
      </div>
      {a.history.length > 1 && (
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          Versions: {a.history.map((h) => `v${h.version}`).join(' · ')} — earlier versions remain linked to the strategies built on them.
        </div>
      )}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        tone="danger"
        title={`Archive “${a.name}”?`}
        confirmLabel="Archive"
        loading={archive.isPending}
        onConfirm={() => archive.mutate(undefined, { onSuccess: () => (toast.success('Audience archived'), setArchiving(false)), onError: (e) => toast.error('Could not archive', e) })}
      >
        It will no longer be used in new research. Existing strategies and creative built on it are kept.
      </ConfirmDialog>
    </Card>
  );
}

function InterestRow({ text, entity, qlooOff }: { text: string; entity?: ResolvedEntity; qlooOff: boolean }) {
  const [open, setOpen] = useState(false);
  const locked = useLocked();
  const status = entity?.status ?? (qlooOff ? 'unavailable' : 'pending');
  return (
    <li id={entity ? `entity-${entity.id}` : undefined} className="scroll-mt-28 rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{text}</span>
        <Badge tone={ENTITY_TONE[status] ?? 'neutral'}>{status === 'not_found' ? 'Not found' : humanize(status)}</Badge>
        {entity?.canonical_name && (
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted">
            <Link2 className="h-3 w-3 shrink-0" /> <span className="font-medium text-fg">{entity.canonical_name}</span>
            {entity.qloo_type && <span className="text-subtle">· {isTag(entity.qloo_id) ? 'tag' : 'entity'} · {shortType(entity.qloo_type)}</span>}
          </span>
        )}
        {entity && !locked && (
          <button className="ml-auto text-xs font-semibold text-accent-ink hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Close' : entity.status === 'ambiguous' || entity.status === 'not_found' ? 'Resolve' : 'Change'}
          </button>
        )}
      </div>
      {entity?.status === 'proxy' && (
        <p className="mt-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
          <b>Explicit proxy</b> for “{entity.proxy_for ?? text}”: {entity.proxy_reason}
        </p>
      )}
      {entity?.status === 'not_found' && (
        <p className="mt-1 text-xs text-muted">No suitable Qloo entity or tag was accepted — this interest contributes no taste signal (unknown, not zero). {entity.candidates.length > 0 && `${entity.candidates.length} candidates were reviewed.`}</p>
      )}
      {entity && tagNames(entity.tags).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tagNames(entity.tags).map((t) => (
            <span key={t} className="chip !py-0 !text-[10.5px]">{t}</span>
          ))}
        </div>
      )}
      {!entity && (
        <p className="mt-1 text-xs text-subtle">
          {qlooOff ? 'Not resolved: Qloo is unavailable. No entity is guessed or invented.' : 'Not yet resolved — runs when research reaches the entity resolver.'}
        </p>
      )}
      {open && entity && <EntityResolver e={entity} onDone={() => setOpen(false)} />}
    </li>
  );
}

function EntityResolver({ e, onDone }: { e: ResolvedEntity; onDone: () => void }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [pick, setPick] = useState(e.qloo_id ?? '');
  const [q, setQ] = useState(e.query_text);
  const [results, setResults] = useState<EntityCandidate[] | null>(null);
  const [searchErr, setSearchErr] = useState<unknown>(null);
  const [proxy, setProxy] = useState<EntityCandidate | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const resolve = useApiMutation((b: Schemas['EntityResolveIn']) => mutations.resolveEntity(e.id, b), [['audiences', pid]]);
  const done = (msg: string) => ({ onSuccess: () => (toast.success(msg), onDone()), onError: (er: unknown) => toast.error('Could not save', er) });
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-surface2/60 p-3">
      {e.candidates.length > 0 && (
        <fieldset>
          <legend className="label">Candidates returned by Qloo</legend>
          <div className="space-y-1.5">
            {e.candidates.map((c) => (
              <label key={c.qloo_id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm', pick === c.qloo_id ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface')}>
                <input type="radio" name={`cand-${e.id}`} checked={pick === c.qloo_id} onChange={() => setPick(c.qloo_id)} />
                <span className="min-w-0">
                  <span className="font-medium">{c.name}</span>{' '}
                  <span className="text-xs text-subtle">
                    {isTag(c.qloo_id) ? 'tag' : 'entity'} · {shortType(c.type)}
                  </span>
                  {typeof c.disambiguation === 'string' && c.disambiguation && (
                    <span className="line-clamp-2 block text-xs text-subtle" title={c.disambiguation}>{c.disambiguation}</span>
                  )}
                </span>
                <code className="ml-auto shrink-0 text-[10.5px] text-subtle" title={c.qloo_id}>{c.qloo_id.length > 22 ? `${c.qloo_id.slice(0, 22)}…` : c.qloo_id}</code>
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-2" disabled={!pick} loading={resolve.isPending} onClick={() => resolve.mutate({ qloo_id: pick, mark_not_found: false }, done('Entity resolved'))}>
            Use selected candidate
          </Button>
        </fieldset>
      )}
      <div>
        <p className="label">…or record an explicit proxy</p>
        <div className="flex gap-2">
          <Input value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Search Qloo entities" className="h-9" />
          <Button
            size="sm"
            variant="outline"
            icon={<Search className="h-3.5 w-3.5" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setSearchErr(null);
              try {
                const r = await mutations.qlooSearch(q);
                setResults([...r.tags, ...r.entities]);
              } catch (er) {
                setSearchErr(er);
              } finally {
                setBusy(false);
              }
            }}
          >
            Search Qloo
          </Button>
        </div>
        {searchErr != null && (
          <Callout tone="warn" className="mt-2 text-xs" icon={<CircleHelp className="h-4 w-4 text-warn" />}>
            {searchErr instanceof ApiError && searchErr.status === 503
              ? 'Qloo search is unavailable because the server has no Qloo key. A proxy needs a real Qloo id, so none can be recorded right now — and none will be invented.'
              : (searchErr as Error).message}
          </Callout>
        )}
        {results && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {results.length === 0 && <li className="text-xs text-subtle">No matches.</li>}
            {results.map((r) => (
              <li key={r.qloo_id}>
                <button className={cn('w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-surface', proxy?.qloo_id === r.qloo_id && 'bg-surface font-semibold ring-1 ring-accent/40')} onClick={() => setProxy(r)} aria-pressed={proxy?.qloo_id === r.qloo_id}>
                  <Badge tone={isTag(r.qloo_id) ? 'accent' : 'violet'} className="mr-1.5 !py-0 !text-[10px]">{isTag(r.qloo_id) ? 'tag' : 'entity'}</Badge>
                  {r.name} <span className="text-xs text-subtle">{shortType(r.type)}{typeof r.disambiguation === 'string' && r.disambiguation ? ` · ${r.disambiguation}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {proxy && (
          <div className="mt-2 space-y-2">
            <Input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Why is this a fair proxy for the interest?" aria-label="Proxy reason" className="h-9" />
            <Button
              size="sm"
              disabled={!reason.trim()}
              loading={resolve.isPending}
              onClick={() => resolve.mutate({ proxy: { qloo_id: proxy.qloo_id, name: proxy.name, type: proxy.type, reason }, mark_not_found: false }, done('Proxy recorded'))}
            >
              Record proxy for “{e.query_text}”
            </Button>
          </div>
        )}
      </div>
      <button className="text-xs font-semibold text-bad hover:underline" onClick={() => resolve.mutate({ mark_not_found: true }, done('Marked not found'))}>
        Mark as not found in Qloo
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ explanations (taste story, compare) */
function ExplainSection() {
  const { pid, project, sel, setSel } = useProjectCtx();
  const runs = useRuns(pid);
  const qlooRuns = (runs.data?.items ?? []).filter((r) => r.qloo_enabled);
  const run = pickDefaultRun(qlooRuns, sel.runId);
  const rd = useRun(run?.id);
  const areas = (rd.data?.assessments ?? []).filter((a) => a.eligible).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99));
  const auds = (project?.audiences ?? []).map((a) => ({ id: a.id, name: a.name }));
  const areaId = areas.some((a) => a.area_id === sel.areaId) ? sel.areaId : areas[0]?.area_id;
  const audId = auds.some((a) => a.id === sel.audienceId) ? sel.audienceId : auds[0]?.id;
  const [params] = useSearchParams();
  const viewParam = params.get('view');
  const [tab, setTab] = useState<'story' | 'compare'>(viewParam === 'compare' ? 'compare' : 'story');
  useEffect(() => setTab(viewParam === 'compare' ? 'compare' : 'story'), [viewParam]);
  const [pair, setPair] = useState<[string, string] | null>(null);
  const a = pair?.[0] ?? audId;
  const b = pair?.[1] ?? auds.find((x) => x.id !== a)?.id;
  if (!runs.isLoading && !run) return null;
  return (
    <Card className="mb-8 scroll-mt-28" id="taste-story" data-tour="taste-story">
      <CardHeader
        icon={<Network className="h-4 w-4" />}
        title="Why these places?"
        subtitle={`From your interests to Qloo’s recommendations, the placement, the campaign hypothesis and the ad — for one audience in one city. Research run ${run ? run.id.slice(0, 8) : '…'}.`}
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs<'story' | 'compare'>
            size="sm"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'story', label: 'Taste story', icon: <Network className="h-3.5 w-3.5" />, tip: 'why-places' },
              { key: 'compare', label: 'Compare two audiences', icon: <ArrowLeftRight className="h-3.5 w-3.5" />, tip: 'compare-audiences' },
            ]}
          />
          <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
            City
            <Select className="h-9 w-auto min-w-[150px] py-1" value={areaId ?? ''} onChange={(e) => setSel({ areaId: e.target.value })}>
              {areas.map((x) => (
                <option key={x.area_id} value={x.area_id}>
                  {x.area_name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {tab === 'story' ? (
          <>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Audience">
              {auds.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={x.id === audId}
                  onClick={() => setSel({ audienceId: x.id })}
                  className={cn(
                    'min-h-[36px] rounded-xl border px-3 text-[13px] font-medium transition [@media(pointer:coarse)]:min-h-[44px]',
                    x.id === audId ? 'border-fg/25 bg-surface2 text-fg shadow-card' : 'border-line text-muted hover:text-fg',
                  )}
                >
                  {x.name.replace(/\s*\(hypothetical persona\)/i, '')}
                </button>
              ))}
            </div>
            <TasteStory runId={run?.id} areaId={areaId} audienceId={audId} />
          </>
        ) : (
          <AudienceCompare runId={run?.id} areaId={areaId} audiences={auds} a={a} b={b} onChange={(x, y) => setPair([x, y])} />
        )}
      </div>
    </Card>
  );
}

const ROLES: AudienceRole[] = ['product_user', 'purchaser', 'institutional_buyer', 'distribution_partner'];

function AudienceForm({ open, audience, onClose }: { open: boolean; audience: AudienceWithEntities | null; onClose: () => void }) {
  const { pid } = useProjectCtx();
  const toast = useToast();
  const [name, setName] = useState('New audience');
  const [role, setRole] = useState<AudienceRole>('product_user');
  const [desc, setDesc] = useState('');
  const [needs, setNeeds] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [langs, setLangs] = useState<Lang[]>(['en']);
  const [notes, setNotes] = useState('');
  const [init, setInit] = useState<string | null>(null);
  const key = audience?.id ?? (open ? 'new' : null);
  if (open && init !== key) {
    setInit(key);
    setName(audience?.name ?? '');
    setRole(audience?.role ?? 'product_user');
    setDesc(audience?.description ?? '');
    setNeeds(audience?.needs ?? []);
    setInterests(audience?.voluntary_interests.map((i) => i.text) ?? []);
    setLangs(audience?.languages ?? ['en']);
    setNotes(audience?.research_notes ?? '');
  }
  const body = (): Schemas['AudienceIn'] => ({
    name,
    role,
    description: desc,
    needs,
    voluntary_interests: interests.map((t) => ({ text: t })),
    languages: langs,
    research_notes: notes,
  });
  const save = useApiMutation((): Promise<unknown> => (audience ? mutations.updateAudience(audience.audience_id, body()) : mutations.createAudience(pid, body())), [['audiences', pid], ['project', pid]]);
  const errs = fieldErrors(save.error);
  return (
    <Modal
      open={open}
      onClose={() => (onClose(), setInit(null))}
      size="lg"
      icon={<Users className="h-4 w-4" />}
      title={audience ? `Edit audience · new version v${audience.version + 1}` : 'New audience'}
      description="Changing an audience creates a new version and marks the strategies and creative built for it as stale."
      footer={
        <>
          <Button variant="ghost" onClick={() => (onClose(), setInit(null))}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!name.trim() || !langs.length}
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.success(audience ? 'New audience version saved' : 'Audience created');
                  onClose();
                  setInit(null);
                },
                onError: (e) => toast.error('Could not save audience', e),
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errs.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Family members buying for a relative" />
        </Field>
        <Field label="Role" required error={errs.role}>
          <Select value={role} onChange={(e) => setRole(e.target.value as AudienceRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="Needs" hint="From the brief or voluntary research — never inferred from tastes." className="sm:col-span-2">
          <TagInput ariaLabel="Needs" value={needs} onChange={setNeeds} tone="accent" />
        </Field>
        <Field label="Voluntary interests" hint="Resolved to Qloo entities when Qloo is available. Max 15." className="sm:col-span-2" error={errs.voluntary_interests}>
          <TagInput ariaLabel="Voluntary interests" value={interests} onChange={setInterests} />
        </Field>
        <Field label="Languages" className="sm:col-span-2" error={errs.languages}>
          <div className="flex flex-wrap gap-4">
            {(['en', 'es', 'hi', 'bn'] as Lang[]).map((l) => (
              <Checkbox key={l} checked={langs.includes(l)} onChange={(v) => setLangs((x) => (v ? [...x, l] : x.filter((y) => y !== l)))} label={<span lang={l}>{LANG_LABEL[l]}</span>} />
            ))}
          </div>
        </Field>
        <Field label="Research notes" className="sm:col-span-2">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
