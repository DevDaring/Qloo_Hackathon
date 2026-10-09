import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../lib/format';
import { Button, IconButton } from './ui';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([type=hidden]),select,[tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last: only the top one reacts to Escape and Tab. */
const stack: symbol[] = [];

/** Focus trap + Escape + scroll lock + focus restore for dialogs (nested dialogs close one at a time). */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const me = Symbol('dialog');
    stack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      el?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: ReactNode;
}) {
  const ref = useDialog(open, onClose);
  const tid = useId();
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[#0E1320]/45 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={tid}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn(
              'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-lift sm:rounded-3xl',
              widths[size],
            )}
          >
            <div className="flex items-start gap-3 border-b border-line px-6 py-4">
              {icon && <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">{icon}</div>}
              <div className="min-w-0 flex-1">
                <h2 id={tid} className="font-display text-lg font-semibold leading-snug">
                  {title}
                </h2>
                {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              </div>
              <IconButton label="Close dialog" onClick={onClose} className="-mr-2 -mt-1">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface2/50 px-6 py-3.5">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-lg',
  layer = 'z-[75]',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** z-index class; nested drawers (evidence over a story) sit higher */
  layer?: string;
}) {
  const ref = useDialog(open, onClose);
  const tid = useId();
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn('fixed inset-0', layer)}>
          <motion.div
            className="absolute inset-0 bg-[#0E1320]/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={tid}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 38 }}
            className={cn('absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-lift', width)}
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={tid} className="font-display text-lg font-semibold leading-snug">
                  {title}
                </h2>
                {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
              </div>
              <IconButton label="Close panel" onClick={onClose} className="-mr-2">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading,
  icon,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'brand';
  loading?: boolean;
  icon?: ReactNode;
  confirmDisabled?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      icon={icon}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} disabled={confirmDisabled} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{children}</div>
    </Modal>
  );
}
