import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { animate, motion, useInView, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Check, Copy, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { ApiError } from '../api/client';
import { cn } from '../lib/format';
import { setTipContent, useDescribedBy } from './Tips';

/* ------------------------------------------------------------------ Button */
type Variant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ink text-white hover:bg-ink/90 shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_6px_16px_-6px_rgb(14_19_32/0.5)] dark:bg-white dark:text-[#0E1320] dark:hover:bg-white/90',
  brand:
    'bg-gradient-to-b from-[#FF8A5B] to-[#FF6A2F] text-[#1A0E08] hover:brightness-105 shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_8px_22px_-8px_rgb(255_106_47/0.7)]',
  secondary: 'bg-surface2 text-fg hover:bg-line/70 border border-line',
  outline: 'border border-line bg-surface text-fg hover:border-fg/30 hover:bg-surface2',
  ghost: 'text-muted hover:bg-surface2 hover:text-fg',
  danger: 'bg-bad text-white hover:bg-bad/90',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100 [@media(pointer:coarse)]:min-h-[44px]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface2 hover:text-fg active:scale-95 disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({
  className,
  children,
  hover,
  as: As = 'div',
  ...rest
}: { className?: string; children?: ReactNode; hover?: boolean; as?: 'div' | 'section' | 'article' | 'li' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn('card', hover && 'card-hover', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex min-w-0 flex-1 basis-[240px] items-start gap-3">
        {icon && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-muted">{icon}</div>}
        <div className="min-w-0">
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */
export type Tone = 'neutral' | 'brand' | 'accent' | 'ok' | 'warn' | 'bad' | 'violet' | 'ink';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface2 text-muted border-line',
  brand: 'bg-brand-soft text-brand-ink border-brand/25',
  accent: 'bg-accent-soft text-accent-ink border-accent/25',
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/25',
  violet: 'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
  ink: 'bg-ink text-white border-ink dark:bg-white dark:text-[#0E1320]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
  icon,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[3px] text-[11.5px] font-semibold leading-none',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  completed: 'ok',
  complete: 'ok',
  approved: 'ok',
  supported: 'ok',
  pass: 'ok',
  verified: 'ok',
  verified_opportunity: 'ok',
  ready: 'ok',
  running: 'accent',
  queued: 'neutral',
  waiting_for_provider: 'accent',
  waiting_for_user: 'brand',
  needs_input: 'brand',
  needs_review: 'accent',
  partial: 'warn',
  partially_completed: 'warn',
  incomplete: 'warn',
  availability_unknown: 'warn',
  unknown: 'neutral',
  hypothesis: 'warn',
  skipped: 'neutral',
  unavailable: 'neutral',
  draft: 'neutral',
  failed: 'bad',
  fail: 'bad',
  rejected: 'bad',
  excluded: 'bad',
  cancelled: 'neutral',
  cancellation_requested: 'warn',
};

export function StatusPill({ status, label, className }: { status?: string | null; label?: string; className?: string }) {
  const s = status ?? 'unknown';
  const tone = STATUS_TONE[s] ?? 'neutral';
  const live = s === 'running' || s === 'waiting_for_provider';
  return (
    <Badge
      tone={tone}
      className={className}
      icon={
        <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      }
    >
      {label ?? s.replace(/_/g, ' ')}
    </Badge>
  );
}

/* ------------------------------------------------------------------ Skeleton / states */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('card space-y-3 p-5', className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i % 2 ? 'w-4/5' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-soft to-accent-soft text-brand-ink">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.offline;
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-bad/25 bg-bad-soft/60 text-sm',
        compact ? 'px-3 py-2' : 'px-4 py-3.5',
        className,
      )}
    >
      {offline ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{msg}</p>
        {e?.requestId && !compact && <p className="mt-0.5 font-mono text-[11px] text-subtle">request {e.requestId}</p>}
      </div>
      {onRetry && (e?.retryable || offline || !e) && (
        <Button size="sm" variant="outline" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Callout({
  tone = 'neutral',
  icon,
  title,
  children,
  className,
  action,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const bg: Record<Tone, string> = {
    neutral: 'bg-surface2/70 border-line',
    brand: 'bg-brand-soft/70 border-brand/25',
    accent: 'bg-accent-soft/70 border-accent/25',
    ok: 'bg-ok-soft/70 border-ok/25',
    warn: 'bg-warn-soft/70 border-warn/30',
    bad: 'bg-bad-soft/70 border-bad/25',
    violet: 'bg-violet-50 border-violet-200 dark:bg-violet-950/40 dark:border-violet-900',
    ink: 'bg-ink text-white border-ink dark:bg-white dark:text-[#0E1320]',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', bg[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className={cn('text-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ Animated number + Stat */
export function AnimatedNumber({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const prev = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce || !inView) {
      node.textContent = value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      if (!inView) return;
    }
    const controls = animate(prev.current, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, decimals, inView, reduce]);
  return (
    <span ref={ref} className={cn('num', className)}>
      {value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  icon,
  decimals,
  className,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: number | string | null | undefined;
  sub?: ReactNode;
  icon?: ReactNode;
  decimals?: number;
  className?: string;
  tone?: 'neutral' | 'brand' | 'accent' | 'ok';
}) {
  const ring: Record<string, string> = {
    neutral: 'from-surface2 to-surface2 text-muted',
    brand: 'from-[#FFE3D6] to-[#FFF3EC] text-brand-ink dark:from-brand-soft dark:to-brand-soft',
    accent: 'from-[#DCE9FF] to-[#EEF4FF] text-accent-ink dark:from-accent-soft dark:to-accent-soft',
    ok: 'from-ok-soft to-ok-soft text-ok',
  };
  return (
    <div className={cn('card relative overflow-hidden p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-muted">{label}</p>
        {icon && <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br', ring[tone])}>{icon}</div>}
      </div>
      <p className="mt-2 font-display text-2xl font-bold tracking-tight">
        {typeof value === 'number' ? <AnimatedNumber value={value} decimals={decimals} /> : value ?? <span className="text-subtle">Unknown</span>}
      </p>
      {sub && <p className="mt-0.5 text-xs text-subtle">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Tooltip (global tip layer, hover + focus) */
/**
 * Brief explanation shown 250 ms after hover or keyboard focus, rendered by the
 * single global <TipLayer> (see Tips.tsx) so every tip in the app looks and
 * behaves the same. `aria-describedby` is attached to the real control inside.
 * Never use it for information that is essential — show that inline as well.
 */
export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setTipContent(id, { node: content });
  });
  useEffect(() => () => setTipContent(id, null), [id]);
  useDescribedBy(ref, `desc${id}`);
  return (
    <span ref={ref} className={cn('relative inline-flex', className)} data-tip-ref={id}>
      {children}
      <span id={`desc${id}`} className="sr-only">
        {content}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ Form fields */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  required,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-bad" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-bad" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn('input', invalid && 'input-error', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn('input min-h-[84px] resize-y leading-relaxed', invalid && 'input-error', className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'input cursor-pointer appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23697085' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <div className="flex items-start gap-3">
      <button
        id={tid}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? `${tid}-label` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-gradient-to-r from-[#FF7A45] to-[#FF5E62]' : 'bg-line',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          className={cn('inline-block h-[18px] w-[18px] rounded-full bg-white shadow', checked ? 'ml-[20px]' : 'ml-[2px]')}
        />
      </button>
      {(label || description) && (
        <label htmlFor={tid} className="cursor-pointer select-none">
          {label && (
            <span id={`${tid}-label`} className="block text-sm font-medium text-fg">
              {label}
            </span>
          )}
          {description && <span className="block text-xs text-muted">{description}</span>}
        </label>
      )}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'opacity-50', className)}>
      <span
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition',
          checked ? 'border-transparent bg-ink text-white dark:bg-white dark:text-[#0E1320]' : 'border-line bg-surface',
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
  size = 'md',
}: {
  tabs: { key: K; label: ReactNode; count?: number; icon?: ReactNode; tip?: string; id?: string }[];
  value: K;
  onChange: (k: K) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const group = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[n].key);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" className={cn('scroll-thin flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-surface2 p-1', className)}>
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            aria-selected={active}
            id={t.id}
            data-tip={t.tip}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.key)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[12.5px]' : 'px-3.5 py-1.5 text-[13.5px]',
              active ? 'text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-${group}`}
                className="absolute inset-0 rounded-lg bg-surface shadow-card"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {t.icon}
              {t.label}
              {t.count !== undefined && (
                <span className={cn('num rounded-full px-1.5 text-[11px]', active ? 'bg-surface2' : 'bg-line/60')}>{t.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Table */
export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cn('scroll-thin overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn('sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-surface2/90 px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-subtle backdrop-blur', className)}
    {...rest}
  >
    {children}
  </th>
);
export const Td = ({ children, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b border-line/70 px-3 py-2.5 align-top', className)} {...rest}>
    {children}
  </td>
);

/* ------------------------------------------------------------------ Page header */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight md:text-[30px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-[14.5px] leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Copy */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard blocked: fall through */
        }
        setDone(true);
        window.setTimeout(() => setDone(false), 1400);
      }}
      aria-label={`${label}: ${text}`}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted transition hover:text-fg active:scale-95',
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5 text-sm', className)}>
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-right font-medium text-fg">{v}</dd>
    </div>
  );
}

export function Meter({ value, max = 1, className, tone = 'brand', label }: { value: number | null; max?: number; className?: string; tone?: 'brand' | 'accent' | 'ok'; label?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max)) * 100;
  const bar = tone === 'brand' ? 'from-[#FF9A6C] to-[#FF6A2F]' : tone === 'accent' ? 'from-[#6EA8FF] to-[#1F6FEB]' : 'from-emerald-400 to-emerald-600';
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface2', className)} role="meter" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      {value !== null && (
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r', bar)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </div>
  );
}

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};
export const stagger = (s = 0.05) => ({ hidden: {}, show: { transition: { staggerChildren: s } } });
