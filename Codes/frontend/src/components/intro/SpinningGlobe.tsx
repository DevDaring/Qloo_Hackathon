import { useEffect, useRef } from 'react';
import { EARTH_LOWRES } from './earthLowres';

/**
 * The opening globe, animated from the very first frame: an orthographic
 * projection of NASA Blue Marble imagery drawn on a canvas, spinning west → east
 * at the same speed, from the same longitude, at the same size and position as
 * the MapLibre intro's first seconds. It shows while map tiles load; the MapLibre
 * globe then continues from the same moment (see introElapsed), so there is no
 * static frame and no jump. A 6 KB inline texture draws the first frames
 * instantly; the full texture replaces it as soon as it has loaded.
 */
export const INTRO_ROT0 = -88; // keep in sync with GlobeIntro ROT0
export const INTRO_ROT_V = 17; // degrees of longitude per second
const LAT0 = 9; // camera latitude during the first seconds of the intro
const TEXTURE = '/landing/earth-day.jpg';

let clockStart: number | null = null;
/** Seconds since the opening globe first appeared (shared by every mount, so remounts never restart it). */
export function introElapsed(): number {
  return clockStart === null ? 0 : (performance.now() - clockStart) / 1000;
}

const cache: Record<string, Promise<ImageData>> = {};
function loadTexture(src: string): Promise<ImageData> {
  cache[src] ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      resolve(g.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = reject;
    img.src = src;
  });
  return cache[src];
}

/** Same geometry as GlobeIntro's layout(): radius from the container, centred inside the map padding. */
function geometry(w: number, h: number) {
  const compact = w < 768;
  const rho = Math.min(w * (compact ? 0.78 : 0.44), h * 0.7) / 2; // true globe radius at the intro zoom
  // MapLibre's perspective camera sits 1.5 × viewport height from the surface, so the visible disk is
  // smaller than the true radius; 1.033 is calibrated against the rendered globe on desktop and phone.
  const f = 1.5 * h;
  const radius = f * Math.tan(Math.asin(rho / (f + rho))) * 1.033;
  const cx = compact ? w / 2 : 0.4 * w + (0.6 * w - 24) / 2;
  const cy = compact ? 46 + (h - 142) / 2 : 70 + (h - 100) / 2;
  return { radius, cx, cy };
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/**
 * `fill`: a self-contained globe centred in its parent (e.g. the sign-in brand panel), with its own
 * clock, starting over `centerLon`/`centerLat`. Without it, the globe matches the landing intro.
 */
export function SpinningGlobe({ fill = false, centerLon = -98, centerLat = 28, sizeRatio = 0.8 }: { fill?: boolean; centerLon?: number; centerLat?: number; sizeRatio?: number } = {}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ownStart = performance.now();
    const remount = fill ? false : clockStart !== null; // already on screen (placeholder → intro): no second fade-in
    if (!fill) clockStart ??= performance.now();
    const elapsed = () => (fill ? (performance.now() - ownStart) / 1000 : introElapsed());
    const LAT = fill ? centerLat : LAT0;
    const ROT0 = fill ? centerLon : INTRO_ROT0;
    const SPEED = fill ? 6 : INTRO_ROT_V;
    const host = wrap.current!.parentElement!;
    if (remount) {
      wrap.current!.style.transition = 'none';
      wrap.current!.style.opacity = '1';
    }
    const cv = canvas.current!;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let alive = true;
    let tex: ImageData | null = null;
    let geo = { radius: 150, cx: 0, cy: 0 };
    let N = 0;
    let idx: Int32Array = new Int32Array(0);
    let vfrac: Float32Array = new Float32Array(0);
    let ufrac: Float32Array = new Float32Array(0);
    let rowOff: Int32Array = new Int32Array(0); // texture row offsets for the current texture
    let ucol: Float32Array = new Float32Array(0); // longitude offsets in texture pixels
    let bound: ImageData | null = null; // texture the two arrays above were built for
    let tex32: Uint32Array = new Uint32Array(0);
    let out: ImageData | null = null;
    let out32: Uint32Array = new Uint32Array(0);
    let lastDraw = 0;
    const g = cv.getContext('2d')!;
    const shadeLayer = document.createElement('canvas'); // limb darkening + rim light, composited on the GPU

    const place = () => {
      if (!alive || !wrap.current) return;
      const r = host.getBoundingClientRect();
      geo = fill ? { radius: (Math.min(r.width, r.height) * sizeRatio) / 2, cx: r.width / 2, cy: r.height / 2 } : geometry(r.width, r.height);
      const size = geo.radius * 2;
      Object.assign(wrap.current!.style, { width: `${size}px`, height: `${size}px`, left: `${geo.cx - geo.radius}px`, top: `${geo.cy - geo.radius}px` });
      // modest internal resolution: the canvas globe is only on screen for about a second
      const n = Math.round(Math.min(fill ? 560 : 400, size * Math.min(window.devicePixelRatio || 1, 1.25)));
      if (n === N) return;
      N = n;
      cv.width = cv.height = N;
      out = g.createImageData(N, N);
      out32 = new Uint32Array(out.data.buffer);
      bound = null;
      // per-pixel inverse orthographic projection, computed once per size (texture-independent fractions)
      const R = N / 2;
      const list: number[] = [];
      const v = new Float32Array(N * N);
      const u = new Float32Array(N * N);
      const s0 = Math.sin((LAT * Math.PI) / 180);
      const c0 = Math.cos((LAT * Math.PI) / 180);
      for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
          const x = (px + 0.5 - R) / R;
          const y = (R - py - 0.5) / R;
          const rho = Math.hypot(x, y);
          if (rho >= 1) continue;
          const c = Math.asin(rho);
          const sc = Math.sin(c);
          const cc = Math.cos(c);
          const lat = rho === 0 ? LAT : (Math.asin(cc * s0 + (y * sc * c0) / rho) * 180) / Math.PI;
          const lon = (Math.atan2(x * sc, rho * cc * c0 - y * sc * s0) * 180) / Math.PI;
          const i = py * N + px;
          list.push(i);
          v[i] = Math.min(0.9999, Math.max(0, (90 - lat) / 180));
          u[i] = lon / 360;
        }
      }
      idx = Int32Array.from(list);
      vfrac = v;
      ufrac = u;
      shadeLayer.width = shadeLayer.height = N;
      const sg = shadeLayer.getContext('2d')!;
      const grad = sg.createRadialGradient(R * 0.82, R * 0.78, R * 0.1, R, R, R);
      grad.addColorStop(0, 'rgba(255,255,255,0.05)');
      grad.addColorStop(0.55, 'rgba(0,4,16,0)');
      grad.addColorStop(0.86, 'rgba(0,6,24,0.38)');
      grad.addColorStop(0.97, 'rgba(10,30,80,0.55)');
      grad.addColorStop(1, 'rgba(90,150,255,0.55)');
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(R, R, R, 0, Math.PI * 2);
      sg.fill();
    };

    const bind = (t: ImageData) => {
      const tw = t.width;
      const th = t.height;
      rowOff = new Int32Array(N * N);
      ucol = new Float32Array(N * N);
      for (let n = 0; n < idx.length; n++) {
        const i = idx[n];
        rowOff[i] = ((vfrac[i] * th) | 0) * tw;
        ucol[i] = ufrac[i] * tw;
      }
      tex32 = new Uint32Array(t.data.buffer);
      bound = t;
    };

    const draw = (now = performance.now()) => {
      if (!alive || !wrap.current) return;
      if (tex && out && now - lastDraw >= (fill ? 40 : 24) && !(fill && document.hidden)) {
        lastDraw = now;
        if (bound !== tex) bind(tex);
        const t = reduce ? 0 : elapsed();
        const tw = tex.width;
        const off = ((((ROT0 + SPEED * t + 180) / 360) % 1) + 1) % 1 * tw;
        for (let n = 0; n < idx.length; n++) {
          const i = idx[n];
          let u = ucol[i] + off;
          if (u >= tw) u -= tw;
          else if (u < 0) u += tw;
          out32[i] = tex32[rowOff[i] + (u | 0)];
        }
        g.putImageData(out, 0, 0);
        g.drawImage(shadeLayer, 0, 0);
        // the same gentle scale-in as the MapLibre camera (zoom − 0.55·(1 − ease))
        wrap.current!.style.transform = fill ? 'none' : `scale(${Math.pow(2, -0.55 * (1 - easeOutCubic(t / 2.4)))})`;
        wrap.current!.style.opacity = '1';
        if (reduce) return;
      }
      raf = requestAnimationFrame(draw);
    };

    place();
    const ro = new ResizeObserver(place);
    ro.observe(host);
    loadTexture(EARTH_LOWRES).then((t) => {
      tex ??= t;
    });
    loadTexture(TEXTURE)
      .then((t) => {
        tex = t;
        if (reduce) draw(performance.now() + 1000);
      })
      .catch(() => {
        /* full texture unavailable: keep the low-resolution one */
      });
    draw();
    return () => {
      alive = false;
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={wrap} aria-hidden className="pointer-events-none absolute opacity-0 transition-opacity duration-300 will-change-transform">
      <div className="absolute inset-[-8%] rounded-full bg-[radial-gradient(circle,rgba(70,140,255,0)_60%,rgba(110,170,255,0.22)_62.5%,rgba(60,120,255,0.08)_70%,rgba(40,90,220,0)_80%)]" />
      <canvas ref={canvas} className="relative h-full w-full rounded-full" />
    </div>
  );
}
