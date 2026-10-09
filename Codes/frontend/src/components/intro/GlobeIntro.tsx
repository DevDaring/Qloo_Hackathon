/**
 * Cinematic landing intro: a MapLibre v5 globe with "taste signal" arcs between
 * global cities, a camera flight into India, then candidate cities, people and
 * real LaunchLens ads anchored to the map. Driven by one pausable clock so
 * Skip / Replay / tab-hidden pausing are exact. Lazy-loaded (maplibre chunk).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { RotateCcw, SkipForward } from 'lucide-react';
import { SPARKLE_CITIES } from './sparkleCities';
import { BENGALURU, CHENNAI, DELHI, KOLKATA, MUMBAI, OVERLAYS, OverlayBody, OverlayShell, alignOf, type LngLat, type OverlaySpec } from './IntroOverlays';

type Phase = 'globe' | 'night' | 'fly' | 'india' | 'idle';
const T_NIGHT = 4.0; // Blue Marble → Black Marble night lights, arcs begin
const T_FLY = 7.0; // converge: arcs bend to India, imagery dissolves into the styled globe, camera flies in
const T_INDIA = 10.2; // India reveal (cities → people → ads → evidence), unchanged from before
const T_IDLE = 14.4;
const ROT0 = -88; // start over the Americas
const ROT_V = 17; // degrees of longitude per second, west → east
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const NASA_ATTR = 'Imagery: NASA Blue Marble &amp; Black Marble (NASA EOSDIS GIBS)';
const SESSION_KEY = 'll-intro-played-v1';

const G: Record<string, LngLat> = {
  ny: [-74.0, 40.7],
  sp: [-46.6, -23.5],
  lon: [-0.13, 51.5],
  lagos: [3.38, 6.52],
  dubai: [55.27, 25.2],
  tokyo: [139.7, 35.7],
  sydney: [151.2, -33.9],
  sing: [103.8, 1.35],
  mumbai: MUMBAI,
};

type Arc = { pts: LngLat[]; t0: number; grp: 'global' | 'converge' | 'india'; period: number; off: number };

function greatCircle(a: LngLat, b: LngLat, n = 72): LngLat[] {
  const r = Math.PI / 180;
  const [l1, p1, l2, p2] = [a[0] * r, a[1] * r, b[0] * r, b[1] * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  const out: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(y, x) / r, Math.atan2(z, Math.sqrt(x * x + y * y)) / r]);
  }
  return out;
}

const ARCS: Arc[] = (() => {
  const mk = (a: LngLat, b: LngLat, t0: number, grp: Arc['grp'], i: number): Arc => ({ pts: greatCircle(a, b, grp === 'india' ? 48 : 72), t0, grp, period: 2.4 + (i % 3) * 0.5, off: (i * 0.37) % 1 });
  const global: [string, string][] = [
    ['ny', 'lon'],
    ['ny', 'sp'],
    ['sp', 'lagos'],
    ['lon', 'lagos'],
    ['lon', 'dubai'],
    ['lagos', 'dubai'],
    ['tokyo', 'sing'],
    ['sydney', 'sing'],
  ];
  const converge: [LngLat, LngLat][] = [
    [G.lon, DELHI],
    [G.dubai, MUMBAI],
    [G.lagos, MUMBAI],
    [G.sing, KOLKATA],
    [G.tokyo, KOLKATA],
    [G.ny, DELHI],
    [G.sydney, KOLKATA],
  ];
  const india: [LngLat, LngLat][] = [
    [DELHI, KOLKATA],
    [MUMBAI, DELHI],
    [MUMBAI, BENGALURU],
    [BENGALURU, KOLKATA],
  ];
  return [
    ...global.map(([a, b], i) => mk(G[a], G[b], T_NIGHT + 0.2 + i * 0.25, 'global', i)),
    ...converge.map(([a, b], i) => mk(a, b, T_FLY - 0.4 + i * 0.22, 'converge', i + 8)),
    ...india.map(([a, b], i) => mk(a, b, T_INDIA + 1.0 + i * 0.25, 'india', i + 16)),
  ];
})();

const INDIA_POINTS: { at: LngLat; color: string; delay: number }[] = [
  { at: KOLKATA, color: '#FF7A45', delay: 0.2 },
  { at: DELHI, color: '#FF7A45', delay: 0.45 },
  { at: MUMBAI, color: '#6EA8FF', delay: 0.7 },
  { at: BENGALURU, color: '#6EA8FF', delay: 0.9 },
  { at: CHENNAI, color: '#E5484D', delay: 1.1 },
];

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const smooth = (x: number) => {
  const c = clamp(x);
  return c * c * (3 - 2 * c);
};
/** cubic Hermite: continuous position *and* velocity between the rotation and the fly-in */
const hermite = (p0: number, m0: number, p1: number, m1: number, s: number) => {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
};
/** imagery opacities over time (0..1) */
const dayOpacity = (t: number) => 1 - smooth((t - T_NIGHT) / 2.5);
const nightOpacity = (t: number) => smooth((t - T_NIGHT) / 2.5) * (1 - smooth((t - (T_FLY + 0.6)) / 2.2));

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, k: number) => {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`;
};
/** Basemap tint: dark globe → readable India (warm-grey land, deep navy water, visible borders). */
const TINT = {
  land: ['#161D2C', '#4A4E58'],
  water: ['#060B17', '#0A1A36'],
  border: ['#56627F', '#C9D3EA'],
};

function layout(w: number, h: number) {
  const compact = w < 768;
  // globe radius ≈ 81.5 * 2^zoom px; aim for ~36% of the smaller side
  const target = Math.min(w * (compact ? 0.78 : 0.44), h * 0.7) / 2;
  const zg = Math.log2(target / 81.5);
  const zf = compact ? 0 : Math.min(Math.log2((w * 0.6) / 860), Math.log2(h / 900));
  return {
    compact,
    roomy: !compact && w >= 1360 && h >= 820,
    k: compact ? 0.72 : clamp(2 ** zf, 0.78, 1),
    padding: compact ? { left: 0, right: 0, top: 46, bottom: 96 } : { left: Math.round(w * 0.4), right: 24, top: 70, bottom: 30 },
    zg,
    final: compact
      ? { center: [80.6, 20.6] as LngLat, zoom: Math.log2(w / 390) + 2.28, pitch: 18, bearing: -5 }
      : { center: [83.0, 21.2] as LngLat, zoom: zf + 3.42, pitch: 34, bearing: -9 },
  };
}

export default function GlobeIntro({ styleUrl, onFallback }: { styleUrl: string; onFallback: (why: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ovRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const glowRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('globe');
  const [instant, setInstant] = useState(false);
  const [compact, setCompact] = useState(false);
  const [roomy, setRoomy] = useState(true);
  const [cardScale, setCardScale] = useState(1);
  const tRef = useRef(0);
  const rasterOk = useRef(true);
  const lay = useRef(layout(1200, 800));
  const phaseRef = useRef<Phase>('globe');
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  const camera = useCallback(
    (t: number) => {
      const L = lay.current;
      const f = L.final;
      if (t < T_FLY) {
        // steady west → east rotation, with a gentle scale-in as the Earth "wakes up"
        const intro = easeOutCubic(clamp(t / 2.4));
        return {
          center: [ROT0 + ROT_V * t, lerp(8, 20, easeInOutSine(t / T_FLY))] as LngLat,
          zoom: L.zg - 0.55 * (1 - intro),
          pitch: 0,
          bearing: 0,
        };
      }
      if (t < T_INDIA) {
        // one continuous move: rotation velocity hands over smoothly into the fly-in (Hermite), rotation eases out
        const D = T_INDIA - T_FLY;
        const s = (t - T_FLY) / D;
        const k = easeInOutCubic(s);
        return {
          center: [hermite(ROT0 + ROT_V * T_FLY, ROT_V * D, f.center[0], 0, s), hermite(20, 0, f.center[1], 0, s)] as LngLat,
          zoom: lerp(L.zg, f.zoom, k),
          pitch: lerp(0, f.pitch, k),
          bearing: lerp(0, f.bearing, k),
        };
      }
      const drift = reduce ? 0 : clamp((t - T_IDLE) / 2.5);
      const sn = Math.sin((t - T_IDLE) * 0.28);
      return { center: f.center, zoom: f.zoom + drift * 0.04 * Math.sin((t - T_IDLE) * 0.2), pitch: f.pitch, bearing: f.bearing + drift * 3.2 * sn };
    },
    [reduce],
  );

  /* ------------------------------------------------ data per frame */
  const frameData = useCallback(
    (t: number) => {
      const arcs: GeoJSON.Feature[] = [];
      const trails: GeoJSON.Feature[] = [];
      const heads: GeoJSON.Feature[] = [];
      const indiaFade = t > T_INDIA ? Math.max(0.12, 1 - (t - T_INDIA) / 1.4) : 1;
      for (const a of ARCS) {
        if (t < a.t0) continue;
        const g = easeOutCubic(clamp((t - a.t0) / 1.3));
        const n = a.pts.length - 1;
        const end = Math.max(1, Math.ceil(g * n));
        const o = a.grp === 'global' ? indiaFade : a.grp === 'converge' ? (t > T_INDIA ? Math.max(0.35, indiaFade) : 1) : 1;
        arcs.push({ type: 'Feature', properties: { grp: a.grp, o: o * 0.85 }, geometry: { type: 'LineString', coordinates: a.pts.slice(0, end + 1) } });
        if (g < 1) {
          heads.push({ type: 'Feature', properties: { grp: a.grp, o }, geometry: { type: 'Point', coordinates: a.pts[end] } });
        } else if (!reduce) {
          const h = (((t - a.t0 - 1.3) / a.period + a.off) % 1) * 1.25; // brief pause at the end of each loop
          if (h <= 1) {
            const i1 = Math.round(h * n);
            const i0 = Math.max(0, Math.round((h - 0.2) * n));
            if (i1 - i0 >= 1) trails.push({ type: 'Feature', properties: { grp: a.grp, o }, geometry: { type: 'LineString', coordinates: a.pts.slice(i0, i1 + 1) } });
            heads.push({ type: 'Feature', properties: { grp: a.grp, o }, geometry: { type: 'Point', coordinates: a.pts[i1] } });
          }
        }
      }
      const gpts: GeoJSON.Feature[] = Object.values(G).map((p, i) => {
        const k = reduce ? 0.5 : (t * 0.55 + i * 0.13) % 1;
        const vis = clamp((t - T_NIGHT - i * 0.12) / 0.5);
        return { type: 'Feature', properties: { r: (3 + 13 * k) * vis, o: (1 - k) * 0.85 * vis, core: 3.6 * vis }, geometry: { type: 'Point', coordinates: p } };
      });
      const cpts: GeoJSON.Feature[] = INDIA_POINTS.map((p, i) => {
        const s = easeOutCubic(clamp((t - T_INDIA - p.delay) / 0.5));
        const k = reduce ? 0.5 : (t * 0.6 + i * 0.21) % 1;
        return { type: 'Feature', properties: { color: p.color, core: 6.5 * s, r: (6 + 18 * k) * s, o: (1 - k) * 0.7 * s }, geometry: { type: 'Point', coordinates: p.at } };
      });
      // glitter: twinkling city lights, strongest at night, gone before the India reveal
      const env = clamp(t / 1.2) * (1 - smooth((t - (T_FLY + 1.2)) / 1.6));
      const glitter: GeoJSON.Feature[] =
        env <= 0.01
          ? []
          : SPARKLE_CITIES.map((p, i) => {
              const ph = (i * 2.399) % (Math.PI * 2);
              const w = 1.4 + (i % 7) * 0.35;
              const tw = reduce ? 0.6 : Math.pow(0.5 + 0.5 * Math.sin(t * w + ph), 3);
              const night = 0.65 + 0.35 * nightOpacity(t);
              return { type: 'Feature', properties: { o: (0.25 + 0.75 * tw) * env * night, r: 1.1 + 2.6 * tw, h: (3 + 7 * tw) * env }, geometry: { type: 'Point', coordinates: p } };
            });
      return { arcs, trails, heads, gpts, cpts, glitter };
    },
    [reduce],
  );

  /* ------------------------------------------------ overlay positioning */
  const place = useCallback(() => {
    const m = mapRef.current;
    const el = box.current;
    if (!m || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const c = m.getCenter();
    const compactNow = lay.current.compact;
    const k = lay.current.k;
    const margin = 16;
    const bottomSafe = compactNow ? 100 : 104; // keep clear of the caption
    const r = Math.PI / 180;
    // atmospheric halo that follows the globe (centre of the padded frame), fading out as we fly in
    const g = glowRef.current;
    if (g) {
      const pd = lay.current.padding;
      const gx = pd.left + (w - pd.left - pd.right) / 2;
      const gy = pd.top + (h - pd.top - pd.bottom) / 2;
      const R = 71 * 2 ** m.getZoom();
      const t = tRef.current;
      const op = (1 - smooth((t - T_FLY) / 1.6)) * clamp(t / 1.2);
      g.style.transform = `translate3d(${(gx - R * 1.45).toFixed(1)}px, ${(gy - R * 1.45).toFixed(1)}px, 0)`;
      g.style.width = g.style.height = `${(R * 2.9).toFixed(1)}px`;
      g.style.opacity = op.toFixed(3);
    }
    // read phase (sizes) before writing transforms
    const sizes = OVERLAYS.map((o) => {
      const inner = ovRefs.current[o.id]?.firstElementChild as HTMLElement | null | undefined;
      return inner ? [inner.offsetWidth, inner.offsetHeight] : [0, 0];
    });
    OVERLAYS.forEach((o, i) => {
      const node = ovRefs.current[o.id];
      if (!node) return;
      const p = m.project(o.at);
      const c2 = compactNow && 'cdx' in o;
      let x = p.x + (c2 ? (o as { cdx: number }).cdx : o.dx * k);
      let y = p.y + (c2 ? (o as { cdy: number }).cdy : o.dy * k);
      const sc = !compactNow && o.kind !== 'city' ? k : 1;
      const [bw, bh] = [sizes[i][0] * sc, sizes[i][1] * sc];
      if (o.kind !== 'city' && bw > 0) {
        const left = x - bw / 2;
        const top = y - bh / 2;
        const cl = clamp(left, margin, Math.max(margin, w - margin - bw));
        const ct = clamp(top, margin + (compactNow ? 36 : 0), Math.max(margin, h - bottomSafe - bh));
        x += cl - left;
        y += ct - top;
      }
      // hide items on the far side of the globe or far outside the frame
      const cosd = Math.sin(c.lat * r) * Math.sin(o.at[1] * r) + Math.cos(c.lat * r) * Math.cos(o.at[1] * r) * Math.cos((o.at[0] - c.lng) * r);
      const visible = cosd > 0.25 && x > -60 && x < w + 60 && y > -60 && y < h + 60;
      node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      node.style.opacity = visible ? '1' : '0';
    });
  }, []);

  /* ------------------------------------------------ map lifecycle */
  useEffect(() => {
    const host = mapEl.current;
    const outer = box.current;
    if (!host || !outer) return;
    try {
      const c = document.createElement('canvas');
      if (!(c.getContext('webgl2') || c.getContext('webgl'))) {
        fallbackRef.current('WebGL unavailable');
        return;
      }
    } catch {
      fallbackRef.current('WebGL unavailable');
      return;
    }
    lay.current = layout(outer.clientWidth, outer.clientHeight);
    setCompact(lay.current.compact);
    setRoomy(lay.current.roomy);
    setCardScale(lay.current.k);
    let played = false;
    try {
      played = sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    const startAtEnd = played || !!reduce;
    tRef.current = startAtEnd ? T_IDLE + 0.2 : 0;
    if (startAtEnd) setInstant(true);
    const cam = camera(tRef.current);
    let m: MLMap;
    try {
      m = new maplibregl.Map({
        container: host,
        style: styleUrl,
        interactive: false,
        attributionControl: { compact: true, customAttribution: ['© OpenStreetMap contributors · OpenFreeMap', NASA_ATTR] },
        center: cam.center,
        zoom: cam.zoom,
        pitch: cam.pitch,
        bearing: cam.bearing,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        maxPitch: 60,
      });
    } catch (e) {
      fallbackRef.current(`map failed: ${(e as Error).message}`);
      return;
    }
    mapRef.current = m;
    if (import.meta.env.DEV) (window as unknown as { __introMap?: MLMap }).__introMap = m;
    m.setPadding(lay.current.padding);
    let loaded = false;
    const timeout = window.setTimeout(() => {
      if (!loaded) fallbackRef.current('map style/tiles did not load in time');
    }, 4500);
    m.on('error', (ev) => {
      if (!loaded) fallbackRef.current(`map error: ${(ev as { error?: Error }).error?.message ?? 'unknown'}`);
    });
    m.on('style.load', () => {
      try {
        m.setProjection({ type: 'globe' });
        m.setSky({
          'sky-color': '#0B1530',
          'horizon-color': '#2B5BBF',
          'fog-color': '#0B1530',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.7,
          'fog-ground-blend': 0.9,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.9, 8, 0],
        });
        for (const l of m.getStyle().layers ?? []) {
          if (l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none');
          else if (l.id.startsWith('boundary_state')) {
            m.setPaintProperty(l.id, 'line-color', '#8A96B4');
            m.setPaintProperty(l.id, 'line-opacity', 0);
          } else if (l.type === 'fill' && l.id !== 'water') m.setLayoutProperty(l.id, 'visibility', 'none');
        }
      } catch {
        /* cosmetic only */
      }
    });
    m.on('load', () => {
      loaded = true;
      window.clearTimeout(timeout);
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      for (const id of ['arcs', 'trails', 'heads', 'gpts', 'cpts', 'glitter']) m.addSource(id, { type: 'geojson', data: empty });
      // NASA imagery (public domain, CORS-enabled): added after the vector style so a slow GIBS can never block the hero
      m.addSource('bm-day', { type: 'raster', tileSize: 256, maxzoom: 8, attribution: NASA_ATTR, tiles: [`${GIBS}/BlueMarble_NextGeneration/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg`] });
      m.addSource('bm-night', { type: 'raster', tileSize: 256, maxzoom: 8, tiles: [`${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`] });
      const t0 = tRef.current;
      m.addLayer({ id: 'bm-day', type: 'raster', source: 'bm-day', paint: { 'raster-opacity': dayOpacity(t0), 'raster-fade-duration': 0, 'raster-saturation': 0.3, 'raster-contrast': 0.06, 'raster-brightness-min': 0.07 } });
      m.addLayer({ id: 'bm-night', type: 'raster', source: 'bm-night', paint: { 'raster-opacity': nightOpacity(t0), 'raster-fade-duration': 0, 'raster-brightness-max': 1, 'raster-contrast': 0.15 } });
      m.addLayer({ id: 'glitter-halo', type: 'circle', source: 'glitter', paint: { 'circle-radius': ['get', 'h'], 'circle-color': '#FFD98A', 'circle-opacity': ['*', ['get', 'o'], 0.35], 'circle-blur': 1, 'circle-pitch-alignment': 'map' } });
      m.addLayer({ id: 'glitter', type: 'circle', source: 'glitter', paint: { 'circle-radius': ['get', 'r'], 'circle-color': '#FFF8E6', 'circle-opacity': ['get', 'o'], 'circle-blur': 0.35, 'circle-pitch-alignment': 'map' } });
      const col: maplibregl.ExpressionSpecification = ['match', ['get', 'grp'], 'global', '#FF9A6C', 'converge', '#FF6A2F', '#6EA8FF'];
      m.addLayer({ id: 'arcs-glow', type: 'line', source: 'arcs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 8, 'line-blur': 7, 'line-opacity': ['*', ['get', 'o'], 0.55] } });
      m.addLayer({ id: 'arcs', type: 'line', source: 'arcs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 2.2, 'line-opacity': ['get', 'o'] } });
      m.addLayer({ id: 'trails', type: 'line', source: 'trails', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#FFF6F0', 'line-width': 3.4, 'line-blur': 0.6, 'line-opacity': ['get', 'o'] } });
      m.addLayer({ id: 'heads', type: 'circle', source: 'heads', paint: { 'circle-radius': 4.2, 'circle-color': '#FFFFFF', 'circle-blur': 0.2, 'circle-opacity': ['get', 'o'], 'circle-pitch-alignment': 'map' } });
      m.addLayer({ id: 'gpts-halo', type: 'circle', source: 'gpts', paint: { 'circle-radius': ['get', 'r'], 'circle-color': '#FF7A45', 'circle-opacity': ['get', 'o'], 'circle-blur': 0.4, 'circle-pitch-alignment': 'map' } });
      m.addLayer({ id: 'gpts', type: 'circle', source: 'gpts', paint: { 'circle-radius': ['get', 'core'], 'circle-color': '#FFE2D3', 'circle-stroke-color': '#FF7A45', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } });
      m.addLayer({ id: 'cpts-halo', type: 'circle', source: 'cpts', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'o'], 'circle-blur': 0.35, 'circle-pitch-alignment': 'map' } });
      m.addLayer({ id: 'cpts', type: 'circle', source: 'cpts', paint: { 'circle-radius': ['get', 'core'], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.2, 'circle-pitch-alignment': 'map' } });
      tint(m, tRef.current >= T_INDIA ? 1 : 0);
      // a non-interactive map never collapses the compact attribution by itself
      m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      const go = () => {
        setReady(true);
        if (!startAtEnd) {
          try {
            sessionStorage.setItem(SESSION_KEY, '1');
          } catch {
            /* ignore */
          }
        }
      };
      if (startAtEnd) {
        go();
        return;
      }
      // hold the opening until the NASA tiles for the first view are in (max 3 s), so the Earth never appears as a dark blob
      const started = performance.now();
      const wait = () => {
        if (!mapRef.current) return;
        let ok = false;
        try {
          ok = m.isSourceLoaded('bm-day') && m.isSourceLoaded('bm-night');
        } catch {
          ok = false;
        }
        if (ok) go();
        else if (performance.now() - started > 3000) {
          rasterOk.current = false; // GIBS slow or blocked: skip straight to the styled globe
          m.setPaintProperty('bm-day', 'raster-opacity', 0);
          m.setPaintProperty('bm-night', 'raster-opacity', 0);
          tint(m, 0);
          go();
        } else requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });
    const ro = new ResizeObserver(() => {
      if (!box.current) return;
      lay.current = layout(box.current.clientWidth, box.current.clientHeight);
      setCompact(lay.current.compact);
      setRoomy(lay.current.roomy);
      setCardScale(lay.current.k);
      m.resize();
      m.setPadding(lay.current.padding);
      m.jumpTo(camera(tRef.current));
      place();
    });
    ro.observe(outer);
    return () => {
      window.clearTimeout(timeout);
      ro.disconnect();
      m.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  /* ------------------------------------------------ basemap tint */
  const tint = (m: MLMap, k: number) => {
    try {
      const style = m.getStyle();
      for (const l of style.layers ?? []) {
        if (l.id === 'background') m.setPaintProperty('background', 'background-color', mix(TINT.land[0], TINT.land[1], k));
        else if (l.id === 'water') m.setPaintProperty('water', 'fill-color', mix(TINT.water[0], TINT.water[1], k));
        else if (l.id.startsWith('boundary_country')) {
          m.setPaintProperty(l.id, 'line-color', mix(TINT.border[0], TINT.border[1], k));
          m.setPaintProperty(l.id, 'line-width', 0.9 + 0.7 * k);
        } else if (l.id.startsWith('boundary_state')) m.setPaintProperty(l.id, 'line-opacity', 0.65 * k);
      }
    } catch {
      /* cosmetic only */
    }
  };

  /* ------------------------------------------------ the clock */
  useEffect(() => {
    if (!ready) return;
    const m = mapRef.current!;
    let raf = 0;
    let last = performance.now();
    let lastTint = -1;
    let lastDay = -1;
    let lastNight = -1;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.25); // rAF stops while the tab is hidden; the cap turns that gap into a pause
      last = now;
      if (!document.hidden) {
        const idleFrozen = reduce && tRef.current >= T_IDLE;
        if (!idleFrozen) tRef.current += dt;
        const t = tRef.current;
        const ph: Phase = t < T_NIGHT ? 'globe' : t < T_FLY ? 'night' : t < T_INDIA ? 'fly' : t < T_IDLE ? 'india' : 'idle';
        if (ph !== phaseRef.current) {
          phaseRef.current = ph;
          setPhase(ph);
        }
        m.jumpTo(camera(t));
        const tk = Math.round(clamp((t - (T_FLY + 1.0)) / 2.2) * 40) / 40;
        if (tk !== lastTint) {
          lastTint = tk;
          tint(m, tk);
        }
        const dq = rasterOk.current ? Math.round(dayOpacity(t) * 50) / 50 : 0;
        const nq = rasterOk.current ? Math.round(nightOpacity(t) * 50) / 50 : 0;
        if (dq !== lastDay) {
          lastDay = dq;
          if (m.getLayer('bm-day')) m.setPaintProperty('bm-day', 'raster-opacity', dq);
        }
        if (nq !== lastNight) {
          lastNight = nq;
          if (m.getLayer('bm-night')) m.setPaintProperty('bm-night', 'raster-opacity', nq);
        }
        const d = frameData(t);
        (m.getSource('arcs') as GeoJSONSource).setData({ type: 'FeatureCollection', features: d.arcs });
        (m.getSource('trails') as GeoJSONSource).setData({ type: 'FeatureCollection', features: d.trails });
        (m.getSource('heads') as GeoJSONSource).setData({ type: 'FeatureCollection', features: d.heads });
        (m.getSource('gpts') as GeoJSONSource).setData({ type: 'FeatureCollection', features: d.gpts });
        (m.getSource('cpts') as GeoJSONSource).setData({ type: 'FeatureCollection', features: d.cpts });
        (m.getSource('glitter') as GeoJSONSource).setData({ type: 'FeatureCollection', features: d.glitter });
        place();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, camera, frameData, place, reduce]);

  useEffect(() => {
    place();
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __introSeek?: (t: number) => void }).__introSeek = (t: number) => {
      tRef.current = t;
    };
  }, []);

  const skip = () => {
    setInstant(true);
    tRef.current = T_IDLE + 0.2;
  };
  const replay = () => {
    setInstant(false);
    tRef.current = 0;
    phaseRef.current = 'globe';
    setPhase('globe');
  };

  const shown = useMemo(
    () =>
      OVERLAYS.filter((o: OverlaySpec & { roomyOnly?: boolean }) => (!compact || o.compact) && (roomy || !o.roomyOnly) && (o.phase === 'globe' ? phase === 'night' : phase === 'india' || phase === 'idle')),
    [compact, roomy, phase],
  );
  const caption =
    phase === 'globe' || phase === 'night'
      ? { k: 'g', title: 'Every market has a taste.', sub: 'Start global.' }
      : phase === 'fly'
        ? { k: 'f', title: 'Then zoom in where it matters.', sub: 'Hard constraints first.' }
        : { k: 'i', title: 'Locations, people, ads —', sub: 'with evidence.' };

  return (
    <div ref={box} className="absolute inset-0">
      {/* placeholder sphere while tiles load — never a blank hero */}
      <AnimatePresence>
        {!ready && (
          <motion.div
            key="ph"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.8 } }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center lg:pl-[40%]"
          >
            <div className="aspect-square w-[62%] max-w-[520px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#2B5BBF_0%,#11224A_45%,#070C1C_75%)] shadow-[0_0_120px_20px_rgba(43,91,191,0.35)] lg:w-[48%]" />
          </motion.div>
        )}
      </AnimatePresence>
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-full will-change-transform"
        style={{ opacity: 0, background: 'radial-gradient(circle, rgba(70,140,255,0) 32.5%, rgba(120,180,255,0.75) 34.6%, rgba(70,135,255,0.38) 38%, rgba(50,105,235,0.16) 46%, rgba(40,90,220,0) 62%)' }}
      />
      <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 1 }}>
        {/* maplibre forces position:relative on its container, so it needs an explicitly sized child */}
        <div ref={mapEl} className="h-full w-full" aria-label="Animated globe flying into India with candidate launch cities, people and generated ads" role="img" />
      </motion.div>
      {/* overlays */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={!ready}>
        <AnimatePresence>
          {ready &&
            shown.map((o) => (
              <motion.div key={o.id} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
                <OverlayShell ref={(el) => (ovRefs.current[o.id] = el)} align={alignOf(o, compact)} scale={!compact && o.kind !== 'city' ? cardScale : 1} className={o.kind === 'city' ? 'z-20 transition-opacity duration-300' : 'z-10 transition-opacity duration-300'} style={{ opacity: 0 }}>
                  <OverlayBody o={o} instant={instant} compact={compact} />
                </OverlayShell>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
      {/* caption (cross-fade; robust to rapid phase changes) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 h-[64px] px-4 lg:bottom-9 lg:left-[40%]">
        <AnimatePresence initial={false}>
          {ready && (
            <motion.div
              key={caption.k}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.45, delay: 0.28 } }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.22 } }}
              className="absolute inset-x-0 bottom-0 flex justify-center"
              aria-live="polite"
            >
              <div className="rounded-2xl border border-white/10 bg-[#070B16]/70 px-4 py-2 text-center backdrop-blur-md">
                <p className="font-display text-[15px] font-bold text-white sm:text-lg">
                  {caption.title} <span className="bg-gradient-to-r from-[#FF8A5B] via-[#FF6F91] to-[#7FB2FF] bg-clip-text text-transparent">{caption.sub}</span>
                </p>
                <p className="text-[10.5px] text-white/45">Illustrative intro · people are AI-generated illustrations · ads are real outputs from the sample project</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* controls */}
      {ready && (
        <div className="absolute right-3 top-3 z-10 flex gap-2 sm:right-5 sm:top-5 lg:top-20">
          {phase !== 'idle' ? (
            <button
              type="button"
              onClick={skip}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
            >
              Skip intro <SkipForward className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={replay}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Replay
            </button>
          )}
        </div>
      )}
    </div>
  );
}
