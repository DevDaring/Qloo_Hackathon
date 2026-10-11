/**
 * Floating assistant: "Ask LaunchLens". App help and marketing answers, grounded
 * in live Qloo taste data when the question is about tastes, audiences or venues.
 *
 *  - launcher fixed bottom-right on every signed-in page, kept above the run console bar
 *  - a floating window on desktop (≈400 × 600), a full-height sheet on phones
 *  - the conversation persists for the session (sessionStorage); "New chat" clears it
 *  - read-only: POST /assistant/chat never writes or generates media
 *  - hidden while the project guide runs, so the two never collide
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as RKeyboardEvent } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Fingerprint, Loader2, MessageCircle, Minus, RotateCcw, Send, Sparkles, SquarePen, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { mutations, useProject } from '../api/hooks';
import type { AssistantReply, QlooLookup } from '../api/types';
import { cn } from '../lib/format';
import { useGuide } from './Guide';
import { loadSelection } from './ProjectContext';

const PAGE_NAMES: Record<string, string> = {
  '': 'Overview', brief: 'Product brief', audiences: 'Audience insights', explorer: 'Market explorer', compare: 'Location comparison',
  strategy: 'Campaign strategy', studio: 'Ad studio', assets: 'Assets & exports', results: 'Results', settings: 'Settings',
};
const LAST_PROJECT = 'll-assistant-last-project';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  reply?: AssistantReply;
}

const STORE = 'll-assistant-chat';
const PULSED = 'll-assistant-pulsed';

function load(): Turn[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save(t: Turn[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(t.slice(-40)));
  } catch {
    /* storage unavailable: the chat lives in memory only */
  }
}

/** Distance from the viewport bottom that keeps the launcher above the run console bar. */
function useBottomOffset() {
  const [bottom, setBottom] = useState(20);
  useEffect(() => {
    const measure = () => {
      const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-run-console]'));
      let off = 20;
      for (const b of bars) {
        const r = b.getBoundingClientRect();
        if (r.height > 0 && r.top < window.innerHeight && r.bottom > 0) off = Math.max(off, window.innerHeight - r.top + 12);
      }
      setBottom((cur) => (Math.abs(cur - off) > 1 ? off : cur));
    };
    measure();
    const t = window.setInterval(measure, 400);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);
  return bottom;
}

export function Assistant() {
  const guide = useGuide();
  const match = useMatch('/projects/:pid/*');
  const loc = useLocation();
  const routePid = match?.params.pid;
  // the chat refers to the project on screen; elsewhere, to the last project opened in this session
  const [lastPid, setLastPid] = useState<string | undefined>(() => {
    try {
      return sessionStorage.getItem(LAST_PROJECT) ?? undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    if (!routePid) return;
    setLastPid(routePid);
    try {
      sessionStorage.setItem(LAST_PROJECT, routePid);
    } catch {
      /* storage unavailable */
    }
  }, [routePid]);
  const pid = routePid ?? lastPid;
  const project = useProject(pid).data;
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const bottom = useBottomOffset();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(load);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'thinking' | 'qloo'>('thinking');
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null);
  const [pulse, setPulse] = useState(() => {
    try {
      return sessionStorage.getItem(PULSED) !== '1';
    } catch {
      return false;
    }
  });
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => save(turns), [turns]);
  useEffect(() => {
    if (!pulse) return;
    try {
      sessionStorage.setItem(PULSED, '1');
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => setPulse(false), 4200);
    return () => window.clearTimeout(t);
  }, [pulse]);

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => launcher.current?.focus(), 30);
  }, []);
  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => area.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const a = document.activeElement;
      if (panel.current?.contains(a) || a === document.body) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);
  // keep the newest message in view
  useLayoutEffect(() => {
    const s = scroller.current;
    if (s) s.scrollTop = s.scrollHeight;
  }, [turns, busy, open, error]);

  const send = useCallback(
    async (text: string, history?: Turn[]) => {
      const q = text.trim();
      if (!q || busy) return;
      const base = history ?? turns;
      const next: Turn[] = [...base, { role: 'user', content: q }];
      setTurns(next);
      setInput('');
      setError(null);
      setBusy(true);
      setPhase('thinking');
      const t = window.setTimeout(() => setPhase('qloo'), 1500);
      try {
        const msgs = next.slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
        const section = routePid ? (loc.pathname.split('/')[3] ?? '') : '';
        const sel = pid ? loadSelection(pid) : {};
        const page = {
          path: loc.pathname,
          name: routePid ? (PAGE_NAMES[section] ?? section) : loc.pathname === '/projects' ? 'Projects' : PAGE_NAMES[loc.pathname.slice(1)] ?? loc.pathname,
          audience_version_id: sel.audienceId,
          area_id: sel.areaId,
          run_id: sel.runId,
        };
        const reply = await mutations.assistant(msgs, pid, page);
        setTurns((cur) => [...cur, { role: 'assistant', content: reply.answer, reply }]);
      } catch (e) {
        const err = e as ApiError;
        setError(
          err?.status === 503 || err?.code === 'assistant_unavailable'
            ? { msg: 'The assistant is unavailable right now.', retry: true }
            : err?.status === 429
              ? { msg: 'You’ve asked a lot of questions in a short time. Please wait a few minutes and try again.', retry: true }
              : err?.status === 404
                ? { msg: 'That project isn’t available to you, so the assistant can’t use it.', retry: false }
                : { msg: err?.message ?? 'Something went wrong.', retry: true },
        );
      } finally {
        window.clearTimeout(t);
        setBusy(false);
      }
    },
    [busy, turns, pid, routePid, loc.pathname],
  );

  const retry = () => {
    const lastUser = [...turns].reverse().find((t) => t.role === 'user');
    if (!lastUser) return;
    const idx = turns.lastIndexOf(lastUser);
    send(lastUser.content, turns.slice(0, idx));
  };

  const excluded = project?.country_code === 'IN' ? 'Chennai' : 'Houston';
  const chips = pid
    ? ['What is this product and who is it for?', 'What claims can I use in ads?', `Why is ${excluded} excluded?`, 'Which audience should I lead with?']
    : ['What can LaunchLens do?', 'Which brands do Bad Bunny fans like?', 'Where in New York would Taylor Swift fans hang out?', 'How do I start a new launch plan?'];

  if (guide.active) return null;

  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="launcher"
            ref={launcher}
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            style={{ bottom }}
            data-tip="assistant"
            data-testid="assistant-launcher"
            aria-label="Ask LaunchLens"
            aria-haspopup="dialog"
            className="fixed right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7A45] via-[#F0567A] to-[#1F6FEB] text-white shadow-[0_14px_34px_-10px_rgb(31_111_235/0.7)] transition-[transform,box-shadow] duration-200 hover:scale-105 hover:shadow-[0_18px_40px_-10px_rgb(255_106_47/0.75)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100 sm:right-6"
          >
            {pulse && !reduce && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[#FF7A45]/40" />}
            <MessageCircle className="relative h-6 w-6" aria-hidden />
            <Sparkles className="absolute right-2.5 top-2.5 h-3.5 w-3.5" aria-hidden />
            {turns.length > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-ok" />}
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            ref={panel}
            role="dialog"
            aria-label="Ask LaunchLens"
            data-testid="assistant-panel"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            style={mobile ? undefined : { bottom, height: `min(600px, calc(100vh - ${bottom + 20}px))` }}
            className={cn(
              'fixed z-[60] flex flex-col overflow-hidden border border-line bg-surface shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45)]',
              mobile ? 'inset-0 rounded-none' : 'right-4 w-[400px] rounded-3xl sm:right-6',
            )}
          >
            <Header
              onMin={close}
              onClose={close}
              onNew={() => {
                setTurns([]);
                setError(null);
                area.current?.focus();
              }}
              canReset={turns.length > 0}
            />
            <div ref={scroller} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite" data-testid="assistant-messages">
              {project && (
                <p className="flex items-center gap-1.5 rounded-xl border border-line bg-surface2/60 px-3 py-1.5 text-[12px] text-muted" data-testid="assistant-context">
                  <span className="font-medium text-fg">Talking about:</span>
                  <span className="truncate">{project.product?.name ?? project.name}</span>
                  {!routePid && <span className="shrink-0 text-subtle">· last opened</span>}
                </p>
              )}
              {turns.length === 0 && <Empty chips={chips} onAsk={(q) => send(q)} inProject={!!pid} />}
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-[#FF7A45] to-[#F0567A] px-3.5 py-2 text-[14px] text-white shadow-card" data-testid="assistant-user-msg">
                      {t.content}
                    </p>
                  </div>
                ) : (
                  <AssistantBubble
                    key={i}
                    t={t}
                    last={i === turns.length - 1}
                    onAsk={(q) => send(q)}
                    onLink={(to) => {
                      nav(to);
                      if (mobile) setOpen(false);
                    }}
                  />
                ),
              )}
              {busy && (
                <div className="flex items-center gap-2 text-[13px] text-muted" data-testid="assistant-typing">
                  <span className="flex h-8 items-center gap-1 rounded-2xl rounded-bl-md bg-surface2 px-3">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-subtle motion-reduce:animate-none" style={{ animationDelay: `${d * 0.15}s` }} />
                    ))}
                  </span>
                  {phase === 'thinking' ? 'Thinking…' : 'Checking Qloo…'}
                </div>
              )}
              {error && (
                <div role="alert" className="rounded-2xl border border-bad/25 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad" data-testid="assistant-error">
                  <p className="font-medium">{error.msg}</p>
                  {error.retry && (
                    <button type="button" onClick={retry} className="mt-1.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-bad/30 bg-surface px-2.5 text-[12.5px] font-semibold text-fg hover:bg-surface2">
                      <RotateCcw className="h-3.5 w-3.5" /> Retry
                    </button>
                  )}
                </div>
              )}
            </div>
            <Composer value={input} onChange={setInput} onSend={() => send(input)} busy={busy} areaRef={area} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Header({ onMin, onClose, onNew, canReset }: { onMin: () => void; onClose: () => void; onNew: () => void; canReset: boolean }) {
  return (
    <div className="relative flex items-center gap-2.5 border-b border-line bg-gradient-to-r from-brand-soft/70 via-surface to-accent-soft/70 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] text-white" aria-hidden>
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-bold leading-tight">Ask LaunchLens</p>
        <span className="mt-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-accent/30 bg-surface/80 px-2 py-[1px] text-[10.5px] font-semibold text-accent-ink">
          <Fingerprint className="h-3 w-3" aria-hidden /> Powered by Qloo + AI
        </span>
      </div>
      {canReset && (
        <button type="button" onClick={onNew} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="New chat" title="New chat">
          <SquarePen className="h-4 w-4" aria-hidden />
        </button>
      )}
      <button type="button" onClick={onMin} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Minimise chat">
        <Minus className="h-4 w-4" />
      </button>
      <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-fg [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Close chat">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Empty({ chips, onAsk, inProject }: { chips: string[]; onAsk: (q: string) => void; inProject: boolean }) {
  return (
    <div className="pt-2" data-testid="assistant-empty">
      <p className="font-display text-[17px] font-bold">Hi! What would you like to know?</p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
        I can explain how LaunchLens works{inProject ? ' and what this project found' : ''}, and answer marketing questions — using live Qloo taste data when it helps, like what fans of an artist also like or where they hang out in a city.
      </p>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-subtle">Try asking</p>
      <ul className="mt-2 space-y-2">
        {chips.map((c) => (
          <li key={c}>
            <button type="button" onClick={() => onAsk(c)} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13.5px] transition hover:border-accent/50 hover:bg-accent-soft/40" data-testid="assistant-chip">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-ink" aria-hidden />
              {c}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11.5px] text-subtle">Answers are AI-written. Qloo results are labeled. Nothing in your project is changed.</p>
    </div>
  );
}

/** Plain text with short paragraphs and "- " bullets — rendered without HTML. */
function RichText({ text }: { text: string }) {
  const blocks: { kind: 'p' | 'ul'; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] });
      continue;
    }
    const bullet = /^\s*[-•*]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      const item = line.replace(/^\s*[-•*]\s+/, '');
      if (last?.kind === 'ul') last.lines.push(item);
      else blocks.push({ kind: 'ul', lines: [item] });
    } else if (last?.kind === 'p' && last.lines.length) last.lines.push(line);
    else blocks.push({ kind: 'p', lines: [line] });
  }
  return (
    <div className="space-y-2">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.kind === 'ul' ? (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {b.lines.join('\n')}
            </p>
          ),
        )}
    </div>
  );
}

function AssistantBubble({ t, last, onAsk, onLink }: { t: Turn; last: boolean; onAsk: (q: string) => void; onLink: (to: string) => void }) {
  const r = t.reply;
  return (
    <div className="space-y-2.5" data-testid="assistant-answer">
      <div className="max-w-[94%] rounded-2xl rounded-bl-md border border-line bg-surface2/60 px-3.5 py-2.5 text-[14px] leading-relaxed text-fg">
        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
          <Sparkles className="h-2.5 w-2.5" aria-hidden /> AI-written
        </span>
        <RichText text={t.content} />
      </div>
      {r && r.qloo.length > 0 && (
        <div className="space-y-2" data-testid="assistant-qloo">
          {r.qloo.map((q, i) => (
            <QlooCard key={i} q={q} />
          ))}
        </div>
      )}
      {r && r.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.links.map((l) => (
            <button key={l.to + l.label} type="button" onClick={() => onLink(l.to)} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft px-2.5 text-[12.5px] font-semibold text-accent-ink hover:border-accent [@media(pointer:coarse)]:min-h-[44px]" data-testid="assistant-link">
              {l.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ))}
        </div>
      )}
      {r && last && r.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onAsk(s)} className="min-h-[36px] rounded-full border border-line bg-surface px-3 text-left text-[12.5px] text-muted hover:border-fg/30 hover:text-fg [@media(pointer:coarse)]:min-h-[44px]" data-testid="assistant-suggestion">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TYPE_PLURAL: Record<string, string> = {
  artist: 'artists',
  brand: 'brands',
  movie: 'movies',
  tv_show: 'TV shows',
  book: 'books',
  podcast: 'podcasts',
  person: 'people',
  video_game: 'video games',
  place: 'places',
  destination: 'destinations',
};

export function lookupTitle(q: QlooLookup): string {
  const who = q.signal ? `${q.signal.name}${q.signal.type ? ` (${q.signal.type.replace(/_/g, ' ')})` : ''}` : q.interest;
  const what = TYPE_PLURAL[q.target_type] ?? q.target_type.replace(/_/g, ' ');
  return `Fans of ${who} also like — ${what}${q.city ? ` in ${q.city}` : ''}`;
}

function QlooCard({ q }: { q: QlooLookup }) {
  const max = Math.max(0.0001, ...q.results.map((r) => r.affinity ?? 0));
  return (
    <section className="rounded-2xl border border-accent/25 bg-surface p-3" aria-label={lookupTitle(q)} data-testid="assistant-qloo-card">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{lookupTitle(q)}</p>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-[1px] text-[10px] font-bold uppercase tracking-wider text-accent-ink">
          <Fingerprint className="h-2.5 w-2.5" aria-hidden /> Qloo data
        </span>
      </div>
      {q.results.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {q.results.map((r, i) => (
            <li key={`${r.name}-${i}`} className="text-[12.5px]">
              <div className="flex items-center gap-2">
                <span className="num w-4 shrink-0 text-right text-[11px] text-subtle">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium" title={r.name}>
                  {r.name}
                </span>
                {r.affinity != null && (
                  <span className="flex w-20 shrink-0 items-center gap-1" data-tip="qloo-affinity" tabIndex={0} aria-label={`Affinity ${r.affinity.toFixed(2)}`}>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-soft">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(6, Math.round(((r.affinity ?? 0) / max) * 100))}%` }} />
                    </span>
                    <span className="num w-7 text-right text-[10.5px] text-muted">{r.affinity.toFixed(2)}</span>
                  </span>
                )}
                {r.popularity != null && (
                  <span className="num shrink-0 text-[10.5px] text-subtle" title="Qloo popularity percentile (separate from affinity)">
                    pop {r.popularity.toFixed(2)}
                  </span>
                )}
              </div>
              {r.address && <p className="ml-6 truncate text-[11px] text-subtle">{r.address}</p>}
            </li>
          ))}
        </ol>
      )}
      {q.note && <p className="mt-1.5 text-[11.5px] text-muted">{q.note}</p>}
    </section>
  );
}

function Composer({ value, onChange, onSend, busy, areaRef }: { value: string; onChange: (v: string) => void; onSend: () => void; busy: boolean; areaRef: React.RefObject<HTMLTextAreaElement> }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend();
  };
  const onKey = (e: RKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-line bg-surface px-3 py-3">
      <label htmlFor="assistant-input" className="sr-only">
        Your question
      </label>
      <textarea
        id="assistant-input"
        ref={areaRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        maxLength={1200}
        placeholder="Ask about LaunchLens or your marketing…"
        className="scroll-thin max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface2/50 px-3 py-2.5 text-[14px] outline-none transition focus:border-accent/60 focus:bg-surface focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        aria-label="Send"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] text-white shadow-card transition hover:brightness-105 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </form>
  );
}
