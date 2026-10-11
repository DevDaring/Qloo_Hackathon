import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CircleHelp,
  FileText,
  History,
  ImageIcon,
  ListChecks,
  Lock,
  Package,
  Save,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { Schemas } from '../api/client';
import { mutations, useApiMutation, useClaims, useConstraints, useProduct, usePublicConfig } from '../api/hooks';
import type { Claim, Feature, Product, Region } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { InteractiveMedia } from '../components/InteractiveMedia';
import { EvidenceBadge } from '../components/Evidence';
import { AddRow, Dropzone, RegionList, TagInput, fieldErrors } from '../components/FormBits';
import { Modal } from '../components/Overlay';
import { useProjectCtx } from '../components/ProjectContext';
import { useLocked } from '../components/Locked';
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
  SkeletonCard,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui';
import { cn, fmtDate, fmtMoney, humanize } from '../lib/format';

type Tab = 'facts' | 'claims' | 'uploads' | 'constraints' | 'versions';

export default function ProductBrief() {
  const [params, setParams] = useSearchParams();
  const loc = useLocation();
  // journey deep links: brief#product, brief#constraints, brief#media open the matching tab
  const hashTab = ({ product: 'facts', constraints: 'constraints', media: 'uploads' } as Record<string, Tab>)[loc.hash.replace('#', '')];
  const tab = (params.get('tab') as Tab) || hashTab || 'facts';
  const locked = useLocked();
  const anchor = ({ facts: 'product', constraints: 'constraints', uploads: 'media' } as Partial<Record<Tab, string>>)[tab];
  const setTab = (t: Tab) => setParams(t === 'facts' ? {} : { tab: t }, { replace: true });
  const { project } = useProjectCtx();
  const openQ = (project?.product?.open_questions.length ?? 0) + (project?.product?.features.reduce((n, f) => n + f.critical_unknowns.length, 0) ?? 0);
  return (
    <PageWrap>
      <PageHeader
        eyebrow="Inputs"
        title="Product brief"
        description="Structured facts the whole workflow relies on. Every save creates a new version; earlier versions and the results built on them are preserved."
      >
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'facts', label: 'Facts & features', icon: <Package className="h-3.5 w-3.5" />, count: openQ || undefined },
            { key: 'claims', label: 'Claims', icon: <ListChecks className="h-3.5 w-3.5" />, count: project?.claims.length },
            { key: 'uploads', label: 'Uploads', icon: <ImageIcon className="h-3.5 w-3.5" />, count: project?.product_assets.length },
            { key: 'constraints', label: 'Launch constraints', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
            { key: 'versions', label: 'Versions', icon: <History className="h-3.5 w-3.5" /> },
          ]}
        />
      </PageHeader>
      <AnimatePresence mode="wait">
        <motion.div key={tab} id={anchor} data-tour={tab === 'facts' ? 'brief' : undefined} className="scroll-mt-28" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {locked && tab !== 'versions' && (
            <p className="mb-4 flex items-center gap-2 rounded-xl border border-accent/25 bg-accent-soft/40 px-3 py-2 text-[13px]" role="note">
              <Lock className="h-3.5 w-3.5 text-accent-ink" aria-hidden /> Read-only sample: the brief is shown as it was used for the research. Duplicate the project to edit it.
            </p>
          )}
          <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
            {tab === 'facts' && <FactsTab />}
            {tab === 'claims' && <ClaimsTab />}
            {tab === 'uploads' && <UploadsTab />}
            {tab === 'constraints' && <ConstraintsTab />}
            {tab === 'versions' && <VersionsTab />}
          </fieldset>
        </motion.div>
      </AnimatePresence>
    </PageWrap>
  );
}

/* ================================================================== facts */
type ProductForm = Omit<Schemas['ProductIn'], 'price' | 'features'> & { price: string; features: Feature[] };

const emptyFeature = (): Feature => ({
  key: '',
  name: '',
  mechanism: '',
  proposed_benefit: '',
  operating_conditions: '',
  evidence_status: 'owner_stated',
  source: 'owner',
  prohibited_exaggerations: [],
  critical_unknowns: [],
  enabled: true,
});

function toForm(p: Product | null | undefined, currency = 'INR', projectName = ''): ProductForm {
  return {
    // a new product starts with the project's name, so the required field is never blank
    name: p?.name ?? projectName.replace(/\s*\(my copy\)\s*$/i, ''),
    description: p?.description ?? '',
    category: p?.category ?? '',
    price: p?.price != null ? String(p.price) : '',
    currency: p?.currency ?? currency,
    intended_benefits: p?.intended_benefits ?? [],
    operating_limitations: p?.operating_limitations ?? [],
    launch_date: p?.launch_date ?? null,
    distribution_options: p?.distribution_options ?? [],
    available_stock: p?.available_stock ?? null,
    brand_colours: p?.brand_colours ?? [],
    brand_voice: p?.brand_voice ?? '',
    website: p?.website ?? '',
    cta_destination: p?.cta_destination ?? '',
    change_note: '',
    features: p?.features.map((f) => ({ ...f })) ?? [],
  };
}

function FactsTab() {
  const { pid, project } = useProjectCtx();
  const pq = useProduct(pid);
  const cur = pq.data?.current;
  const [form, setForm] = useState<ProductForm>(() => toForm(cur, project?.currency, project?.name));
  const [dirty, setDirty] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [extractOpen, setExtractOpen] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!dirty) setForm(toForm(cur, project?.currency, project?.name));
  }, [cur, dirty, project?.currency]);
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const setFeature = (i: number, patch: Partial<Feature>) => set('features', form.features.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const save = useApiMutation(
    () =>
      mutations.saveProduct(pid, {
        ...form,
        price: form.price === '' ? null : form.price,
        available_stock: form.available_stock === null || (form.available_stock as unknown) === '' ? null : Number(form.available_stock),
        launch_date: form.launch_date || null,
        features: form.features.map((f) => ({ ...f, key: f.key || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80) })),
      }),
    [['product', pid], ['project', pid], ['claims', pid]],
  );

  if (pq.isLoading) return <SkeletonCard lines={8} />;
  if (pq.error) return <ErrorState error={pq.error} onRetry={() => pq.refetch()} />;

  const openQs = cur?.open_questions ?? [];
  const unknowns = form.features.flatMap((f) => f.critical_unknowns.map((q) => ({ f: f.name, q })));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {(openQs.length > 0 || unknowns.length > 0) && (
          <Callout tone="warn" icon={<CircleHelp className="h-4 w-4 text-warn" />} title={`${openQs.length + unknowns.length} open question${openQs.length + unknowns.length === 1 ? '' : 's'} — claims depending on them stay blocked`}>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {openQs.map((q) => (
                <li key={q}>{q}</li>
              ))}
              {unknowns.map((u) => (
                <li key={u.f + u.q}>
                  <b>{u.f}:</b> {u.q}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {cur?.is_synthetic && (
          <Callout tone="brand" icon={<Sparkles className="h-4 w-4 text-brand-ink" />} title="Synthetic sample">
            These specifications are explicit placeholders for demonstration. They are never presented as real product facts.
          </Callout>
        )}
        <Card>
          <CardHeader
            title="Product facts"
            subtitle={cur ? `Current version v${cur.version}` : 'No version saved yet'}
            icon={<Package className="h-4 w-4" />}
            action={
              <Button size="sm" variant="outline" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => setExtractOpen(true)}>
                Extract from brief
              </Button>
            }
          />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Product name" required error={errs.name} htmlFor="p-name">
              <Input id="p-name" value={form.name} onChange={(e) => set('name', e.target.value)} invalid={!!errs.name} />
            </Field>
            <Field label="Category" htmlFor="p-cat" error={errs.category}>
              <Input id="p-cat" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} />
            </Field>
            <Field label="Description" className="md:col-span-2" htmlFor="p-desc" error={errs.description}>
              <Textarea id="p-desc" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={3} />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
              <Field label="Price" htmlFor="p-price" hint="Leave empty if unknown — ads will omit a price." error={errs.price}>
                <Input id="p-price" type="number" min={0} step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} />
              </Field>
              <Field label="Currency" htmlFor="p-cur" error={errs.currency}>
                <Input id="p-cur" maxLength={3} value={form.currency ?? ''} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Launch date" htmlFor="p-launch" error={errs.launch_date}>
                <Input id="p-launch" type="date" value={form.launch_date ?? ''} onChange={(e) => set('launch_date', e.target.value || null)} />
              </Field>
              <Field label="Available stock" htmlFor="p-stock" error={errs.available_stock}>
                <Input
                  id="p-stock"
                  type="number"
                  min={0}
                  value={form.available_stock ?? ''}
                  onChange={(e) => set('available_stock', e.target.value === '' ? null : Number(e.target.value))}
                />
              </Field>
            </div>
            <Field label="Intended benefits" hint="Press Enter to add" className="md:col-span-2">
              <TagInput ariaLabel="Intended benefits" value={form.intended_benefits ?? []} onChange={(v) => set('intended_benefits', v)} tone="accent" />
            </Field>
            <Field label="Operating limitations">
              <TagInput ariaLabel="Operating limitations" value={form.operating_limitations ?? []} onChange={(v) => set('operating_limitations', v)} tone="warn" />
            </Field>
            <Field label="Distribution options">
              <TagInput ariaLabel="Distribution options" value={form.distribution_options ?? []} onChange={(v) => set('distribution_options', v)} />
            </Field>
            <Field label="Brand colours" hint="#RRGGBB" error={errs.brand_colours}>
              <div className="flex items-center gap-2">
                <TagInput ariaLabel="Brand colours" value={form.brand_colours ?? []} onChange={(v) => set('brand_colours', v)} />
                <div className="flex shrink-0 gap-1">
                  {(form.brand_colours ?? []).map((c) => (
                    <span key={c} className="h-6 w-6 rounded-md border border-line" style={{ background: /^#[0-9a-f]{6}$/i.test(c) ? c : 'transparent' }} title={c} />
                  ))}
                </div>
              </div>
            </Field>
            <Field label="Brand voice" htmlFor="p-voice">
              <Input id="p-voice" value={form.brand_voice ?? ''} onChange={(e) => set('brand_voice', e.target.value)} />
            </Field>
            <Field label="Website" htmlFor="p-web">
              <Input id="p-web" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
            </Field>
            <Field label="CTA destination" htmlFor="p-cta">
              <Input id="p-cta" value={form.cta_destination ?? ''} onChange={(e) => set('cta_destination', e.target.value)} placeholder="https://" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Features"
            subtitle="Mechanism, proposed benefit and operating conditions for each. Disabled features are excluded from strategy and creative."
            icon={<ListChecks className="h-4 w-4" />}
          />
          <div className="space-y-4 p-5">
            {form.features.length === 0 && <EmptyState title="No features yet">Add at least one feature — research needs it.</EmptyState>}
            <AnimatePresence initial={false}>
              {form.features.map((f, i) => (
                <motion.div
                  key={i}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn('rounded-2xl border p-4 transition', f.enabled ? 'border-line bg-surface' : 'border-dashed border-line bg-surface2/50 opacity-80')}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      aria-label="Feature name"
                      className="h-9 max-w-xs flex-1 font-semibold"
                      value={f.name}
                      placeholder="Feature name"
                      onChange={(e) => setFeature(i, { name: e.target.value })}
                    />
                    <Input aria-label="Feature key" className="h-9 w-44 font-mono text-xs" value={f.key} placeholder="snake_case_key" onChange={(e) => setFeature(i, { key: e.target.value })} />
                    <Select aria-label="Evidence status" className="h-9 w-40 py-1" value={f.evidence_status} onChange={(e) => setFeature(i, { evidence_status: e.target.value as Feature['evidence_status'] })}>
                      <option value="verified">Verified</option>
                      <option value="owner_stated">Owner-stated</option>
                      <option value="unverified">Unverified</option>
                      <option value="unknown">Unknown</option>
                    </Select>
                    <EvidenceBadge kind={f.evidence_status === 'verified' ? 'observed_fact' : f.evidence_status === 'owner_stated' ? 'owner_fact' : 'data_gap'} />
                    <div className="ml-auto flex items-center gap-3">
                      <Toggle checked={f.enabled} onChange={(v) => setFeature(i, { enabled: v })} label={f.enabled ? 'Enabled' : 'Disabled'} />
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-subtle hover:bg-bad-soft hover:text-bad"
                        aria-label={`Remove feature ${f.name}`}
                        onClick={() => set('features', form.features.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <Field label="Mechanism">
                      <Textarea rows={2} value={f.mechanism} onChange={(e) => setFeature(i, { mechanism: e.target.value })} />
                    </Field>
                    <Field label="Proposed benefit">
                      <Textarea rows={2} value={f.proposed_benefit} onChange={(e) => setFeature(i, { proposed_benefit: e.target.value })} />
                    </Field>
                    <Field label="Operating conditions">
                      <Textarea rows={2} value={f.operating_conditions} onChange={(e) => setFeature(i, { operating_conditions: e.target.value })} />
                    </Field>
                    <Field label={<span className="inline-flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5 text-bad" /> Prohibited exaggerations</span>} className="md:col-span-1">
                      <TagInput ariaLabel="Prohibited exaggerations" tone="bad" value={f.prohibited_exaggerations} onChange={(v) => setFeature(i, { prohibited_exaggerations: v })} />
                    </Field>
                    <Field label={<span className="inline-flex items-center gap-1"><CircleHelp className="h-3.5 w-3.5 text-warn" /> Critical unknowns</span>} className="md:col-span-1">
                      <TagInput ariaLabel="Critical unknowns" tone="warn" value={f.critical_unknowns} onChange={(v) => setFeature(i, { critical_unknowns: v })} />
                    </Field>
                    <Field label="Source">
                      <Input value={f.source} onChange={(e) => setFeature(i, { source: e.target.value })} />
                    </Field>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <AddRow label="Add feature" onClick={() => set('features', [...form.features, emptyFeature()])} />
          </div>
        </Card>
      </div>

      {/* save rail */}
      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card className="p-5">
          <p className="section-title">Save a new version</p>
          <p className="mt-1 text-[13px] text-muted">Changing facts invalidates only dependent strategy and creative; research reruns only if needed.</p>
          <Field label="Change note" className="mt-4" htmlFor="p-note">
            <Input id="p-note" value={form.change_note ?? ''} onChange={(e) => set('change_note', e.target.value)} placeholder="What changed?" />
          </Field>
          {Object.keys(errs).length > 0 && (
            <ul className="mt-3 space-y-1 rounded-xl bg-bad-soft/60 p-3 text-xs text-bad" role="alert">
              {Object.entries(errs).map(([k, v]) => (
                <li key={k}>
                  <b>{humanize(k)}</b>: {v}
                </li>
              ))}
            </ul>
          )}
          <Button
            className="mt-4 w-full"
            variant="brand"
            icon={<Save className="h-4 w-4" />}
            disabled={!dirty || !form.name.trim()}
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (r) => {
                  setDirty(false);
                  setErrs({});
                  toast.success(`Saved product v${r.product.version}`, r.revision ? 'Dependent strategies and creative were marked stale where affected.' : undefined);
                },
                onError: (e) => {
                  setErrs(fieldErrors(e));
                  toast.error('Could not save product', e);
                },
              })
            }
          >
            Save version
          </Button>
          {dirty && (
            <button className="mt-2 w-full text-center text-xs text-muted hover:text-fg" onClick={() => (setForm(toForm(cur, project?.currency, project?.name)), setDirty(false), setErrs({}))}>
              Discard changes
            </button>
          )}
          {cur && (
            <dl className="mt-5 space-y-1 border-t border-line pt-4 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Version</dt><dd className="font-semibold">v{cur.version}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Price</dt><dd className="font-semibold">{cur.price != null ? fmtMoney(cur.price, cur.currency) : 'Unknown'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Enabled features</dt><dd className="font-semibold">{cur.features.filter((f) => f.enabled).length}</dd></div>
            </dl>
          )}
        </Card>
      </div>
      <ExtractModal
        open={extractOpen}
        onClose={() => setExtractOpen(false)}
        onApply={(p) => {
          setForm((f) => ({
            ...f,
            name: p.name || f.name,
            description: p.description || f.description,
            category: p.category || f.category,
            price: p.price != null ? String(p.price) : f.price,
            currency: p.currency || f.currency,
            intended_benefits: p.intended_benefits.length ? p.intended_benefits : f.intended_benefits,
            operating_limitations: p.operating_limitations.length ? p.operating_limitations : f.operating_limitations,
            features: p.features.length
              ? p.features.map((x) => ({ ...emptyFeature(), ...x, source: 'extracted from brief (review)', evidence_status: 'owner_stated' as const }))
              : f.features,
          }));
          setDirty(true);
          setExtractOpen(false);
          toast.info('Proposal applied to the form', 'Review and correct, then save a version. Nothing is saved yet.');
        }}
      />
    </div>
  );
}

function ExtractModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (p: Awaited<ReturnType<typeof mutations.extract>>['proposal']) => void;
}) {
  const { pid, project } = useProjectCtx();
  const [text, setText] = useState('');
  const [docId, setDocId] = useState('');
  const ex = useApiMutation(() => mutations.extract(pid, { text: text || undefined, asset_id: docId || undefined }));
  const docs = project?.product_assets.filter((a) => a.role === 'document') ?? [];
  const r = ex.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Wand2 className="h-4 w-4" />}
      title="Extract facts from a brief"
      description="The reasoning model proposes structured facts exactly as stated. Nothing is saved: you review, correct and then save."
      footer={
        r ? (
          <>
            <Button variant="ghost" onClick={() => ex.reset()}>
              Back
            </Button>
            <Button variant="brand" onClick={() => onApply(r.proposal)}>
              Apply to form
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="brand" loading={ex.isPending} disabled={text.trim().length < 20 && !docId} onClick={() => ex.mutate(undefined)}>
              Propose facts
            </Button>
          </>
        )
      }
    >
      {!r ? (
        <div className="space-y-4">
          <Field label="Paste a product brief" hint="At least a few sentences. Retrieved text is treated as data, never as instructions.">
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {docs.length > 0 && (
            <Field label="…or use an uploaded document">
              <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">None</option>
                {docs.map((d) => (
                  <option key={d.asset_id} value={d.asset_id}>
                    Document {d.asset_id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {ex.error && <ErrorState error={ex.error} onRetry={() => ex.mutate(undefined)} />}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <Callout tone="accent">{r.note} · model {r.model}</Callout>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="eyebrow">Name</p><p className="font-semibold">{r.proposal.name}</p></div>
            <div><p className="eyebrow">Category</p><p>{r.proposal.category}</p></div>
            <div className="sm:col-span-2"><p className="eyebrow">Description</p><p className="text-muted">{r.proposal.description}</p></div>
            <div><p className="eyebrow">Price</p><p>{r.proposal.price != null ? fmtMoney(r.proposal.price, r.proposal.currency ?? 'INR') : 'Not stated'}</p></div>
          </div>
          <div>
            <p className="eyebrow mb-1">Features</p>
            <ul className="space-y-2">
              {r.proposal.features.map((f) => (
                <li key={f.key} className="rounded-xl border border-line p-3">
                  <b>{f.name}</b> <code className="text-xs text-subtle">{f.key}</code>
                  <p className="text-muted">{f.mechanism}</p>
                  {f.critical_unknowns.length > 0 && <p className="mt-1 text-xs text-warn">Unknown: {f.critical_unknowns.join('; ')}</p>}
                </li>
              ))}
            </ul>
          </div>
          {r.proposal.open_questions.length > 0 && (
            <Callout tone="warn" title="Open questions">
              <ul className="list-disc pl-5">{r.proposal.open_questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </Callout>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ================================================================== claims */
const SUPPORT: Claim['support_status'][] = ['verified', 'owner_stated', 'unsupported', 'prohibited'];

function ClaimsTab() {
  const { pid, project } = useProjectCtx();
  const q = useClaims(pid);
  const toast = useToast();
  const [text, setText] = useState('');
  const [feature, setFeature] = useState('');
  const [status, setStatus] = useState<Claim['support_status']>('owner_stated');
  const [approved, setApproved] = useState(false);
  const add = useApiMutation(
    () => mutations.addClaim(pid, { text, feature_key: feature || null, support_status: status, approved, evidence_ids: [] }),
    [['claims', pid], ['project', pid]],
  );
  const patch = useApiMutation((v: { id: string; b: Partial<Schemas['ClaimPatch']> }) => mutations.patchClaim(v.id, v.b), [['claims', pid], ['project', pid]]);
  const feats = project?.product?.features ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title="Approved claims" subtitle="Only approved, supported claims can appear in strategy messages and ad copy. A deterministic checker removes anything else." icon={<ScrollText className="h-4 w-4" />} />
        {q.isLoading && <div className="p-5"><SkeletonCard /></div>}
        {q.error && <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}
        {q.data && q.data.items.length === 0 && <div className="p-5"><EmptyState title="No claims yet">Add the claims you can stand behind.</EmptyState></div>}
        <ul className="divide-y divide-line">
          {q.data?.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.text}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.feature_key && <Badge tone="accent">{c.feature_key}</Badge>}
                  <EvidenceBadge kind={c.support_status === 'verified' ? 'observed_fact' : c.support_status === 'owner_stated' ? 'owner_fact' : 'data_gap'} />
                </div>
              </div>
              <Select
                aria-label="Support status"
                className="h-9 w-36 py-1 text-xs"
                value={c.support_status}
                onChange={(e) =>
                  patch.mutate({ id: c.id, b: { support_status: e.target.value as Claim['support_status'] } }, { onError: (er) => toast.error('Could not update claim', er) })
                }
              >
                {SUPPORT.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
              <Toggle
                checked={c.approved}
                onChange={(v) =>
                  patch.mutate({ id: c.id, b: { approved: v } }, { onSuccess: () => toast.success(v ? 'Claim approved' : 'Approval withdrawn'), onError: (er) => toast.error('Could not change approval', er) })
                }
                label={c.approved ? 'Approved' : 'Not approved'}
              />
            </li>
          ))}
        </ul>
      </Card>
      <Card className="self-start p-5">
        <p className="section-title">Add a claim</p>
        <div className="mt-4 space-y-3">
          <Field label="Claim text" required error={fieldErrors(add.error).text}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. A built-in seat-back fan you can switch on while seated." />
          </Field>
          <Field label="Feature">
            <Select value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="">General (no feature)</option>
              {feats.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Support status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as Claim['support_status'])}>
              {SUPPORT.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox checked={approved} onChange={setApproved} label="Approve for use in ads" />
          <Button
            className="w-full"
            disabled={text.trim().length < 3}
            loading={add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: (r) => {
                  setText('');
                  toast.success('Claim added', r.note);
                },
                onError: (e) => toast.error('Could not add claim', e),
              })
            }
          >
            Add claim
          </Button>
          <p className="text-xs text-subtle">Measurements, certifications and clinical wording must be backed by evidence you hold. Unsupported or prohibited claims cannot be approved.</p>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== uploads */
function UploadsTab() {
  const { pid, project } = useProjectCtx();
  const cfg = usePublicConfig().data;
  const [role, setRole] = useState('product_photo');
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const up = useApiMutation((f: File) => mutations.upload(pid, role, f, primary), [['project', pid], ['assets', pid]]);
  const assets = project?.product_assets ?? [];
  const imageAssets = assets.filter((a) => a.role === 'product_photo' || a.role === 'logo');
  const mediaItems = imageAssets.map((a) => ({ src: `/api/v1/assets/${a.asset_id}/download`, alt: `${humanize(a.role)} (original upload)`, caption: a.is_primary ? 'Primary product photo' : humanize(a.role), meta: 'Immutable original upload' }));
  const accept = role === 'document' ? '.pdf,.txt,application/pdf,text/plain' : role === 'audio' ? 'audio/mpeg,audio/wav,.mp3,.wav' : 'image/png,image/jpeg,image/webp';
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="self-start p-5">
        <p className="section-title">Upload</p>
        <p className="mt-1 text-[13px] text-muted">Originals are stored immutably; derivatives are saved separately. Files are checked by signature, not by extension.</p>
        <div className="mt-4 space-y-3">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="product_photo">Product photo</option>
              <option value="logo">Logo</option>
              <option value="document">Product document (PDF / text)</option>
              <option value="audio">Licensed audio</option>
            </Select>
          </Field>
          {role === 'product_photo' && <Checkbox checked={primary} onChange={setPrimary} label="Use as primary product photo" />}
          <Dropzone
            accept={accept}
            maxMb={cfg?.maxUploadMb}
            busy={busy}
            hint={`${role === 'document' ? 'PDF or text' : role === 'audio' ? 'MP3 or WAV' : 'PNG, JPEG or WebP, 200–8000 px'} · max ${cfg?.maxUploadMb ?? '…'} MB`}
            onFiles={async (files) => {
              setBusy(true);
              for (const f of files) {
                try {
                  const r = await up.mutateAsync(f);
                  toast.success(`Uploaded ${f.name}`, r.extracted_chars ? `${r.extracted_chars.toLocaleString()} characters of text extracted.` : undefined);
                } catch (e) {
                  toast.error(`Could not upload ${f.name}`, e);
                }
              }
              setBusy(false);
            }}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Product assets" subtitle={`${assets.length} attached to this project`} icon={<ImageIcon className="h-4 w-4" />} />
        <div className="p-5">
          {assets.length === 0 ? (
            <EmptyState title="Nothing uploaded yet">A product photo is needed for flyers and video end cards.</EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {assets.map((a) => {
                const isImg = a.role === 'product_photo' || a.role === 'logo';
                const imgIdx = imageAssets.findIndex((x) => x.asset_id === a.asset_id);
                return (
                  <li key={a.asset_id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                    {isImg ? (
                      <InteractiveMedia
                        items={mediaItems}
                        index={imgIdx}
                        aspect="aspect-square"
                        fit="contain"
                        frameClassName="rounded-none border-0 bg-[conic-gradient(at_50%_50%,#f3f4f7_25%,#fff_0_50%,#f3f4f7_0_75%,#fff_0)] bg-[length:20px_20px] dark:bg-surface2"
                        showCaption={false}
                        badge={a.is_primary ? <Badge tone="brand">Primary</Badge> : undefined}
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center bg-surface2">
                        <FileText className="h-10 w-10 text-subtle" />
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="text-xs font-semibold">{humanize(a.role)}</span>
                      <a className="link text-xs" href={`/api/v1/assets/${a.asset_id}/download?attachment=true`}>
                        Download
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== constraints */
interface ConsForm {
  country_code: string;
  candidate_regions: Region[];
  service_regions: Region[];
  excluded_regions: Region[];
  production_budget: string;
  ad_spend_budget: string;
  currency: string;
  min_ad_spend_per_location: string;
  distribution_requirements: string[];
  weights: Record<string, number>;
  change_note: string;
}

function ConstraintsTab() {
  const { pid, project } = useProjectCtx();
  const q = useConstraints(pid);
  const toast = useToast();
  const cur = q.data?.current;
  const defaults = q.data?.default_weights ?? {};
  const labels = q.data?.weight_labels ?? {};
  const init = (): ConsForm => ({
    country_code: cur?.country_code ?? project?.country_code ?? 'IN',
    candidate_regions: cur?.candidate_regions ?? [],
    service_regions: cur?.service_regions ?? [],
    excluded_regions: cur?.excluded_regions ?? [],
    production_budget: cur?.production_budget != null ? String(cur.production_budget) : '',
    ad_spend_budget: cur?.ad_spend_budget != null ? String(cur.ad_spend_budget) : '',
    currency: cur?.currency ?? project?.currency ?? 'INR',
    min_ad_spend_per_location: cur?.min_ad_spend_per_location != null ? String(cur.min_ad_spend_per_location) : '',
    distribution_requirements: cur?.distribution_requirements ?? [],
    weights: { ...defaults, ...(cur?.weights ?? {}) },
    change_note: '',
  });
  const [f, setF] = useState<ConsForm>(init);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, dirty]);
  const set = <K extends keyof ConsForm>(k: K, v: ConsForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const wsum = useMemo(() => Object.values(f.weights).reduce((a, b) => a + b, 0), [f.weights]);
  const save = useApiMutation(
    () =>
      mutations.putConstraints(pid, {
        country_code: f.country_code,
        candidate_regions: f.candidate_regions as Schemas['Region'][],
        service_regions: f.service_regions as Schemas['Region'][],
        excluded_regions: f.excluded_regions as Schemas['Region'][],
        production_budget: f.production_budget === '' ? null : f.production_budget,
        ad_spend_budget: f.ad_spend_budget === '' ? null : f.ad_spend_budget,
        currency: f.currency,
        min_ad_spend_per_location: f.min_ad_spend_per_location === '' ? null : f.min_ad_spend_per_location,
        distribution_requirements: f.distribution_requirements as 'partner_outlet_in_area'[],
        weights: f.weights,
        change_note: f.change_note,
      }),
    [['constraints', pid], ['project', pid]],
  );
  const errs = fieldErrors(save.error);

  if (q.isLoading) return <SkeletonCard lines={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Candidate locations" subtitle="Where research compares fit. Search, then choose the right match — coordinates are stored in EPSG:4326." />
          <div className="p-5">
            <RegionList value={f.candidate_regions} onChange={(v) => set('candidate_regions', v)} emptyText="No candidate locations yet." tone="brand" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Service coverage" subtitle="Hard constraint: a candidate outside every service region is excluded, whatever its taste affinity." />
          <div className="p-5">
            <RegionList value={f.service_regions} onChange={(v) => set('service_regions', v)} defaultRadius={60} emptyText="No service regions — every candidate is treated as serviceable (an assumption you will see disclosed)." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Excluded regions" subtitle="Locations you never want recommended." />
          <div className="p-5">
            <RegionList value={f.excluded_regions} onChange={(v) => set('excluded_regions', v)} withRadius={false} emptyText="Nothing excluded." tone="bad" />
          </div>
        </Card>
      </div>
      <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
        <Card className="p-5">
          <p className="section-title">Budgets</p>
          <p className="mt-1 text-[13px] text-muted">Production budget pays for making creative. Ad-spend budget pays for placements in the pilot.</p>
          <div className="mt-4 space-y-3">
            <Field label="Production budget" error={errs.production_budget} hint="Creative production (design, generation)">
              <Input type="number" min={0} value={f.production_budget} onChange={(e) => set('production_budget', e.target.value)} />
            </Field>
            <Field label="Ad-spend budget" error={errs.ad_spend_budget} hint="Pilot media / placement spend">
              <Input type="number" min={0} value={f.ad_spend_budget} onChange={(e) => set('ad_spend_budget', e.target.value)} />
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
              <Field label="Min spend per location" error={errs.min_ad_spend_per_location}>
                <Input type="number" min={0} value={f.min_ad_spend_per_location} onChange={(e) => set('min_ad_spend_per_location', e.target.value)} />
              </Field>
              <Field label="Currency">
                <Input maxLength={3} value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
              </Field>
            </div>
            <Checkbox
              checked={f.distribution_requirements.includes('partner_outlet_in_area')}
              onChange={(v) => set('distribution_requirements', v ? ['partner_outlet_in_area'] : [])}
              label="Require a potential partner outlet in the area"
            />
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="section-title">Ranking weights</p>
            <button className="text-xs font-medium text-muted hover:text-fg" onClick={() => set('weights', { ...defaults })}>
              Reset
            </button>
          </div>
          <p className="mt-1 text-[13px] text-muted">Transparent weights for the planning index. Missing components are never renormalised away.</p>
          <div className="mt-4 space-y-4">
            {Object.keys(defaults).map((k) => (
              <div key={k}>
                <div className="mb-1.5 flex items-center justify-between text-[13px]">
                  <label htmlFor={`w-${k}`} className="font-medium">
                    {labels[k] ?? humanize(k)}
                  </label>
                  <span className="num font-semibold">{(f.weights[k] ?? 0).toFixed(2)}</span>
                </div>
                <input
                  id={`w-${k}`}
                  type="range"
                  className="slider w-full"
                  min={0}
                  max={1}
                  step={0.05}
                  value={f.weights[k] ?? 0}
                  onChange={(e) => set('weights', { ...f.weights, [k]: Number(e.target.value) })}
                  style={{ background: `linear-gradient(90deg, #FF7A45 ${(f.weights[k] ?? 0) * 100}%, rgb(var(--surface-2)) 0)` }}
                />
              </div>
            ))}
            <p className="text-xs text-subtle">
              Total weight <b className="num">{wsum.toFixed(2)}</b>
              {Math.abs(wsum - 1) > 0.001 && ' — indices are computed over the total you set.'}
            </p>
          </div>
        </Card>
        <Card className="p-5">
          <Field label="Change note">
            <Input value={f.change_note} onChange={(e) => set('change_note', e.target.value)} placeholder="e.g. Excluded Chennai — no service" />
          </Field>
          {errs && Object.keys(errs).length > 0 && (
            <ul className="mt-3 space-y-1 rounded-xl bg-bad-soft/60 p-3 text-xs text-bad" role="alert">
              {Object.entries(errs).map(([k, v]) => (
                <li key={k}>
                  <b>{k}</b>: {v}
                </li>
              ))}
            </ul>
          )}
          <Button
            className="mt-4 w-full"
            variant="brand"
            icon={<Save className="h-4 w-4" />}
            disabled={!dirty}
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (r) => {
                  setDirty(false);
                  toast.success(`Saved constraints v${r.constraints.version}`, 'Start a new research run to apply them; previous results are kept.');
                },
                onError: (e) => toast.error('Could not save constraints', e),
              })
            }
          >
            Save constraints
          </Button>
        </Card>
      </div>
    </div>
  );
}

/* ================================================================== versions */
function VersionsTab() {
  const { pid } = useProjectCtx();
  const pq = useProduct(pid);
  const cq = useConstraints(pid);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Product versions" icon={<Package className="h-4 w-4" />} />
        {pq.isLoading ? (
          <div className="p-5"><SkeletonCard /></div>
        ) : (
          <ol className="relative space-y-0 p-5">
            {(pq.data?.versions ?? []).map((v, i) => (
              <li key={v.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < (pq.data?.versions.length ?? 0) - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" aria-hidden />}
                <span className={cn('z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', i === 0 ? 'bg-ink text-white dark:bg-white dark:text-[#0E1320]' : 'bg-surface2 text-muted')}>
                  v{v.version}
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    {v.change_note || (v.version === 1 ? 'Initial version' : 'No change note')} {i === 0 && <Badge tone="ok">current</Badge>} {v.is_synthetic && <Badge tone="brand">synthetic</Badge>}
                  </p>
                  <p className="text-xs text-subtle">{fmtDate(v.created_at)}</p>
                </div>
              </li>
            ))}
            {pq.data?.versions.length === 0 && <EmptyState title="No versions yet" />}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title="Constraint versions" icon={<SlidersHorizontal className="h-4 w-4" />} />
        {cq.isLoading ? (
          <div className="p-5"><SkeletonCard /></div>
        ) : (
          <ol className="p-5">
            {(cq.data?.history ?? []).map((v, i) => (
              <li key={v.version} className="relative flex gap-3 pb-5 last:pb-0">
                {i < (cq.data?.history.length ?? 0) - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" aria-hidden />}
                <span className={cn('z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', i === 0 ? 'bg-ink text-white dark:bg-white dark:text-[#0E1320]' : 'bg-surface2 text-muted')}>
                  v{v.version}
                </span>
                <div>
                  <p className="text-sm font-semibold">{v.change_note || 'No change note'} {i === 0 && <Badge tone="ok">current</Badge>}</p>
                  <p className="text-xs text-subtle">{fmtDate(v.created_at)}</p>
                </div>
              </li>
            ))}
            {cq.data?.history.length === 0 && <EmptyState title="No versions yet" />}
          </ol>
        )}
      </Card>
    </div>
  );
}
