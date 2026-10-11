/**
 * Project guide: a step-by-step tour that navigates through every feature of the
 * US sample, spotlighting one part of each page with a short explanation.
 *
 *  - starts from the "Project guide" button, the Projects welcome card, or
 *    automatically after sign-in (once — finishing or skipping sets `ll-guide-done`)
 *  - each step navigates with react-router, waits up to ~6 s for its `data-tour`
 *    anchor, scrolls it into view and cuts a spotlight out of a dimmed backdrop;
 *    if the anchor never appears the card is shown centred, without a spotlight
 *  - Back / Next / Skip, arrow keys, Escape; focus is trapped in the card and
 *    restored afterwards; on phones the card docks at the bottom as a sheet
 *  - read-only: the tour never writes or spends anything (Duplicate to edit is an
 *    explicit choice on the last step)
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Compass, CopyPlus, Sparkles, X } from 'lucide-react';
import { useProjects } from '../api/hooks';
import { GUIDE_STEPS } from '../lib/guide';
import { cn } from '../lib/format';
import { useDuplicateProject } from './Locked';
import { useDialog } from './Overlay';
import { Button } from './ui';

const DONE_KEY = 'll-guide-done';
const AUTO_KEY = 'll-guide-auto';
const FIND_TIMEOUT = 6000;

export function guideDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}
function markDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* storage unavailable: the guide may offer itself again next time */
  }
}
/** Called after a successful sign-in: the guide opens on the next app screen unless it was finished or skipped before. */
export function requestGuideAfterLogin() {
  try {
    sessionStorage.setItem(AUTO_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface GuideApi {
  active: boolean;
  available: boolean;
  start: () => void;
}
const Ctx = createContext<GuideApi>({ active: false, available: false, start: () => undefined });
export const useGuide = () => useContext(Ctx);

export function GuideProvider({ children }: { children: ReactNode }) {
  const projects = useProjects().data?.items;
  const sample = useMemo(() => projects?.find((p) => p.is_demo && p.country_code === 'US') ?? projects?.find((p) => p.is_demo), [projects]);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const start = useCallback(() => {
    setStep(0);
    setActive(true);
  }, []);
  const end = useCallback(() => {
    markDone();
    setActive(false);
  }, []);
  // auto-start once after sign-in
  useEffect(() => {
    if (!sample) return;
    let auto = false;
    try {
      auto = sessionStorage.getItem(AUTO_KEY) === '1';
      if (auto) sessionStorage.removeItem(AUTO_KEY);
    } catch {
      /* ignore */
    }
    if (auto && !guideDone()) start();
  }, [sample, start]);
  const value = useMemo(() => ({ active, available: !!sample, start }), [active, sample, start]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {active && sample && <GuideTour pid={sample.id} step={step} setStep={setStep} onEnd={end} />}
    </Ctx.Provider>
  );
}

/** "Project guide" button for the app header. */
export function GuideButton({ className, compact }: { className?: string; compact?: boolean }) {
  const g = useGuide();
  return (
    <button
      type="button"
      onClick={g.start}
      disabled={!g.available || g.active}
      data-tip="project-guide"
      data-testid="guide-button"
      className={cn(
        'group inline-flex h-9 items-center gap-2 rounded-full border border-brand/30 bg-gradient-to-r from-brand-soft to-accent-soft px-3 text-[13px] font-semibold text-fg shadow-card transition hover:border-brand/60 hover:shadow-glow disabled:opacity-60 [@media(pointer:coarse)]:h-11',
        className,
      )}
    >
      <Compass className="h-4 w-4 text-brand-ink transition-transform duration-500 group-hover:rotate-[200deg] motion-reduce:transition-none" aria-hidden />
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>Project guide</span>
    </button>
  );
}

/* ------------------------------------------------------------------ the tour */
type Rect = { x: number; y: number; w: number; h: number };
const PAD = 8;

function GuideTour({ pid, step, setStep, onEnd }: { pid: string; step: number; setStep: (n: number) => void; onEnd: () => void }) {
  const s = GUIDE_STEPS[step];
  const total = GUIDE_STEPS.length;
  const last = step === total - 1;
  const nav = useNavigate();
  const loc = useLocation();
  const reduce = useReducedMotion();
  const [rectState, setRectState] = useState<{ step: number; rect: Rect | null }>({ step, rect: null });
  const [statusState, setStatusState] = useState<{ step: number; status: 'searching' | 'found' | 'missing' }>({ step, status: 'searching' });
  // state from a previous step is never shown for the current one (no stale "found" between steps)
  const rect = rectState.step === step ? rectState.rect : null;
  const status = statusState.step === step ? statusState.status : 'searching';
  const setRect = (u: (cur: Rect | null) => Rect | null) => setRectState((cur) => ({ step, rect: u(cur.step === step ? cur.rect : null) }));
  const setStatus = (v: 'searching' | 'found' | 'missing') => setStatusState({ step, status: v });
  const cardRef = useDialog(true, onEnd);
  const target = s.path(pid);
  const here = loc.pathname + loc.search;
  const atTarget = here === target;

  // navigate to the step's page
  useEffect(() => {
    if (!atTarget) nav(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // find the anchor (poll), scroll it into view and keep its rectangle current
  useEffect(() => {
    setRect(() => null);
    setStatus('searching');
    if (!atTarget) return;
    let el: HTMLElement | null = null;
    let poll = 0;
    let track = 0;
    const t0 = Date.now();
    const visible = (e: HTMLElement) => {
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    };
    const measure = () => {
      if (!el) return;
      if (!el.isConnected) {
        el = null;
        window.clearInterval(track);
        poll = window.setInterval(find, 150);
        return;
      }
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const y = Math.max(r.top - PAD, 4);
      const bottom = Math.min(r.bottom + PAD, vh - 4);
      const x = Math.max(r.left - PAD, 4);
      const right = Math.min(r.right + PAD, window.innerWidth - 4);
      const next = { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
      setRect((cur) => (cur && Math.abs(cur.x - next.x) < 1 && Math.abs(cur.y - next.y) < 1 && Math.abs(cur.w - next.w) < 1 && Math.abs(cur.h - next.h) < 1 ? cur : next));
    };
    const find = () => {
      const e = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`);
      if (e && visible(e)) {
        window.clearInterval(poll);
        el = e;
        const r = e.getBoundingClientRect();
        const vh = window.innerHeight;
        const mobile = window.innerWidth < 640;
        const room = mobile ? vh * 0.5 : vh - 140;
        const top = r.height > room ? r.top + window.scrollY - (mobile ? 70 : 90) : r.top + window.scrollY - (room - r.height) / 2 - (mobile ? 40 : 30);
        window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
        setStatus('found');
        measure();
        track = window.setInterval(measure, 120);
      } else if (Date.now() - t0 > FIND_TIMEOUT) {
        window.clearInterval(poll);
        setStatus('missing');
      }
    };
    poll = window.setInterval(find, 150);
    find();
    const onWin = () => measure();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(track);
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, atTarget]);

  const next = useCallback(() => (last ? onEnd() : setStep(step + 1)), [last, onEnd, setStep, step]);
  const back = useCallback(() => step > 0 && setStep(step - 1), [setStep, step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back]);

  const spot = status === 'found' ? rect : null;
  const tr = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 260, damping: 32 };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  return createPortal(
    <div className="fixed inset-0 z-[150]" data-testid="guide" data-step={s.id} data-target={s.target} data-status={status}>
      {/* dim backdrop with a cut-out */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <mask id="ll-guide-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spot && <motion.rect initial={false} animate={{ x: spot.x, y: spot.y, width: spot.w, height: spot.h }} transition={tr} rx="16" fill="black" />}
          </mask>
        </defs>
        <motion.rect initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.25 }} x="0" y="0" width="100%" height="100%" fill="rgb(6 10 20 / 0.58)" mask="url(#ll-guide-mask)" />
      </svg>
      {/* soft accent ring around the spotlight */}
      <AnimatePresence>
        {spot && (
          <motion.div
            key="ring"
            aria-hidden
            initial={{ opacity: 0, left: spot.x, top: spot.y, width: spot.w, height: spot.h }}
            animate={{ opacity: 1, left: spot.x, top: spot.y, width: spot.w, height: spot.h }}
            exit={{ opacity: 0 }}
            transition={tr}
            className="pointer-events-none absolute rounded-2xl ring-2 ring-[#FF7A45]/80 shadow-[0_0_0_6px_rgb(255_122_69/0.18),0_0_40px_8px_rgb(31_111_235/0.25)]"
            data-testid="guide-spotlight"
          />
        )}
      </AnimatePresence>
      <GuideCard
        cardRef={cardRef}
        spot={spot}
        vw={vw}
        vh={vh}
        step={step}
        total={total}
        status={status}
        title={s.title}
        body={s.body}
        isNew={s.isNew}
        last={last}
        pid={pid}
        onBack={back}
        onNext={next}
        onSkip={onEnd}
        reduce={!!reduce}
      />
    </div>,
    document.body,
  );
}

function GuideCard({
  cardRef,
  spot,
  vw,
  vh,
  step,
  total,
  status,
  title,
  body,
  isNew,
  last,
  pid,
  onBack,
  onNext,
  onSkip,
  reduce,
}: {
  cardRef: React.RefObject<HTMLDivElement>;
  spot: Rect | null;
  vw: number;
  vh: number;
  step: number;
  total: number;
  status: 'searching' | 'found' | 'missing';
  title: string;
  body: string;
  isNew?: boolean;
  last: boolean;
  pid: string;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  reduce: boolean;
}) {
  const mobile = vw < 640;
  const W = Math.min(380, vw - 24);
  const [h, setH] = useState(240);
  useLayoutEffect(() => {
    if (cardRef.current) setH(cardRef.current.offsetHeight);
  });
  const dup = useDuplicateProject(pid);
  // keep keyboard focus on the primary action as steps change (Next → Finish on the last step)
  useEffect(() => {
    const t = window.setTimeout(() => cardRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [step, cardRef]);

  // placement: below, above, right, left of the spotlight; else centred
  let pos: { left: number; top: number };
  if (mobile) pos = { left: 12, top: vh - h - 12 };
  else if (!spot) pos = { left: (vw - W) / 2, top: Math.max(16, (vh - h) / 2) };
  else {
    const gap = 16;
    const clampX = (x: number) => Math.min(Math.max(16, x), vw - W - 16);
    const clampY = (y: number) => Math.min(Math.max(16, y), vh - h - 16);
    if (spot.y + spot.h + gap + h < vh - 8) pos = { left: clampX(spot.x + spot.w / 2 - W / 2), top: spot.y + spot.h + gap };
    else if (spot.y - gap - h > 8) pos = { left: clampX(spot.x + spot.w / 2 - W / 2), top: spot.y - gap - h };
    else if (spot.x + spot.w + gap + W < vw - 8) pos = { left: spot.x + spot.w + gap, top: clampY(spot.y + 24) };
    else if (spot.x - gap - W > 8) pos = { left: spot.x - gap - W, top: clampY(spot.y + 24) };
    else pos = { left: vw - W - 24, top: vh - h - 24 };
  }

  return (
    <motion.div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ll-guide-title"
      aria-describedby="ll-guide-body"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, left: pos.left, top: pos.top }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 32 }}
      style={{ width: mobile ? vw - 24 : W }}
      className={cn('absolute rounded-3xl border border-line bg-surface p-5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.55)]', mobile && 'rounded-b-3xl')}
      data-testid="guide-card"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-[11.5px] font-semibold text-muted">
          <Compass className="h-3.5 w-3.5 text-brand-ink" aria-hidden />
          <span data-testid="guide-progress">
            {step + 1} of {total}
          </span>
        </span>
        {isNew && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#FF7A45] to-[#1F6FEB] px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-white">
            <Sparkles className="h-2.5 w-2.5" aria-hidden /> New
          </span>
        )}
        <button type="button" onClick={onSkip} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Close tour">
          <X className="h-4 w-4" />
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: reduce ? 0 : 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : -8 }} transition={{ duration: reduce ? 0 : 0.18 }}>
          <h2 id="ll-guide-title" className="mt-3 font-display text-[19px] font-bold leading-snug tracking-tight">
            {title}
          </h2>
          <p id="ll-guide-body" className="mt-1.5 text-[14px] leading-relaxed text-muted">
            {body}
          </p>
          {status === 'searching' && <p className="mt-2 text-[12px] text-subtle" aria-live="polite">Opening this part of the app…</p>}
          {status === 'missing' && (
            <p className="mt-2 text-[12px] text-subtle" data-testid="guide-fallback">
              This part isn’t on screen right now — its data may still be loading. You can keep going.
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="mt-4 flex gap-1" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-gradient-to-r from-[#FF7A45] to-[#1F6FEB]' : 'bg-line')} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!last && (
          <button type="button" onClick={onSkip} className="mr-auto rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted hover:text-fg [@media(pointer:coarse)]:min-h-[44px]">
            Skip tour
          </button>
        )}
        <Button variant="outline" size="sm" className={last ? 'mr-auto' : undefined} icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={onBack} disabled={step === 0}>
          Back
        </Button>
        {last ? (
          <>
            <Button variant="outline" size="sm" icon={<CopyPlus className="h-3.5 w-3.5" />} loading={dup.isPending} onClick={() => dup.mutate(undefined, { onSuccess: onSkip })}>
              Duplicate to edit
            </Button>
            <Button variant="brand" size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={onNext} data-autofocus>
              Finish
            </Button>
          </>
        ) : (
          <Button variant="brand" size="sm" onClick={onNext} data-autofocus>
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <p className="mt-2 hidden text-[11px] text-subtle sm:block">Use ← → to move, Esc to close.</p>
    </motion.div>
  );
}
