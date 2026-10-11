/**
 * A verified how-to guide inside the chat: numbered steps, each with an
 * annotated screenshot (click to enlarge), the exact button names in bold and a
 * "Show me" button that opens the page and pulses a ring around the control.
 * "Start step-by-step" walks through the steps one at a time.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Expand, ListOrdered, MousePointerClick, PlayCircle, X } from 'lucide-react';
import type { HowTo } from '../api/types';
import { cn } from '../lib/format';
import { Lightbox, type MediaItem } from './InteractiveMedia';

/** `**bold**` → <b>; everything else stays plain text (never HTML). */
export function Bold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <b key={i} className="font-semibold text-fg">
            {p.slice(2, -2)}
          </b>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function HowToCard({ howto, onShow }: { howto: HowTo; onShow: (to: string) => void }) {
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState<number | null>(null);
  const [walk, setWalk] = useState<number | null>(null);
  const plain = (t: string) => t.replace(/\*\*/g, '');
  const media: MediaItem[] = useMemo(
    () => howto.steps.filter((s) => !broken.has(s.n)).map((s) => ({ src: s.image, alt: `Step ${s.n}: ${plain(s.text)}`, caption: `${howto.title} — step ${s.n} of ${howto.steps.length}`, meta: plain(s.text) })),
    [howto, broken],
  );
  const openZoom = (n: number) => setZoom(Math.max(0, media.findIndex((m) => m.src === howto.steps[n - 1].image)));
  const markBroken = (n: number) => setBroken((b) => new Set(b).add(n));

  const step = walk !== null ? howto.steps[walk] : null;
  return (
    <section className="rounded-2xl border border-brand/30 bg-surface p-3" aria-label={`How to: ${howto.title}`} data-testid="howto-card">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] text-white" aria-hidden>
          <ListOrdered className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">How to</p>
          <h3 className="font-display text-[15px] font-bold leading-snug">{howto.title}</h3>
        </div>
      </div>
      {howto.needs && (
        <p className="mt-2 rounded-lg bg-warn-soft/60 px-2.5 py-1.5 text-[12px] leading-snug text-fg" data-testid="howto-needs">
          <b className="font-semibold">You need: </b>
          {howto.needs}
        </p>
      )}

      {step ? (
        <div className="mt-3" data-testid="howto-walk" aria-live="polite">
          <div className="flex items-center gap-2 text-[11.5px] font-semibold text-subtle">
            Step {step.n} of {howto.steps.length}
            <div className="flex flex-1 gap-1" aria-hidden>
              {howto.steps.map((s) => (
                <span key={s.n} className={cn('h-1 flex-1 rounded-full', s.n <= step.n ? 'bg-brand' : 'bg-line')} />
              ))}
            </div>
            <button type="button" onClick={() => setWalk(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-surface2 hover:text-fg" aria-label="Show all steps">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <StepBody s={step} total={howto.steps.length} big broken={broken.has(step.n)} onBroken={markBroken} onZoom={openZoom} onShow={onShow} />
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => setWalk((w) => Math.max(0, (w ?? 0) - 1))} disabled={walk === 0} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-line px-3 text-[13px] font-medium disabled:opacity-40 [@media(pointer:coarse)]:min-h-[44px]">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            {walk! < howto.steps.length - 1 ? (
              <button type="button" onClick={() => setWalk((w) => (w ?? 0) + 1)} className="ml-auto inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white dark:bg-white dark:text-[#0E1320] [@media(pointer:coarse)]:min-h-[44px]" data-testid="howto-next">
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button type="button" onClick={() => setWalk(null)} className="ml-auto inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white dark:bg-white dark:text-[#0E1320] [@media(pointer:coarse)]:min-h-[44px]">
                Done
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <ol className="mt-3 space-y-3">
            {howto.steps.map((s) => (
              <li key={s.n} data-testid="howto-step">
                <StepBody s={s} total={howto.steps.length} broken={broken.has(s.n)} onBroken={markBroken} onZoom={openZoom} onShow={onShow} />
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setWalk(0)}
            className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FF7A45] to-[#1F6FEB] px-3 text-[13px] font-semibold text-white shadow-card hover:brightness-105 [@media(pointer:coarse)]:min-h-[44px]"
            data-testid="howto-start"
          >
            <PlayCircle className="h-4 w-4" aria-hidden /> Start step-by-step
          </button>
        </>
      )}
      <Lightbox items={media} index={zoom} onIndex={setZoom} />
    </section>
  );
}

function StepBody({
  s,
  total,
  big,
  broken,
  onBroken,
  onZoom,
  onShow,
}: {
  s: HowTo['steps'][number];
  total: number;
  big?: boolean;
  broken: boolean;
  onBroken: (n: number) => void;
  onZoom: (n: number) => void;
  onShow: (to: string) => void;
}): ReactNode {
  return (
    <div className="flex gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-[#1A0E08]" aria-label={`Step ${s.n} of ${total}`}>
        {s.n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug text-muted">
          <Bold text={s.text} />
        </p>
        {!broken && (
          <button
            type="button"
            data-media
            onClick={() => onZoom(s.n)}
            className={cn('group/media relative mt-2 block overflow-hidden rounded-xl border border-line bg-surface2 transition hover:border-brand/60 hover:shadow-[0_0_0_3px_rgb(var(--primary)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', big ? 'w-full' : 'w-full max-w-[260px]')}
            aria-label={`Enlarge the screenshot for step ${s.n}`}
          >
            <img
              src={s.image}
              alt={`Screenshot: ${s.text.replace(/\*\*/g, '')}`}
              loading="lazy"
              onError={() => onBroken(s.n)}
              className="aspect-[900/560] w-full object-cover transition-transform duration-200 group-hover/media:scale-[1.03] motion-reduce:transition-none"
              data-testid="howto-image"
            />
            <span aria-hidden className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white">
              <Expand className="h-3 w-3" />
            </span>
          </button>
        )}
        {s.to && (
          <button
            type="button"
            onClick={() => onShow(s.to!)}
            className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 text-[12.5px] font-semibold text-accent-ink transition hover:border-accent [@media(pointer:coarse)]:min-h-[44px]"
            data-testid="howto-show"
          >
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden /> Show me
          </button>
        )}
      </div>
    </div>
  );
}
