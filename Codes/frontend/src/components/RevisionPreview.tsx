/**
 * Before/after confirm sheet for a revision. The preview is a dry run
 * (POST …/revisions/preview writes nothing and calls no provider), allowed on
 * the read-only sample; applying is a separate, explicit step.
 */
import { useState, type ReactNode } from 'react';
import { ArrowRight, CircleCheck, Eye, RefreshCw, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';
import { mutations, useApiMutation, useRevisionPreview, type RevisionBody } from '../api/hooks';
import type { Run } from '../api/types';
import { humanize } from '../lib/format';
import { Editable, LockNote, useLocked } from './Locked';
import { Modal } from './Overlay';
import { useProjectCtx } from './ProjectContext';
import { useToast } from './Toast';
import { Badge, Button, ErrorState, Skeleton } from './ui';

export function RevisionPreviewSheet({
  open,
  body,
  onClose,
  onApplied,
  rationale,
}: {
  open: boolean;
  body: RevisionBody | null;
  onClose: () => void;
  onApplied?: (r: { run?: Run }) => void;
  rationale?: ReactNode;
}) {
  const { pid, setConsoleRunId } = useProjectCtx();
  const locked = useLocked();
  const toast = useToast();
  const q = useRevisionPreview(pid, open ? body : null);
  const [applyErr, setApplyErr] = useState<unknown>(null);
  const apply = useApiMutation(
    () => mutations.applyRevision(pid, { ...body!, rerun: true }),
    [['project', pid], ['runs', pid], ['revisions', pid], ['constraints', pid], ['product', pid], ['audiences', pid], ['strategies', pid]],
  );
  const p = q.data;
  return (
    <Modal
      open={open}
      onClose={() => (setApplyErr(null), onClose())}
      size="lg"
      icon={<Eye className="h-4 w-4" />}
      title={p?.summary ?? 'Preview the revision'}
      description="What would change and what stays as it is. Nothing has been written yet."
      footer={
        <>
          {locked && <LockNote className="mr-auto" />}
          <Button variant="ghost" onClick={onClose}>
            Keep things as they are
          </Button>
          <Editable>
            <Button
              variant="brand"
              icon={<RotateCcw className="h-4 w-4" />}
              data-tip="revision-apply"
              disabled={!p}
              loading={apply.isPending}
              onClick={() =>
                apply.mutate(undefined, {
                  onSuccess: (r) => {
                    if (r.run) setConsoleRunId(r.run.id);
                    toast.success('Revision applied as a new version', r.run ? 'A new research run started; earlier results are preserved.' : undefined);
                    onApplied?.(r);
                    onClose();
                  },
                  onError: (e) => setApplyErr(e),
                })
              }
            >
              Apply &amp; re-run
            </Button>
          </Editable>
        </>
      }
    >
      <div className="space-y-4" data-testid="revision-preview">
        {rationale && <p className="rounded-xl bg-surface2/70 px-3 py-2 text-[13px] text-muted">{rationale}</p>}
        {q.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {p && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{humanize(p.kind)}</Badge>
              <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>
                Preview only — nothing has been written
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch">
              <Panel tone="keep" title="Stays as it is" icon={<CircleCheck className="h-4 w-4 text-ok" />} data={p.preserved} />
              <div className="hidden items-center justify-center sm:flex" aria-hidden>
                <ArrowRight className="h-5 w-5 text-subtle" />
              </div>
              <Panel tone="change" title="Will change or re-run" icon={<RefreshCw className="h-4 w-4 text-warn" />} data={p.affected} />
            </div>
            <p className="flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-[13px]">
              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
              <span>
                <b className="font-semibold">Cost if applied: </b>
                {p.cost_if_applied}
              </span>
            </p>
          </>
        )}
        {applyErr != null && <ErrorState error={applyErr} compact />}
      </div>
    </Modal>
  );
}

function Panel({ title, icon, data, tone }: { title: string; icon: ReactNode; data: Record<string, unknown>; tone: 'keep' | 'change' }) {
  const entries = Object.entries(data ?? {});
  return (
    <section className={tone === 'keep' ? 'rounded-2xl border border-ok/25 bg-ok-soft/30 p-4' : 'rounded-2xl border border-warn/30 bg-warn-soft/30 p-4'} aria-label={title}>
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        {icon} {title}
      </p>
      {entries.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nothing listed.</p>
      ) : (
        <dl className="space-y-2 text-[12.5px]">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-fg">{humanize(k)}</dt>
              <dd className="text-muted">{renderValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function renderValue(v: unknown): ReactNode {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v === 0 ? 'none' : v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'none';
    return (
      <ul className="mt-0.5 flex flex-wrap gap-1">
        {v.slice(0, 12).map((x, i) => (
          <li key={i}>
            <Badge tone="neutral">{typeof x === 'object' && x && 'label' in x ? String((x as { label: unknown }).label) : String(x)}</Badge>
          </li>
        ))}
        {v.length > 12 && <li className="text-subtle">+{v.length - 12} more</li>}
      </ul>
    );
  }
  return JSON.stringify(v);
}
