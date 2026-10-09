import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Archive, ArchiveRestore, ArrowRight, CheckCircle2, FlaskConical, FolderPlus, ImageIcon, Lock, Map as MapIcon, Network, Plus, Sparkles, WandSparkles, Gauge } from 'lucide-react';
import { useMe } from '../api/hooks';
import { useFirstVisit } from '../hooks/useTheme';
import { mutations, useApiMutation, useProjects } from '../api/hooks';
import type { JourneyStageKey, ProjectListItem } from '../api/types';
import { DuplicateButton } from '../components/Locked';
import { PageWrap } from '../components/AppShell';
import { Modal } from '../components/Overlay';
import { useToast } from '../components/Toast';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonCard, Textarea, fadeUp, stagger } from '../components/ui';
import { ApiError } from '../api/client';
import { cn, timeAgo } from '../lib/format';


export default function Projects() {
  const [archived, setArchived] = useState(false);
  const q = useProjects(archived);
  const [creating, setCreating] = useState(false);
  const items = q.data?.items ?? [];
  const firstVisit = useFirstVisit('ll-dash-reveal');
  return (
    <PageWrap>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Each project holds a product, its audiences and launch constraints, research runs, strategies and generated creative — all versioned."
        actions={
          <>
            <Checkbox checked={archived} onChange={setArchived} label="Show archived" />
            <Button variant="brand" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New project
            </Button>
          </>
        }
      />
      {items.some((p) => p.is_demo) && <JuryTour pid={items.find((p) => p.is_demo)!.id} />}
      {q.isLoading && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} lines={5} />
          ))}
        </div>
      )}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.isLoading && !q.error && items.length === 0 && (
        <EmptyState
          icon={<FolderPlus className="h-5 w-5" />}
          title="No projects yet"
          action={
            <Button variant="brand" onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              Create your first project
            </Button>
          }
        >
          Start with a product and the country you plan to launch in.
        </EmptyState>
      )}
      <motion.ul variants={stagger(0.07)} initial={firstVisit ? 'hidden' : false} animate="show" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <motion.li key={p.id} variants={fadeUp}>
            <ProjectCard p={p} />
          </motion.li>
        ))}
        {items.length > 0 && (
          <motion.li variants={fadeUp}>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="group flex h-full min-h-[280px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted transition hover:border-brand/50 hover:bg-brand-soft/30 hover:text-fg"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-card transition group-hover:scale-110">
                <Plus className="h-5 w-5" />
              </span>
              <span className="mt-3 font-display font-semibold">New project</span>
            </button>
          </motion.li>
        )}
      </motion.ul>
      <CreateProject open={creating} onClose={() => setCreating(false)} />
    </PageWrap>
  );
}

const STAGE_ORDER: { key: JourneyStageKey; label: string }[] = [
  { key: 'brief', label: 'Brief' },
  { key: 'audience', label: 'Audience' },
  { key: 'explore', label: 'Explore' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'create', label: 'Create' },
  { key: 'export', label: 'Export' },
];
const STATUS_TEXT: Record<string, string> = { done: 'complete', attention: 'needs attention', active: 'in progress', todo: 'not started' };

function ProjectCard({ p }: { p: ProjectListItem }) {
  const toast = useToast();
  const nav = useNavigate();
  const archive = useApiMutation((v: boolean) => mutations.patchProject(p.id, { archived: v }), [['projects']]);
  const outputs = p.recent_outputs.filter((a) => a.mime_type.startsWith('image/')).slice(0, 3);
  const j = p.journey;
  const statusOf = (k: JourneyStageKey) => j?.stages.find((s) => s.key === k)?.status ?? 'todo';
  const next = j?.next_action ?? null;
  const locked = !!p.locked;
  return (
    <article className="card group relative flex h-full flex-col overflow-hidden transition-shadow duration-200 hover:shadow-lift" data-testid={locked ? 'sample-card' : undefined}>
      <div className="relative flex h-40 gap-1 overflow-hidden bg-gradient-to-br from-[#FFE9DE] via-[#FFF6F1] to-[#E7F0FF] p-1 dark:from-brand-soft dark:via-surface2 dark:to-accent-soft">
        <div className="relative flex w-2/5 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/70 dark:bg-surface">
          {p.thumbnail_url ? (
            <img src={p.thumbnail_url} alt={`${p.name} product photo`} className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100" loading="lazy" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs text-muted">
              <ImageIcon className="h-5 w-5" /> No product photo
            </span>
          )}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">
          {outputs.map((a) => (
            <img key={a.id} src={a.url} alt={`Generated ${a.kind}${a.preset ? ` (${a.preset})` : ''}`} loading="lazy" className="h-full w-full rounded-lg object-cover" />
          ))}
          {outputs.length === 0 && <div className="col-span-3 flex items-center justify-center rounded-lg text-xs text-muted">No ads generated yet</div>}
        </div>
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {p.is_demo && <Badge tone="brand" icon={<Sparkles className="h-3 w-3" />}>Sample · synthetic</Badge>}
          {locked && <Badge tone="accent" icon={<Lock className="h-3 w-3" />}>Read-only</Badge>}
          {p.archived && <Badge>Archived</Badge>}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="font-display text-[17px] font-bold leading-snug">
          <Link to={`/projects/${p.id}`} className="hover:underline">
            {p.name}
          </Link>
        </h2>
        <p className="mt-1.5 line-clamp-2 text-[13.5px] text-muted">{p.goal || 'No goal written yet.'}</p>
        <div className="mt-4">
          <ol className="flex items-center gap-1" aria-label="Journey progress">
            {STAGE_ORDER.map((s) => {
              const st = statusOf(s.key);
              return (
                <li key={s.key} className="flex-1" title={`${s.label}: ${STATUS_TEXT[st]}`}>
                  <span className={cn('block h-1.5 rounded-full', st === 'done' ? 'bg-ok' : st === 'active' ? 'bg-accent' : st === 'attention' ? 'bg-warn' : 'bg-line')} />
                  <span className="mt-1 block text-center text-[10px] text-subtle">
                    {st === 'done' ? '✓ ' : st === 'attention' ? '! ' : st === 'active' ? '… ' : ''}
                    {s.label}
                    <span className="sr-only"> — {STATUS_TEXT[st]}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[12.5px] text-muted">
            {j?.last_completed ? (
              <>
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-ok" aria-hidden />
                Last completed: <b className="text-fg">{j.last_completed}</b>
              </>
            ) : (
              'Not started yet'
            )}
            {p.last_run && <span className="text-subtle"> · research {p.last_run.status.replace(/_/g, ' ')}</span>}
            <span className="text-subtle"> · updated {timeAgo(p.updated_at)}</span>
          </p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {locked ? (
            <>
              <Button variant="primary" className="flex-1" onClick={() => nav(`/projects/${p.id}`)} aria-label={`Open sample: ${p.name}`}>
                Open sample <ArrowRight className="h-4 w-4" />
              </Button>
              <DuplicateButton pid={p.id} variant="outline" size="md" />
            </>
          ) : (
            <>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => nav(next?.to ?? `/projects/${p.id}`)}
                aria-label={`Continue ${p.name}${next ? `: ${next.label}` : ''}`}
              >
                <span className="truncate">Continue{next ? ` · ${next.label}` : ''}</span> <ArrowRight className="h-4 w-4 shrink-0" />
              </Button>
              <button
                type="button"
                onClick={() =>
                  archive.mutate(!p.archived, {
                    onSuccess: () => toast.success(p.archived ? 'Project restored' : 'Project archived', p.archived ? undefined : 'Nothing is deleted; show archived projects to restore it.'),
                    onError: (e) => toast.error('Could not update project', e),
                  })
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                aria-label={p.archived ? `Restore ${p.name}` : `Archive ${p.name}`}
                title={p.archived ? 'Restore' : 'Archive'}
              >
                {p.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
        {next && !locked && <p className="mt-2 line-clamp-2 text-[11.5px] text-subtle">{next.why}</p>}
      </div>
    </article>
  );
}

function CreateProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [country, setCountry] = useState('IN');
  const [currency, setCurrency] = useState('INR');
  const [fields, setFields] = useState<Record<string, string>>({});
  const nav = useNavigate();
  const toast = useToast();
  const create = useApiMutation(mutations.createProject, [['projects']]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="You can add the product brief, audiences and constraints next."
      icon={<FolderPlus className="h-4 w-4" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="brand"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() =>
              create.mutate(
                { name: name.trim(), goal, country_code: country.toUpperCase(), currency: currency.toUpperCase() },
                {
                  onSuccess: (p) => {
                    toast.success('Project created');
                    onClose();
                    nav(`/projects/${p.id}/brief`);
                  },
                  onError: (e) => {
                    if (e instanceof ApiError) setFields(e.fields);
                    toast.error('Could not create project', e);
                  },
                },
              )
            }
          >
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Project name" required htmlFor="pname" error={fields.name}>
          <Input id="pname" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Breeze chair — East India pilot" />
        </Field>
        <Field label="Goal" htmlFor="pgoal" hint="What decision should this project help you make?" error={fields.goal}>
          <Textarea id="pgoal" value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country (ISO-2)" htmlFor="pcountry" error={fields.country_code}>
            <Input id="pcountry" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} />
          </Field>
          <Field label="Currency (ISO-3)" htmlFor="pcur" error={fields.currency}>
            <Input id="pcur" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function JuryTour({ pid }: { pid: string }) {
  const me = useMe().data;
  const steps = [
    { to: `/projects/${pid}`, icon: Sparkles, t: 'Overview', d: 'Run timeline & decisions' },
    { to: `/projects/${pid}/audiences#taste-story`, icon: Network, t: 'Why these places?', d: 'Interests → Qloo → placement → ad' },
    { to: `/projects/${pid}/compare?view=impact`, icon: FlaskConical, t: 'What Qloo changed', d: 'Baseline vs taste-informed' },
    { to: `/projects/${pid}/explorer`, icon: MapIcon, t: 'Market explorer', d: 'Map, places, evidence' },
    { to: `/projects/${pid}/studio`, icon: WandSparkles, t: 'Why this message?', d: 'Copy traced to evidence' },
    { to: `/projects/${pid}/settings`, icon: Gauge, t: 'Status', d: 'Honest provider state' },
  ];
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mb-8 overflow-hidden rounded-3xl bg-[#0E1320] p-6 text-white shadow-lift sm:p-8"
      aria-label="Guided tour"
    >
      <div aria-hidden className="absolute -left-16 -top-24 h-72 w-72 animate-mesh rounded-full bg-[#FF7A45]/35 blur-[90px]" />
      <div aria-hidden className="absolute -bottom-24 right-0 h-72 w-72 animate-mesh rounded-full bg-[#1F6FEB]/35 blur-[90px] [animation-delay:-6s]" />
      <div className="relative">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#FFB088]">Welcome{me ? `, ${me.user.display_name}` : ''}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">A six-stop tour of the sample launch</h2>
          <Link
            to={`/projects/${pid}`}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-[#FF8A5B] to-[#FF6A2F] px-5 text-[15px] font-semibold text-[#1A0E08] shadow-[0_14px_30px_-10px_rgb(255_106_47/0.75)] transition hover:brightness-105"
          >
            Open the sample project <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm text-white/65">Everything below is live data from the backend: research runs, evidence, strategies and real xAI flyers and videos. Synthetic product specs are labelled as such.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {steps.map((s, i) => (
            <li key={s.t}>
              <Link to={s.to} className="group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 backdrop-blur transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.09]">
                <span className="flex items-center justify-between">
                  <s.icon className="h-4 w-4 text-[#FFB088]" />
                  <span className="font-display text-xs font-bold text-white/40">0{i + 1}</span>
                </span>
                <span className="mt-3 text-sm font-semibold">{s.t}</span>
                <span className="mt-0.5 text-xs text-white/55">{s.d}</span>
                <ArrowRight className="mt-2 h-3.5 w-3.5 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white" />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </motion.section>
  );
}
