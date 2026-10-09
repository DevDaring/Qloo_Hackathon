import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Archive, ArchiveRestore, ArrowRight, ArrowUpRight, FolderPlus, ImageIcon, Map as MapIcon, Play, Plus, Scale, Sparkles, Target, WandSparkles, Gauge } from 'lucide-react';
import { useMe } from '../api/hooks';
import { mutations, useApiMutation, useProjects } from '../api/hooks';
import type { ProjectListItem } from '../api/types';
import { PageWrap } from '../components/AppShell';
import { Modal } from '../components/Overlay';
import { useToast } from '../components/Toast';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonCard, StatusPill, Textarea, fadeUp, stagger } from '../components/ui';
import { ApiError } from '../api/client';
import { humanize, timeAgo } from '../lib/format';
import { STAGES } from '../lib/labels';

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

export default function Projects() {
  const [archived, setArchived] = useState(false);
  const q = useProjects(archived);
  const [creating, setCreating] = useState(false);
  const items = q.data?.items ?? [];
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
      <motion.ul variants={stagger(0.07)} initial="hidden" animate="show" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
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

function ProjectCard({ p }: { p: ProjectListItem }) {
  const toast = useToast();
  const archive = useApiMutation((v: boolean) => mutations.patchProject(p.id, { archived: v }), [['projects']]);
  const outputs = p.recent_outputs.filter((a) => a.mime_type.startsWith('image/') || a.kind === 'video_final');
  return (
    <article className="card card-hover group relative flex h-full flex-col overflow-hidden">
      <div className="relative h-36 overflow-hidden bg-gradient-to-br from-[#FFE9DE] via-[#FFF6F1] to-[#E7F0FF] dark:from-brand-soft dark:via-surface2 dark:to-accent-soft">
        {outputs.length > 0 ? (
          <div className="grid h-full grid-cols-4 gap-1 p-1">
            {outputs.slice(0, 4).map((a) =>
              a.mime_type.startsWith('image/') ? (
                <img key={a.id} src={a.url} alt={a.label || a.kind} loading="lazy" className="h-full w-full rounded-lg object-cover" />
              ) : (
                <div key={a.id} className="relative overflow-hidden rounded-lg bg-ink">
                  <video src={`${a.url}#t=2`} muted preload="metadata" className="h-full w-full object-cover" aria-hidden />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 shadow"><Play className="ml-0.5 h-3 w-3 fill-[#0E1320] text-[#0E1320]" /></span>
                  </span>
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              <ImageIcon className="h-4 w-4" /> No generated outputs yet
            </div>
          </div>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {p.is_demo && <Badge tone="brand" icon={<Sparkles className="h-3 w-3" />}>Sample · synthetic</Badge>}
          {p.archived && <Badge>Archived</Badge>}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display text-[17px] font-bold leading-snug">
            <Link to={`/projects/${p.id}`} className="after:absolute after:inset-0 focus:outline-none">
              {p.name}
            </Link>
          </h2>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-subtle transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" />
        </div>
        <p className="mt-1.5 line-clamp-2 text-[13.5px] text-muted">{p.goal || 'No goal written yet.'}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill status={p.status} label={humanize(p.status)} />
          <Badge tone="neutral">
            {p.country_code} · {p.currency}
          </Badge>
          <Badge tone="accent" icon={<Target className="h-3 w-3" />}>
            {p.strategies} strateg{p.strategies === 1 ? 'y' : 'ies'}
          </Badge>
        </div>
        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px]">
            {p.last_run ? (
              <span className="flex min-w-0 items-center gap-2 text-muted">
                <StatusPill status={p.last_run.status} />
                <span className="truncate">{STAGE_LABEL[p.last_run.stage] ?? humanize(p.last_run.stage)}</span>
              </span>
            ) : (
              <span className="text-subtle">No research run yet</span>
            )}
            <span className="shrink-0 text-subtle">updated {timeAgo(p.updated_at)}</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          archive.mutate(!p.archived, {
            onSuccess: () => toast.success(p.archived ? 'Project restored' : 'Project archived', p.archived ? undefined : 'Nothing is deleted; show archived projects to restore it.'),
            onError: (e) => toast.error('Could not update project', e),
          })
        }
        className="absolute right-3 top-3 z-10 rounded-lg bg-surface/90 p-1.5 text-muted opacity-0 shadow-card transition hover:text-fg focus:opacity-100 group-hover:opacity-100"
        aria-label={p.archived ? `Restore ${p.name}` : `Archive ${p.name}`}
        title={p.archived ? 'Restore' : 'Archive'}
      >
        {p.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </button>
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
    { to: `/projects/${pid}/explorer`, icon: MapIcon, t: 'Market explorer', d: 'Map, places, evidence' },
    { to: `/projects/${pid}/compare`, icon: Scale, t: 'Compare', d: 'Chennai excluded — why' },
    { to: `/projects/${pid}/strategy`, icon: Target, t: 'Strategy', d: 'Hypotheses & placements' },
    { to: `/projects/${pid}/studio`, icon: WandSparkles, t: 'Ad studio', d: 'Bengali flyers & video' },
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
        <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">A six-stop tour of the sample launch</h2>
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
