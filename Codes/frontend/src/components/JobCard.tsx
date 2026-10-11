import { useState } from 'react';
import { AlertTriangle, CircleStop, RotateCcw, ShieldQuestion } from 'lucide-react';
import { ApiError } from '../api/client';
import { isActiveJob, mutations, useApiMutation, useJob } from '../api/hooks';
import type { Job } from '../api/types';
import { fmtTime, fmtUsd, humanize, shortId, timeAgo } from '../lib/format';
import { ConfirmDialog, Modal } from './Overlay';
import { useToast } from './Toast';
import { Badge, Button, Callout, StatusPill } from './ui';

/** Real job state from the worker: status, attempts, remote ids, cost — never a fake percentage. */
export function JobCard({ job, pid }: { job: Job; pid: string }) {
  const q = useJob(job.id);
  const j = q.data ?? { ...job, attempts: [] };
  const toast = useToast();
  const [reconcile, setReconcile] = useState<string[] | null>(null);
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inval = [['jobs', pid], ['brief'], ['briefs', pid], ['job', job.id]];
  const retry = useApiMutation((confirm: boolean) => mutations.retryJob(job.id, confirm), inval);
  const cancel = useApiMutation(() => mutations.cancelJob(job.id), inval);
  const rec = useApiMutation((v: { id: string; outcome: 'not_charged' | 'charged_no_output' }) => mutations.reconcile(v.id, v.outcome), inval);
  const attempts = Array.isArray(j.attempts) ? j.attempts : [];
  const unknownAtt = attempts.filter((a) => a.status === 'submission_unknown');
  const failed = ['failed', 'partially_completed', 'cancelled'].includes(j.status);
  const progress = (j.progress ?? {}) as Record<string, unknown>;

  const doRetry = (confirm: boolean) =>
    retry.mutate(confirm, {
      onSuccess: (r) => {
        setConfirmUnknown(false);
        toast.success('Retry queued', r.reused);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'reconcile_first') setReconcile((e.details.attempt_ids as string[]) ?? unknownAtt.map((a) => a.id));
        else toast.error('Could not retry', e);
      },
    });

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-bold capitalize">{j.kind} job</span>
        <StatusPill status={j.status} />
        <span className="font-mono text-[11px] text-subtle">{shortId(j.id)}</span>
        <span className="ml-auto text-xs text-subtle">
          created {timeAgo(j.created_at)}
          {j.finished_at ? ` · finished ${fmtTime(j.finished_at)}` : j.heartbeat_at ? ` · heartbeat ${fmtTime(j.heartbeat_at)}` : ''}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <Badge>attempt {job.attempts}/{j.max_attempts}</Badge>
        {j.cost_cap_usd != null && <Badge tone="brand">cap {fmtUsd(j.cost_cap_usd)}</Badge>}
        {Object.entries(progress).map(([k, v]) => (
          <Badge key={k} tone="accent">
            {humanize(k)}: {typeof v === 'object' ? Object.entries(v as object).map(([a, b]) => `${a} ${b}`).join(', ') : String(v)}
          </Badge>
        ))}
      </div>
      {narrationProviders(j.result).length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Narration providers used: <b className="text-fg">{narrationProviders(j.result).join(', ')}</b> (TTS narration is labelled “needs review”)
        </p>
      )}
      {j.error && (
        <Callout tone="bad" className="mt-3 text-xs" icon={<AlertTriangle className="h-4 w-4 text-bad" />}>
          <b>{humanize(j.error.kind ?? j.error.code ?? 'error')}:</b> {j.error.message ?? JSON.stringify(j.error).slice(0, 200)}
        </Callout>
      )}
      {attempts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left text-subtle">
                <th className="py-1 pr-2 font-medium">Provider · operation</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Remote request id</th>
                <th className="py-1 pr-2 text-right font-medium">Reserved</th>
                <th className="py-1 text-right font-medium">Actual</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-t border-line/70">
                  <td className="py-1 pr-2">
                    {a.provider} · {a.operation}
                    <span className="block text-subtle">{a.model}</span>
                  </td>
                  <td className="py-1 pr-2">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="max-w-[160px] truncate py-1 pr-2 font-mono text-subtle" title={a.remote_request_id ?? ''}>
                    {a.remote_request_id ?? '—'}
                  </td>
                  <td className="num py-1 pr-2 text-right">{fmtUsd(a.cost_reserved_usd, 3)}</td>
                  <td className="num py-1 text-right">{a.cost_actual_usd != null ? fmtUsd(a.cost_actual_usd, 3) : 'not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {failed && (
          <Button size="sm" variant="outline" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={retry.isPending} onClick={() => doRetry(false)}>
            Retry
          </Button>
        )}
        {unknownAtt.length > 0 && (
          <Button size="sm" variant="outline" icon={<ShieldQuestion className="h-3.5 w-3.5" />} onClick={() => setReconcile(unknownAtt.map((a) => a.id))}>
            Reconcile {unknownAtt.length} unknown submission{unknownAtt.length > 1 ? 's' : ''}
          </Button>
        )}
        {isActiveJob(j.status) && (
          <Button size="sm" variant="ghost" icon={<CircleStop className="h-3.5 w-3.5" />} onClick={() => setConfirmCancel(true)}>
            Cancel
          </Button>
        )}
      </div>

      <Modal
        open={!!reconcile}
        onClose={() => setReconcile(null)}
        icon={<ShieldQuestion className="h-4 w-4" />}
        title="Paid requests with an unknown outcome"
        description="A submission may have succeeded at the provider without LaunchLens receiving a response. Retrying blindly could pay twice."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReconcile(null)}>
              Close
            </Button>
            <Button variant="danger" onClick={() => (setReconcile(null), setConfirmUnknown(true))}>
              Retry anyway…
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">Check the provider console (NanoGPT, or xAI if the fallback was used) for these request ids, then record what happened. Reservations are kept until each is resolved.</p>
        <ul className="space-y-2">
          {(reconcile ?? []).map((id) => {
            const a = attempts.find((x) => x.id === id);
            return (
              <li key={id} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-mono text-xs">attempt {shortId(id)} · remote {a?.remote_request_id ?? 'unknown'}</p>
                <p className="text-xs text-muted">reserved {fmtUsd(a?.cost_reserved_usd, 3)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" loading={rec.isPending} onClick={() => rec.mutate({ id, outcome: 'not_charged' }, { onSuccess: (r) => toast.success('Recorded: not charged', `Ledger ${r.ledger ?? 'n/a'}`), onError: (e) => toast.error('Could not reconcile', e) })}>
                    Not charged — release
                  </Button>
                  <Button size="sm" variant="outline" loading={rec.isPending} onClick={() => rec.mutate({ id, outcome: 'charged_no_output' }, { onSuccess: (r) => toast.success('Recorded: charged, no output', `Ledger ${r.ledger ?? 'n/a'}`), onError: (e) => toast.error('Could not reconcile', e) })}>
                    Charged, no output
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Modal>
      <ConfirmDialog
        open={confirmUnknown}
        onClose={() => setConfirmUnknown(false)}
        tone="danger"
        title="Retry and possibly pay again?"
        confirmLabel="Retry with a fresh request"
        loading={retry.isPending}
        onConfirm={() => doRetry(true)}
      >
        The earlier submission(s) may already have been billed. A deliberate fresh request will be sent; the old reservation stays until reconciled.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        tone="danger"
        title="Cancel this job?"
        confirmLabel="Cancel job"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined, { onSuccess: (r) => (toast.info('Cancellation requested', r.note), setConfirmCancel(false)), onError: (e) => toast.error('Could not cancel', e) })}
      >
        No new paid calls will start. The video provider has no cancel endpoint, so already-submitted requests may still be billed. Completed assets are kept.
      </ConfirmDialog>
    </div>
  );
}

/** Video job results may carry `narration_providers` at the top level or per brief. */
function narrationProviders(result: Record<string, unknown> | null): string[] {
  if (!result) return [];
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 3) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'narration_providers' && Array.isArray(x)) x.forEach((p) => out.add(String(p)));
      else visit(x, depth + 1);
    }
  };
  visit(result, 0);
  return Array.from(out);
}
