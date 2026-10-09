import { IndiaMap, project } from '../IndiaMap';
import { OVERLAYS, OverlayBody, OverlayShell, alignOf } from './IntroOverlays';

/** Same story without WebGL: animated SVG India with the people / ads / evidence overlays. */
const W = Math.ceil(project(97.6, 0)[0]) + 20;
const H = Math.ceil(project(0, 7.6)[1]) + 20;
const pct = (lon: number, lat: number) => {
  const [x, y] = project(lon, lat);
  return [((x + 10) / W) * 100, ((y + 10) / H) * 100];
};

const KEEP = new Set(['c-kolkata', 'c-delhi', 'c-mumbai', 'c-bengaluru', 'c-chennai', 'p-kolkata', 'p-delhi', 'a-bn', 'a-hi', 'v-bn', 'e-kolkata']);
const KEEP_COMPACT = new Set(['c-kolkata', 'c-delhi', 'c-chennai', 'p-kolkata']);

export function IntroFallback({ compact = false }: { compact?: boolean }) {
  const items = OVERLAYS.filter((o) => (compact ? KEEP_COMPACT : KEEP).has(o.id));
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 lg:pl-[42%] lg:pr-8" data-testid="hero-fallback">
      <div className="relative h-full max-h-[86%] max-w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <IndiaMap dark showLabels={false} className="h-full w-full" />
        {items.map((o) => {
          const [x, y] = pct(o.at[0], o.at[1]);
          const k = compact ? 0.55 : o.kind === 'city' ? 0.8 : 0.62;
          return (
            <OverlayShell key={o.id} align={alignOf(o)} className={o.kind === 'city' ? 'z-20' : 'z-10'} style={{ left: `calc(${x}% + ${o.dx * k}px)`, top: `calc(${y}% + ${o.dy * k}px)` }}>
              <OverlayBody o={{ ...o, delay: 0.6 + o.delay * 0.5 }} instant={false} compact={compact || o.kind === 'ad' || o.kind === 'video'} />
            </OverlayShell>
          );
        })}
      </div>
    </div>
  );
}
