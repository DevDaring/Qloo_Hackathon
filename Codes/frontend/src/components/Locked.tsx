/**
 * Read-only sample handling.
 *
 * The seeded sample project is locked on the server: every mutating request
 * returns 409 project_locked. The UI says so up front instead of letting people
 * discover it through an error toast:
 *  - a calm banner with "Duplicate to edit" at the top of every page of a locked project
 *  - <Editable> disables an edit control and explains why (tooltip + optional inline note)
 *  - useDuplicateProject() copies inputs and decisions into a new editable project
 */
import { cloneElement, useContext, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { CopyPlus, Lock } from 'lucide-react';
import { ApiError } from '../api/client';
import { mutations } from '../api/hooks';
import { cn } from '../lib/format';
import { ProjectContext } from './ProjectContext';
import { useToast } from './Toast';
import { Button, Tooltip } from './ui';

export const LOCK_REASON = 'Read-only sample — everyone sees the same results. Duplicate to edit.';

export function useLocked(): boolean {
  return !!useContext(ProjectContext)?.project?.locked;
}

export function useDuplicateProject(pid?: string) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => mutations.duplicateProject(pid!),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Your editable copy is ready', 'Inputs and decisions were copied. Start research on the copy — cached provider data is reused.');
      nav(`/projects/${p.id}`);
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.code === 'too_many_projects' ? 'Too many projects in this workspace' : 'Could not duplicate the project',
        e,
      ),
  });
}

/** Primary "Duplicate to edit" button. */
export function DuplicateButton({ pid, className, size = 'sm', variant = 'brand', label = 'Duplicate to edit' }: { pid: string; className?: string; size?: 'sm' | 'md'; variant?: 'brand' | 'primary' | 'outline'; label?: string }) {
  const dup = useDuplicateProject(pid);
  const tooMany = dup.error instanceof ApiError && dup.error.code === 'too_many_projects';
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size={size} variant={variant} className={className} icon={<CopyPlus className="h-4 w-4" />} loading={dup.isPending} onClick={() => dup.mutate()} data-testid="duplicate-project">
        {label}
      </Button>
      {tooMany && (
        <span role="alert" className="max-w-[260px] text-[11.5px] leading-snug text-bad">
          {dup.error!.message}
        </span>
      )}
    </span>
  );
}

export function LockedBanner({ pid }: { pid: string }) {
  return (
    <div className="border-b border-accent/25 bg-accent-soft/50" data-testid="locked-banner" role="region" aria-label="Read-only sample">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-10">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-accent-ink shadow-card" aria-hidden>
          <Lock className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 flex-1 text-[13.5px]">
          <b className="font-semibold">Read-only sample</b>
          <span className="text-muted"> — everyone sees the same results. Duplicate to edit.</span>
          <span className="hidden text-subtle md:inline"> Exports and questions still work here.</span>
        </p>
        <DuplicateButton pid={pid} />
      </div>
    </div>
  );
}

/**
 * Wrap an edit control. On a locked project the control is disabled and the
 * reason is shown (tooltip on hover, and visibly when `note` is set).
 */
export function Editable({ children, note = false, className }: { children: ReactElement<{ disabled?: boolean }>; note?: boolean; className?: string }) {
  const locked = useLocked();
  if (!locked) return children;
  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)} data-locked="true">
      <Tooltip content={LOCK_REASON}>{cloneElement(children, { disabled: true })}</Tooltip>
      {note && <LockNote />}
    </span>
  );
}

export function LockNote({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <span role="note" className={cn('inline-flex max-w-[300px] items-start gap-1 text-[11.5px] leading-snug text-muted', className)}>
      <Lock className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
      <span>{children ?? 'Read-only sample — duplicate to edit.'}</span>
    </span>
  );
}
