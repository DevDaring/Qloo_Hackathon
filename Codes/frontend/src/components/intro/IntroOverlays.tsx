import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { cn } from '../../lib/format';

export type LngLat = [number, number];

export type OverlaySpec =
  | { id: string; kind: 'person'; at: LngLat; dx: number; dy: number; img: string; label: string; sub?: string; size?: number; compact?: boolean; delay: number; phase: 'globe' | 'india' }
  | { id: string; kind: 'ad'; at: LngLat; dx: number; dy: number; img: string; label: string; w: number; h: number; tilt?: number; compact?: boolean; delay: number; phase: 'india' }
  | { id: string; kind: 'video'; at: LngLat; dx: number; dy: number; src: string; poster: string; w: number; h: number; compact?: boolean; delay: number; phase: 'india' }
  | { id: string; kind: 'city'; at: LngLat; dx: number; dy: number; label: string; tone: 'candidate' | 'other' | 'excluded'; note?: string; compact?: boolean; delay: number; phase: 'india' }
  | { id: string; kind: 'evidence' | 'index'; at: LngLat; dx: number; dy: number; compact?: boolean; delay: number; phase: 'india' };

const P = '/landing/people';
const A = '/landing/ads';

export const KOLKATA: LngLat = [88.36, 22.57];
export const DELHI: LngLat = [77.21, 28.61];
export const MUMBAI: LngLat = [72.88, 19.08];
export const BENGALURU: LngLat = [77.59, 12.97];
export const CHENNAI: LngLat = [80.27, 13.08];

/** Everything that appears over the map. `at` anchors the item to a place; dx/dy (or cdx/cdy on phones) nudge it in px. */
type Pos = { cdx?: number; cdy?: number; roomyOnly?: boolean };
export const OVERLAYS: (OverlaySpec & Pos)[] = [
  // global phase: "taste signals" chips with illustrated people
  { id: 'g-ny', kind: 'person', phase: 'globe', at: [-74.0, 40.7], dx: -8, dy: -58, img: `${P}/newyork.webp`, label: 'Taste signals', sub: 'New York', size: 46, delay: 0.9 },
  { id: 'g-lagos', kind: 'person', phase: 'globe', at: [3.38, 6.52], dx: 0, dy: 56, img: `${P}/lagos.webp`, label: 'Taste signals', sub: 'Lagos', size: 46, delay: 1.5, compact: true },
  { id: 'g-tokyo', kind: 'person', phase: 'globe', at: [139.7, 35.7], dx: 0, dy: -58, img: `${P}/tokyo.webp`, label: 'Taste signals', sub: 'Tokyo', size: 46, delay: 2.4 },

  // India phase: cities
  { id: 'c-kolkata', kind: 'city', phase: 'india', at: KOLKATA, dx: 14, dy: 0, label: 'Kolkata', tone: 'candidate', note: 'candidate', compact: true, delay: 0.2 },
  { id: 'c-delhi', kind: 'city', phase: 'india', at: DELHI, dx: -14, dy: 0, cdx: -12, cdy: 0, label: 'New Delhi', tone: 'candidate', note: 'candidate', compact: true, delay: 0.45 },
  { id: 'c-mumbai', kind: 'city', phase: 'india', at: MUMBAI, dx: 14, dy: 0, label: 'Mumbai', tone: 'other', compact: true, delay: 0.7 },
  { id: 'c-bengaluru', kind: 'city', phase: 'india', at: BENGALURU, dx: -14, dy: 0, label: 'Bengaluru', tone: 'other', compact: true, delay: 0.9 },
  { id: 'c-chennai', kind: 'city', phase: 'india', at: CHENNAI, dx: 0, dy: 26, cdx: 0, cdy: 26, label: 'Chennai', tone: 'excluded', note: 'outside service area', compact: true, delay: 1.1 },

  // people near the cities (hypothetical personas, illustrated)
  { id: 'p-kolkata', kind: 'person', phase: 'india', at: KOLKATA, dx: 6, dy: -84, cdx: 52, cdy: -90, img: `${P}/kolkata-user.webp`, label: 'Power-chair user', sub: 'Kolkata', compact: true, delay: 1.4 },
  { id: 'p-delhi', kind: 'person', phase: 'india', at: DELHI, dx: -44, dy: -96, cdx: -59, cdy: -70, img: `${P}/delhi-family.webp`, label: 'Family buyer', sub: 'New Delhi', compact: true, delay: 1.7 },
  { id: 'p-hospital', kind: 'person', phase: 'india', at: KOLKATA, dx: 62, dy: 112, img: `${P}/hospital-lead.webp`, label: 'Hospital procurement', sub: 'Kolkata', delay: 2.0, roomyOnly: true },
  { id: 'p-dist', kind: 'person', phase: 'india', at: MUMBAI, dx: -72, dy: 10, img: `${P}/distributor.webp`, label: 'Distributor', sub: 'Mumbai', delay: 2.3 },

  // ads that fly out of the cities (real LaunchLens outputs)
  { id: 'a-bn', kind: 'ad', phase: 'india', at: KOLKATA, dx: 212, dy: -12, cdx: 88, cdy: 90, img: `${A}/flyer-bn-square.webp`, label: 'বাংলা flyer · Kolkata', w: 132, h: 132, tilt: -7, compact: true, delay: 2.6 },
  { id: 'a-hi', kind: 'ad', phase: 'india', at: DELHI, dx: 82, dy: -150, img: `${A}/flyer-hi-square.webp`, label: 'हिन्दी flyer · New Delhi', w: 120, h: 120, tilt: 6, delay: 2.9 },
  { id: 'a-en', kind: 'ad', phase: 'india', at: KOLKATA, dx: 112, dy: 250, img: `${A}/flyer-en-institutional.webp`, label: 'Institutional brief', w: 112, h: 112, tilt: 5, delay: 3.2, roomyOnly: true },
  { id: 'v-bn', kind: 'video', phase: 'india', at: KOLKATA, dx: 228, dy: 196, cdx: -203, cdy: 80, src: `${A}/video-bn-loop.mp4`, poster: `${A}/video-bn-poster.webp`, w: 98, h: 174, compact: true, delay: 3.5 },

  // evidence + index
  { id: 'e-kolkata', kind: 'evidence', phase: 'india', at: CHENNAI, dx: -40, dy: 134, delay: 3.9 },
  { id: 'i-delhi', kind: 'index', phase: 'india', at: DELHI, dx: 252, dy: -96, delay: 4.2 },
];

const pop = (delay: number, instant: boolean) => ({
  initial: instant ? false : { opacity: 0, scale: 0.55, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0 },
  transition: instant ? { duration: 0 } : { delay, type: 'spring' as const, stiffness: 220, damping: 18 },
});

/** Positioned shell: the parent sets `transform: translate(x,y)` imperatively (map) or via style (fallback). */
export const OverlayShell = forwardRef<HTMLDivElement, { style?: CSSProperties; children: ReactNode; className?: string; align?: 'center' | 'left' | 'right'; scale?: number }>(
  function OverlayShell({ style, children, className, align = 'center', scale = 1 }, ref) {
    const a = align === 'left' ? '-translate-y-1/2' : align === 'right' ? '-translate-x-full -translate-y-1/2' : '-translate-x-1/2 -translate-y-1/2';
    const origin = align === 'left' ? 'left center' : align === 'right' ? 'right center' : 'center';
    return (
      <div ref={ref} className={cn('pointer-events-none absolute left-0 top-0 will-change-transform', className)} style={style}>
        <div className={a}>
          <div style={scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: origin } : undefined}>{children}</div>
        </div>
      </div>
    );
  },
);

export const alignOf = (o: OverlaySpec & { cdx?: number }, compact = false): 'center' | 'left' | 'right' => {
  if (o.kind !== 'city') return 'center';
  const dx = compact && o.cdx !== undefined ? o.cdx : o.dx;
  return dx < 0 ? 'right' : dx > 0 ? 'left' : 'center';
};

export function OverlayBody({ o, instant, compact }: { o: OverlaySpec; instant: boolean; compact: boolean }) {
  const anim = pop(o.delay, instant);
  const scale = compact ? 0.72 : 1;
  switch (o.kind) {
    case 'person': {
      const s = (o.size ?? 60) * (compact ? 0.82 : 1);
      return (
        <motion.div {...anim} className="flex flex-col items-center">
          <div className="animate-floaty" style={{ animationDelay: `${-o.delay * 1.3}s` }}>
            <div className="relative rounded-full bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] p-[2.5px] shadow-[0_10px_30px_-8px_rgba(255,122,69,0.65)]" style={{ width: s, height: s }}>
              <img src={o.img} alt={`Illustrated hypothetical persona: ${o.label}${o.sub ? `, ${o.sub}` : ''} (AI-generated illustration)`} className="h-full w-full rounded-full object-cover ring-2 ring-[#0B1020]" />
              <span className="absolute -right-0.5 bottom-0.5 h-3 w-3 rounded-full border-2 border-[#0B1020] bg-emerald-400" />
            </div>
          </div>
          <div className="mt-1.5 whitespace-nowrap rounded-full border border-white/15 bg-[#0B1020]/75 px-2.5 py-1 text-center text-[10.5px] font-semibold leading-tight text-white backdrop-blur-md">
            {o.label}
            {o.sub && <span className="font-normal text-white/60"> · {o.sub}</span>}
          </div>
        </motion.div>
      );
    }
    case 'ad':
      return (
        <motion.div {...anim} style={{ perspective: 700 }}>
          <div className="animate-floaty" style={{ animationDelay: `${-o.delay}s` }}>
            <figure
              className="overflow-hidden rounded-xl border border-white/20 bg-[#0B1020] p-1 shadow-[0_24px_50px_-14px_rgba(0,0,0,0.75)]"
              style={{ width: o.w * scale, transform: `rotateY(${o.tilt ?? 0}deg) rotateX(4deg)` }}
            >
              <img src={o.img} alt={`${o.label} — flyer generated by LaunchLens for the sample project`} className="block w-full rounded-lg" style={{ height: o.h * scale, objectFit: 'cover' }} />
              <figcaption className="px-1 pb-0.5 pt-1 text-[9px] font-semibold leading-tight text-white/80">
                {o.label}
                <span className="block font-normal text-white/45">Generated by LaunchLens · sample</span>
              </figcaption>
            </figure>
          </div>
        </motion.div>
      );
    case 'video':
      return (
        <motion.div {...anim} style={{ perspective: 700 }}>
          <div className="animate-floaty" style={{ animationDelay: '-2.2s' }}>
            <figure className="overflow-hidden rounded-xl border border-white/20 bg-[#0B1020] p-1 shadow-[0_24px_50px_-14px_rgba(0,0,0,0.75)]" style={{ width: o.w * scale, transform: 'rotateY(-9deg) rotateX(3deg)' }}>
              <div className="relative">
                <video
                  src={o.src}
                  poster={o.poster}
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                  aria-label="Bengali video ad generated by LaunchLens for the sample project (muted loop)"
                  className="block w-full rounded-lg object-cover"
                  style={{ height: o.h * scale }}
                />
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[8.5px] font-bold text-white">
                  <Play className="h-2 w-2 fill-white" /> 9:16 · captioned
                </span>
              </div>
              <figcaption className="px-1 pb-0.5 pt-1 text-[9px] font-semibold leading-tight text-white/80">
                Video ad · বাংলা
                <span className="block font-normal text-white/45">Generated by LaunchLens · sample</span>
              </figcaption>
            </figure>
          </div>
        </motion.div>
      );
    case 'city': {
      const tone =
        o.tone === 'excluded'
          ? 'border-[#E5484D]/60 bg-[#2A0F14]/85 text-[#FFB3B5]'
          : o.tone === 'candidate'
            ? 'border-[#FF7A45]/50 bg-[#0B1020]/80 text-white'
            : 'border-[#6EA8FF]/40 bg-[#0B1020]/80 text-white';
      return (
        <motion.div {...anim} className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold backdrop-blur-md', tone)}>
          {o.tone === 'excluded' && <X className="h-3 w-3" strokeWidth={3} />}
          {o.label}
          {o.note && (!compact || o.tone === 'excluded') && <span className={cn('font-normal', o.tone === 'excluded' ? 'text-[#FFB3B5]/80' : 'text-white/55')}>· {o.note}</span>}
        </motion.div>
      );
    }
    case 'evidence':
      return (
        <motion.div {...anim} className="w-[236px] rounded-2xl border border-white/15 bg-[#0B1020]/85 p-3 shadow-[0_24px_50px_-14px_rgba(0,0,0,0.75)] backdrop-blur-md">
          <p className="text-[11px] font-bold text-white">Evidence · Kolkata</p>
          <div className="mt-2 space-y-1.5">
            <EvRow cls="bg-emerald-400/15 text-emerald-300 border-emerald-400/30" b="Supported" t="56.7 hot days/yr (ERA5)" />
            <EvRow cls="bg-sky-400/15 text-sky-300 border-sky-400/30" b="Derived" t="inside service area" />
            <EvRow cls="border-dashed border-white/25 text-white/60" b="Unknown" t="measured noise — no data" />
          </div>
        </motion.div>
      );
    case 'index':
      return (
        <motion.div {...anim} className="w-[196px] rounded-2xl border border-white/15 bg-[#0B1020]/85 p-3 shadow-[0_24px_50px_-14px_rgba(0,0,0,0.75)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-white">New Delhi</span>
            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">provisional</span>
          </div>
          <p className="mt-1 font-display text-xl font-extrabold tracking-tight text-white">
            0.45 <span className="text-[10.5px] font-semibold text-white/55">of 70% weight</span>
          </p>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-white/10">
            <span className="h-full w-[28%] bg-[#FF7A45]" />
            <span className="h-full w-[18%] bg-[#1F6FEB]" />
            <span className="h-full w-[11%] bg-[#12A594]" />
            <span className="h-full w-[13%] bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.25)_0_3px,transparent_3px_6px)]" />
          </div>
          <p className="mt-1 text-[9.5px] text-white/50">Planning index, not a forecast · Qloo fit unknown</p>
        </motion.div>
      );
  }
}

function EvRow({ cls, b, t }: { cls: string; b: string; t: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold', cls)}>{b}</span>
      <span className="truncate text-[10.5px] text-white/70">{t}</span>
    </div>
  );
}

/** Deterministic twinkling star field (pure CSS). */
export function Starfield({ className }: { className?: string }) {
  const stars = Array.from({ length: 90 }, (_, i) => {
    const r = (n: number) => {
      const x = Math.sin(i * 97.13 + n * 13.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return { left: r(1) * 100, top: r(2) * 100, s: r(3) < 0.85 ? 1 : 2, d: 2 + r(4) * 4, o: 0.25 + r(5) * 0.6 };
  });
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.s, height: s.s, opacity: s.o, animation: `twinkle ${s.d}s ease-in-out ${(-s.d * (i % 7)) / 7}s infinite` }}
        />
      ))}
    </div>
  );
}

/** Meaningful poster while the globe loads: the real opening frame (NASA Blue Marble), placed where the globe appears. */
export function GlobePoster() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <img
        src="/landing/globe-poster.jpg"
        alt=""
        width={604}
        height={604}
        className="absolute left-1/2 top-[45%] w-[min(52vw,210px)] -translate-x-1/2 -translate-y-1/2 opacity-90 [mask-image:radial-gradient(circle,black_58%,transparent_70%)] lg:left-[69%] lg:top-[52%] lg:w-[min(28.6vw,45.5vh)]"
      />
    </div>
  );
}
