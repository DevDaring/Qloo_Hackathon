import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Bug, CalendarClock, ExternalLink, FileSearch, Globe2, Ruler, ShieldAlert, Sigma } from 'lucide-react';
import { get } from '../api/client';
import { useEvidence } from '../api/hooks';
import type { EvidenceCard } from '../api/types';
import { cn, fmtDate, humanize } from '../lib/format';
import { EVIDENCE_BADGES, KIND_TO_BADGE } from '../lib/labels';
import { Drawer } from './Overlay';
import { EmptyState, ErrorState, Skeleton, Tooltip } from './ui';

/* ------------------------------------------------------------------ badges */
export function EvidenceBadge({ badge, kind, className, size = 'sm' }: { badge?: string; kind?: string; className?: string; size?: 'sm' | 'md' }) {
  const key = badge ?? (kind ? KIND_TO_BADGE[kind] : undefined) ?? 'Unknown';
  const b = EVIDENCE_BADGES[key] ?? EVIDENCE_BADGES.Unknown;
  return (
    <Tooltip content={<><b>{b.label}.</b> {b.meaning}</>}>
      <span
        tabIndex={0}
        className={cn(
          'inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-none',
          size === 'sm' ? 'px-2 py-[3px] text-[11px]' : 'px-2.5 py-1 text-xs',
          b.cls,
          className,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', b.dot)} aria-hidden />
        {b.label}
      </span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ context */
interface EvidenceCtx {
  open: (ids: string[], title?: string) => void;
}
const Ctx = createContext<EvidenceCtx>({ open: () => undefined });
export const useEvidenceDrawer = () => useContext(Ctx);

export function EvidenceProvider({ projectId, children }: { projectId?: string; children: ReactNode }) {
  const [state, setState] = useState<{ ids: string[]; title: string } | null>(null);
  const open = useCallback((ids: string[], title?: string) => setState({ ids: Array.from(new Set(ids.filter(Boolean))), title: title ?? 'Evidence' }), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <EvidenceDrawer projectId={projectId} state={state} onClose={() => setState(null)} />
    </Ctx.Provider>
  );
}

/** A small button that opens the evidence drawer for a recommendation. */
export function EvidenceChip({ ids, title, className, label }: { ids?: string[] | null; title?: string; className?: string; label?: string }) {
  const { open } = useEvidenceDrawer();
  const n = ids?.length ?? 0;
  if (!n)
    return (
      <Tooltip content="No evidence is cited for this item. Treat it as unsupported until evidence exists.">
        <span tabIndex={0} className={cn('inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-[3px] text-[11px] font-medium text-subtle', className)}>
          <FileSearch className="h-3 w-3" /> No evidence
        </span>
      </Tooltip>
    );
  return (
    <button
      type="button"
      onClick={() => open(ids!, title)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-accent/25 bg-accent-soft px-2 py-[3px] text-[11px] font-semibold text-accent-ink transition hover:border-accent/50 hover:shadow-ring active:scale-95',
        className,
      )}
      aria-label={`Show ${n} evidence item${n > 1 ? 's' : ''}${title ? ` for ${title}` : ''}`}
    >
      <FileSearch className="h-3 w-3" />
      {label ?? `${n} evidence`}
    </button>
  );
}

/* ------------------------------------------------------------------ drawer */
function EvidenceDrawer({ projectId, state, onClose }: { projectId?: string; state: { ids: string[]; title: string } | null; onClose: () => void }) {
  const q = useEvidence(projectId, state?.ids);
  const items = q.data?.items ?? [];
  const missing = state ? state.ids.filter((id) => !items.some((x) => x.id === id)) : [];
  return (
    <Drawer
      open={!!state}
      onClose={onClose}
      title={state?.title ?? 'Evidence'}
      subtitle={<span>Source, date, scope and limitations for each cited item. Raw provider payloads stay in diagnostics.</span>}
      width="max-w-xl"
    >
      {q.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      )}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.isLoading && !q.error && items.length === 0 && <EmptyState title="No evidence records found">The cited ids did not match evidence in this project.</EmptyState>}
      <div className="space-y-3">
        {items.map((e, i) => (
          <motion.div key={e.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <EvidenceCardView e={e} />
          </motion.div>
        ))}
      </div>
      {!q.isLoading && missing.length > 0 && items.length > 0 && (
        <p className="mt-3 text-xs text-subtle">{missing.length} cited id(s) could not be found and are treated as unsupported.</p>
      )}
    </Drawer>
  );
}

export function EvidenceCardView({ e }: { e: EvidenceCard }) {
  const [diag, setDiag] = useState(false);
  const d = useQuery({
    queryKey: ['evidence-diag', e.id],
    queryFn: () => get<EvidenceCard>(`/evidence/${e.id}`, { diagnostics: true }),
    enabled: diag,
  });
  const scopeEntries = Object.entries(e.scope ?? {}).filter(([, v]) => typeof v !== 'object' || v === null);
  return (
    <article className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceBadge badge={e.badge} kind={e.kind} />
        <span className="chip">{humanize(e.topic)}</span>
        {e.status && e.status !== 'supported' && <span className="chip">{humanize(e.status)}</span>}
      </div>
      <h3 className="mt-2.5 font-display text-[15px] font-semibold leading-snug">{e.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{e.statement}</p>
      {e.value !== null && (
        <p className="mt-2 inline-flex items-baseline gap-1 rounded-lg bg-surface2 px-2.5 py-1">
          <span className="num font-display text-lg font-bold">{e.value.toLocaleString()}</span>
          <span className="text-xs text-muted">{e.units}</span>
        </p>
      )}
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
        <Meta icon={<Globe2 className="h-3.5 w-3.5" />} k="Source">
          {e.source_ref?.startsWith('http') ? (
            <a href={e.source_ref} target="_blank" rel="noreferrer noopener" className="link inline-flex items-center gap-1">
              {e.source} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            e.source || 'Unknown'
          )}
        </Meta>
        <Meta icon={<CalendarClock className="h-3.5 w-3.5" />} k="Retrieved">
          {fmtDate(e.retrieved_at)}
        </Meta>
        {e.period && (
          <Meta icon={<CalendarClock className="h-3.5 w-3.5" />} k="Period">
            {e.period}
          </Meta>
        )}
        {e.formula && (
          <Meta icon={<Sigma className="h-3.5 w-3.5" />} k="Formula">
            <code className="font-mono text-[11.5px]">{e.formula}</code>
          </Meta>
        )}
        {scopeEntries.length > 0 && (
          <Meta icon={<Ruler className="h-3.5 w-3.5" />} k="Scope">
            {scopeEntries.map(([k, v]) => `${humanize(k)}: ${String(v)}`).join(' · ')}
          </Meta>
        )}
      </dl>
      {e.limitations && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft/60 px-3 py-2 text-[12.5px] text-fg">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            <b className="font-semibold">Limitations: </b>
            {e.limitations}
          </span>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10.5px] text-subtle">id {e.id.slice(0, 8)}</span>
        <button type="button" onClick={() => setDiag((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg" aria-expanded={diag}>
          <Bug className="h-3.5 w-3.5" /> {diag ? 'Hide diagnostics' : 'Diagnostics'}
        </button>
      </div>
      {diag && (
        <div className="mt-2">
          {d.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : d.error ? (
            <ErrorState error={d.error} compact />
          ) : (
            <pre className="scroll-thin max-h-64 overflow-auto rounded-xl bg-[#0E1320] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
              {JSON.stringify(d.data?.payload ?? {}, null, 2)}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}

function Meta({ icon, k, children }: { icon: ReactNode; k: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <span className="mt-0.5 text-subtle">{icon}</span>
      <dt className="shrink-0 text-subtle">{k}:</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}
