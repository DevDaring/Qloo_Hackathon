/**
 * One explanation system for the whole app.
 *
 *  - Any element with `data-tip="<registry key>"` or `data-tip-ref="<id>"` gets a
 *    polished card 250 ms after the pointer rests on it, or when it receives
 *    keyboard focus. On touch, a long press shows it (and the click that
 *    follows a long press is swallowed, so showing a tip never runs the action).
 *  - <Tip k="…"> wraps a control with a registry tip; <Tooltip> (ui.tsx) and
 *    <ActionPreview> register their dynamic content here, so there is a single
 *    layer, one look and one timing.
 *  - Escape, scrolling or leaving the element hides it.
 */
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, MousePointerClick, Sparkles } from 'lucide-react';
import { TIPS, type TipEntry } from '../lib/tips';
import { cn } from '../lib/format';

export interface TipContent extends TipEntry {
  /** free-form content (plain tooltips) */
  node?: ReactNode;
  /** a dynamic line, e.g. the current cost estimate */
  extra?: ReactNode;
  /** why the control is unavailable right now */
  disabled?: ReactNode;
}

/* ------------------------------------------------------------------ store */
const store = new Map<string, TipContent>();
const listeners = new Set<() => void>();
let version = 0;
/** ref of the tip on screen: only changes to it re-render the layer */
let shownRef: string | null = null;
function emit() {
  version++;
  listeners.forEach((l) => l());
}
export function setTipContent(id: string, c: TipContent | null) {
  if (c) store.set(id, c);
  else store.delete(id);
  if (id === shownRef) emit();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function resolve(el: HTMLElement): TipContent | null {
  const ref = el.dataset.tipRef;
  const key = el.dataset.tip;
  const base: TipContent | undefined = ref ? store.get(ref) : key ? TIPS[key] : undefined;
  if (!base) return null;
  const extra = el.dataset.tipExtra;
  const disabled = el.dataset.tipDisabled;
  return { ...base, ...(extra ? { extra } : {}), ...(disabled ? { disabled } : {}) };
}

const HOST = '[data-tip],[data-tip-ref]';
const DELAY = 250;

/* ------------------------------------------------------------------ the layer */
export function TipLayer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useSyncExternalStore(subscribe, () => version);
  const timer = useRef<number | null>(null);
  const press = useRef<{ t: number; x: number; y: number; el: HTMLElement } | null>(null);
  const swallowClick = useRef(0);
  const cur = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      cur.current = null;
      setHost(null);
    };
    const showSoon = (el: HTMLElement) => {
      if (cur.current === el) return;
      clear();
      cur.current = el;
      setHost(null);
      timer.current = window.setTimeout(() => {
        if (cur.current === el && el.isConnected) {
          setRect(el.getBoundingClientRect());
          setHost(el);
        }
      }, DELAY);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.(HOST) as HTMLElement | null;
      if (el) showSoon(el);
      else if (cur.current) hide();
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || !cur.current) return;
      const to = e.relatedTarget as Node | null;
      if (to && cur.current.contains(to)) return;
      const next = (to as Element | null)?.closest?.(HOST) as HTMLElement | null;
      if (next) showSoon(next);
      else hide();
    };
    const focusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (!t.matches?.(':focus-visible')) return;
      const el = t.closest?.(HOST) as HTMLElement | null;
      if (el) showSoon(el);
    };
    const focusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (cur.current && to && cur.current.contains(to)) return;
      if (cur.current && document.activeElement && cur.current.contains(document.activeElement)) return;
      hide();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cur.current && hide();
    // keep the card attached to its element while the page (or a panel) scrolls
    const scroll = () => {
      const el = cur.current;
      if (!el) return;
      if (!el.isConnected) return hide();
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return hide();
      setRect(r);
    };
    // touch: long-press shows the tip; the click that ends the long press is swallowed
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const el = (e.target as Element | null)?.closest?.(HOST) as HTMLElement | null;
      if (!el) return hide();
      press.current = { t: Date.now(), x: e.clientX, y: e.clientY, el };
      clear();
      timer.current = window.setTimeout(() => {
        if (press.current?.el === el) {
          cur.current = el;
          setRect(el.getBoundingClientRect());
          setHost(el);
          swallowClick.current = Date.now();
        }
      }, 480);
    };
    const move = (e: PointerEvent) => {
      if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) {
        press.current = null;
        clear();
      }
    };
    const up = () => {
      press.current = null;
      if (!cur.current) clear();
    };
    const click = (e: MouseEvent) => {
      if (swallowClick.current && Date.now() - swallowClick.current < 1500) {
        swallowClick.current = 0;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const ctx = (e: Event) => {
      if (press.current || (swallowClick.current && Date.now() - swallowClick.current < 1500)) e.preventDefault();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', ctx, true);
    return () => {
      clear();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', ctx, true);
    };
  }, []);

  // the host can disappear (navigation, conditional render)
  useEffect(() => {
    if (!host) return;
    const t = window.setInterval(() => {
      if (!host.isConnected) {
        cur.current = null;
        setHost(null);
      }
    }, 300);
    return () => window.clearInterval(t);
  }, [host]);

  shownRef = host?.dataset.tipRef ?? null;
  const content = host ? resolve(host) : null;
  return createPortal(
    <AnimatePresence>{host && rect && content && <TipCard key={host.dataset.tipRef ?? host.dataset.tip} rect={rect} c={content} />}</AnimatePresence>,
    document.body,
  );
}

function TipCard({ rect, c }: { rect: DOMRect; c: TipContent }) {
  const ref = useRef<HTMLDivElement>(null);
  const rich = !!(c.title || c.click || c.isNew || c.disabled);
  const width = rich ? 300 : 260;
  const [pos, setPos] = useState({ left: 0, top: 0, below: false });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 120;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = rect.top - h - 12 < 8 && rect.bottom + h + 12 < vh;
    const w = Math.min(width, vw - 24);
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), vw - w - 12);
    const top = below ? rect.bottom + 10 : Math.max(8, rect.top - h - 10);
    setPos({ left, top, below });
  }, [rect, width, c]);
  return (
    <motion.div
      ref={ref}
      role="tooltip"
      id="ll-tip"
      data-testid="tip-card"
      initial={{ opacity: 0, y: pos.below ? -4 : 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      style={{ left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 24) }}
      className="pointer-events-none fixed z-[140] rounded-2xl border border-line bg-surface/95 p-3.5 text-left shadow-[0_18px_50px_-12px_rgb(14_19_32/0.35)] backdrop-blur-xl dark:shadow-[0_18px_50px_-12px_rgb(0_0_0/0.7)]"
    >
      {(c.title || c.isNew) && (
        <p className="flex items-center gap-2">
          {c.title && <span className="font-display text-[14px] font-bold leading-snug text-fg">{c.title}</span>}
          {c.isNew && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-[#FF7A45] to-[#1F6FEB] px-2 py-[2px] text-[10px] font-bold uppercase tracking-wider text-white">
              <Sparkles className="h-2.5 w-2.5" aria-hidden /> New
            </span>
          )}
        </p>
      )}
      {c.body && <p className={cn('text-[12.5px] leading-relaxed text-muted', c.title && 'mt-1')}>{c.body}</p>}
      {c.node && <div className={cn('text-[12.5px] leading-relaxed text-muted', (c.title || c.body) && 'mt-1')}>{c.node}</div>}
      {c.extra && <div className="mt-1.5 text-[12px] font-medium text-fg">{c.extra}</div>}
      {c.click && (
        <p className="mt-2 flex items-start gap-1.5 border-t border-line pt-2 text-[11.5px] leading-snug text-subtle">
          <MousePointerClick className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <b className="font-semibold text-muted">If you click: </b>
            {c.click}
          </span>
        </p>
      )}
      {c.disabled && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn-soft/70 px-2 py-1.5 text-[11.5px] font-medium leading-snug text-warn">
          <Lock className="mt-[1px] h-3 w-3 shrink-0" aria-hidden />
          <span>Unavailable: {c.disabled}</span>
        </p>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ wrappers */
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** Points the real control's aria-describedby at a description element. */
export function useDescribedBy(host: React.RefObject<HTMLElement>, descId: string) {
  useEffect(() => {
    const h = host.current;
    if (!h) return;
    const target = (h.matches(FOCUSABLE) ? h : h.querySelector<HTMLElement>(FOCUSABLE)) ?? h;
    const prev = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [prev, descId].filter(Boolean).join(' '));
    return () => {
      const rest = (target.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== descId);
      if (rest.length) target.setAttribute('aria-describedby', rest.join(' '));
      else target.removeAttribute('aria-describedby');
    };
  }, [host, descId]);
}

function plain(c: TipContent): string {
  return [c.title, c.body, c.click ? `If you click: ${c.click}` : ''].filter(Boolean).join('. ');
}

/**
 * Registry tip around a control: `<Tip k="build-package"><Button…/></Tip>`.
 * With `asChild` the attributes go straight onto the child element (no wrapper span).
 */
export function Tip({ k, children, className, disabled, extra, asChild }: { k: string; children: ReactNode; className?: string; disabled?: string; extra?: string; asChild?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const entry = TIPS[k];
  useDescribedBy(ref, `tipdesc${id}`);
  const desc = entry ? (
    <span id={`tipdesc${id}`} className="sr-only">
      {plain(entry)}
      {disabled ? `. Unavailable: ${disabled}` : ''}
    </span>
  ) : null;
  if (asChild && isValidElement(children)) {
    return (
      <>
        {cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-tip': k, 'data-tip-disabled': disabled, 'data-tip-extra': extra, 'aria-describedby': `tipdesc${id}` })}
        {desc}
      </>
    );
  }
  return (
    <span ref={ref} className={cn('relative inline-flex', className)} data-tip={k} data-tip-disabled={disabled} data-tip-extra={extra}>
      {children}
      {desc}
    </span>
  );
}
