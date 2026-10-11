/**
 * ActionPreview — explains an action *before* it is used.
 *  - brief tip ~300 ms after hover or focus (aria-describedby on the real control)
 *  - optional richer popover on click/tap of the ⓘ button (Escape, outside click, focus restore)
 *  - a visible reason when the action is disabled (never only a native `title`)
 * Hovering or focusing never triggers the action itself.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, Lock, X } from 'lucide-react';
import { cn } from '../lib/format';
import { TIPS } from '../lib/tips';
import { setTipContent, useDescribedBy, type TipContent } from './Tips';
import { LOCK_REASON, useLocked } from './Locked';

export function ActionPreview({
  tip,
  tipKey,
  extra,
  title,
  details,
  disabledReason,
  children,
  className,
  inlineReason = true,
  edit = false,
}: {
  /** one-line explanation (used when there is no registry entry) */
  tip?: ReactNode;
  /** registry key in lib/tips.ts — title, body, "New" badge and what clicking does */
  tipKey?: string;
  /** a dynamic line such as the current estimate */
  extra?: ReactNode;
  /** heading of the richer popover (defaults to none) */
  title?: string;
  /** richer content (estimate, requirements, what happens next) shown on click/tap of the info button */
  details?: ReactNode;
  /** if set, the action is unavailable: shown visibly next to the control */
  disabledReason?: ReactNode;
  children: ReactNode;
  className?: string;
  inlineReason?: boolean;
  /** an edit action: disabled with a visible reason on the read-only sample */
  edit?: boolean;
}) {
  const locked = useLocked() && edit;
  if (locked) {
    disabledReason = LOCK_REASON;
    if (isValidElement(children)) children = cloneElement(children as ReactElement<{ disabled?: boolean }>, { disabled: true });
  }
  const id = useId();
  const host = useRef<HTMLSpanElement>(null);
  const entry = tipKey ? TIPS[tipKey] : undefined;
  const content: TipContent = entry
    ? { ...entry, extra, disabled: disabledReason }
    : { title, ...(typeof tip === 'string' ? { body: tip } : { node: tip }), extra, disabled: disabledReason };
  useEffect(() => {
    setTipContent(id, content);
  });
  useEffect(() => () => setTipContent(id, null), [id]);
  useDescribedBy(host, `apdesc${id}`);
  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)}>
      <span className="inline-flex items-center gap-1">
        <span ref={host} className="relative inline-flex" data-tip-ref={id}>
          {children}
          <span id={`apdesc${id}`} className="sr-only">
            {entry ? [entry.title, entry.body, entry.click && `If you click: ${entry.click}`].filter(Boolean).join('. ') : tip}
            {extra ? <> {extra}</> : null}
            {disabledReason ? <> Unavailable: {disabledReason}</> : null}
          </span>
        </span>
        {details && <InfoPopover title={title ?? entry?.title} body={details} />}
      </span>
      {disabledReason && inlineReason && (
        <span className="inline-flex max-w-[280px] items-start gap-1 text-[11.5px] leading-snug text-warn" role="note">
          <Lock className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
          <span>{disabledReason}</span>
        </span>
      )}
    </span>
  );
}

export function InfoPopover({ title, body, label }: { title?: string; body: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pos, setPos] = useState({ x: 0, y: 0, up: false });
  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) btn.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const up = r.bottom + 260 > window.innerHeight && r.top > 280;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170), y: up ? r.top - 8 : r.bottom + 8, up });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => pop.current?.focus({ preventScroll: true }), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const onScroll = () => close(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label ?? `About: ${title ?? 'this action'}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-subtle transition hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <Info className="h-4 w-4" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed z-[110]" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.up ? '-100%' : '0'})` }}>
            <motion.div
              ref={pop}
              id={id}
              role="dialog"
              aria-label={title ?? 'About this action'}
              tabIndex={-1}
              initial={{ opacity: 0, y: pos.up ? 6 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-[min(320px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-4 text-sm shadow-lift outline-none"
            >
              <div className="flex items-start gap-2">
                {title && <p className="min-w-0 flex-1 font-display text-[14px] font-semibold">{title}</p>}
                <button type="button" onClick={() => close()} className="-mr-1 -mt-1 rounded-md p-1 text-subtle hover:bg-surface2 hover:text-fg" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-muted">{body}</div>
            </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
