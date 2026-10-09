import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Stylised, simplified outline of India (lon, lat), for decoration only. */
const OUTLINE: [number, number][] = [
  [77.8, 35.5], [79.1, 34.4], [78.8, 32.7], [79.4, 31.1], [80.3, 30.4], [81.0, 30.1], [80.1, 28.8], [81.5, 27.9], [83.3, 27.4],
  [84.6, 27.2], [85.9, 26.7], [87.3, 26.4], [88.1, 26.6], [88.2, 27.6], [88.8, 28.0], [88.9, 27.3], [89.7, 26.8], [91.5, 26.8],
  [92.1, 26.9], [91.8, 27.7], [93.5, 28.6], [95.4, 29.3], [96.6, 28.9], [97.3, 28.2], [96.2, 27.3], [95.2, 26.6], [94.6, 25.3],
  [94.2, 23.9], [93.4, 23.0], [93.2, 22.2], [92.6, 21.9], [92.3, 23.6], [91.9, 24.2], [91.2, 23.6], [91.6, 24.9], [90.2, 25.2],
  [89.8, 25.9], [88.5, 26.4], [88.1, 25.6], [88.7, 24.3], [88.9, 22.9], [89.0, 21.7], [87.9, 21.7], [86.9, 21.2], [86.4, 20.0],
  [85.1, 19.4], [84.2, 18.4], [83.3, 17.6], [82.3, 16.6], [81.3, 15.9], [80.3, 15.5], [80.1, 13.6], [80.3, 13.1], [79.9, 11.5],
  [79.8, 10.3], [79.0, 9.3], [78.2, 8.9], [77.5, 8.1], [76.6, 8.9], [76.2, 10.0], [75.7, 11.5], [74.9, 12.9], [74.5, 14.5],
  [73.8, 15.6], [73.3, 17.0], [72.9, 18.9], [72.8, 20.4], [72.6, 21.4], [72.5, 22.2], [72.2, 21.7], [71.0, 20.8], [70.0, 21.1],
  [69.0, 22.3], [68.6, 23.2], [68.4, 23.6], [69.7, 24.2], [71.0, 24.4], [70.6, 25.7], [70.0, 26.6], [70.5, 27.8], [71.9, 28.0],
  [73.4, 29.9], [74.0, 30.4], [74.6, 31.1], [74.9, 31.7], [75.3, 32.3], [74.6, 32.8], [74.1, 33.4], [73.9, 34.4], [74.4, 35.0],
  [75.6, 35.9], [77.0, 35.7],
];

const S = 20;
export const project = (lon: number, lat: number): [number, number] => [(lon - 67.6) * 0.93 * S, (37.2 - lat) * S];
const PATH = OUTLINE.map(([lon, lat], i) => {
  const [x, y] = project(lon, lat);
  return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ') + ' Z';

export const CITIES = [
  { name: 'New Delhi', lon: 77.21, lat: 28.61, state: 'eligible' as const },
  { name: 'Kolkata', lon: 88.36, lat: 22.57, state: 'eligible' as const },
  { name: 'Mumbai', lon: 72.88, lat: 19.08, state: 'candidate' as const },
  { name: 'Bengaluru', lon: 77.59, lat: 12.97, state: 'candidate' as const },
  { name: 'Chennai', lon: 80.27, lat: 13.08, state: 'excluded' as const },
];

const ARCS: [number, number][] = [
  [0, 1],
  [0, 2],
  [2, 3],
  [3, 4],
  [1, 4],
  [0, 3],
];

function arcPath(a: [number, number], b: [number, number]) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  // control point offset perpendicular to the chord
  const cx = mx - (dy / len) * len * 0.22;
  const cy = my + (dx / len) * len * 0.22 - len * 0.05;
  return `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`;
}

export function IndiaMap({ className, dark, showLabels = true }: { className?: string; dark?: boolean; showLabels?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const pts = CITIES.map((c) => project(c.lon, c.lat));
  const [w, h] = [Math.ceil(project(97.6, 0)[0]) + 10, Math.ceil(project(0, 7.6)[1]) + 10];
  const dot = dark ? 'rgba(255,255,255,0.22)' : 'rgba(14,19,32,0.18)';
  return (
    <svg viewBox={`-10 -10 ${w + 10} ${h + 10}`} className={className} role="img" aria-label="Stylised map of India with candidate launch cities: New Delhi, Kolkata, Mumbai, Bengaluru and Chennai">
      <defs>
        <pattern id={`dots-${uid}`} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="1.55" fill={dot} />
        </pattern>
        <linearGradient id={`edge-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7A45" />
          <stop offset="0.5" stopColor="#F0567A" />
          <stop offset="1" stopColor="#1F6FEB" />
        </linearGradient>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0" stopColor="#FF7A45" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF7A45" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`glowb-${uid}`}>
          <stop offset="0" stopColor="#1F6FEB" stopOpacity="0.5" />
          <stop offset="1" stopColor="#1F6FEB" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`clip-${uid}`}>
          <path d={PATH} />
        </clipPath>
        <filter id={`blur-${uid}`}>
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* soft fill + dotted texture */}
      <path d={PATH} fill={dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.55)'} />
      <rect x="-10" y="-10" width={w + 20} height={h + 20} fill={`url(#dots-${uid})`} clipPath={`url(#clip-${uid})`} />
      <motion.path
        d={PATH}
        fill="none"
        stroke={`url(#edge-${uid})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0.2 }}
        animate={{ pathLength: 1, opacity: 0.9 }}
        transition={{ duration: 2.4, ease: 'easeInOut' }}
      />

      {/* service coverage hint circles around Delhi & Kolkata */}
      {[0, 1].map((i) => (
        <motion.circle
          key={`svc-${i}`}
          cx={pts[i][0]}
          cy={pts[i][1]}
          r={34}
          fill="none"
          stroke={dark ? 'rgba(110,168,255,0.55)' : 'rgba(31,111,235,0.45)'}
          strokeDasharray="3 4"
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.2 + i * 0.2, duration: 0.8 }}
          style={{ transformOrigin: `${pts[i][0]}px ${pts[i][1]}px` }}
        />
      ))}

      {/* arcs */}
      {ARCS.map(([a, b], i) => {
        const d = arcPath(pts[a], pts[b]);
        return (
          <g key={`arc-${i}`}>
            <motion.path
              d={d}
              fill="none"
              stroke={`url(#edge-${uid})`}
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity={0.55}
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.8 + i * 0.25, duration: 1.4, ease: 'easeInOut' }}
            />
            {!reduce && (
              <path d={d} fill="none" stroke={dark ? '#fff' : '#FF7A45'} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4 400" opacity={0.9}>
                <animate attributeName="stroke-dashoffset" from="404" to="0" dur={`${3.2 + (i % 3) * 0.7}s`} begin={`${2 + i * 0.4}s`} repeatCount="indefinite" />
              </path>
            )}
          </g>
        );
      })}

      {/* pins */}
      {CITIES.map((c, i) => {
        const [x, y] = pts[i];
        const color = c.state === 'excluded' ? '#E5484D' : c.state === 'eligible' ? '#FF7A45' : '#1F6FEB';
        return (
          <motion.g
            key={c.name}
            initial={reduce ? false : { opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.18, type: 'spring', stiffness: 260, damping: 14 }}
          >
            <circle cx={x} cy={y} r="26" fill={`url(#${c.state === 'candidate' ? 'glowb' : 'glow'}-${uid})`} />
            {!reduce && (
              <circle cx={x} cy={y} r="7" fill="none" stroke={color} strokeWidth="2">
                <animate attributeName="r" values="6;22" dur="2.4s" begin={`${i * 0.45}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0" dur="2.4s" begin={`${i * 0.45}s`} repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={x} cy={y} r="6.5" fill={color} stroke="#fff" strokeWidth="2.5" />
            {c.state === 'excluded' && <path d={`M${x - 3},${y - 3} L${x + 3},${y + 3} M${x + 3},${y - 3} L${x - 3},${y + 3}`} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />}
            {showLabels && (
              <g transform={`translate(${x + (c.name === 'Mumbai' || c.name === 'Bengaluru' ? -12 : 12)}, ${y + 4})`}>
                <text
                  textAnchor={c.name === 'Mumbai' || c.name === 'Bengaluru' ? 'end' : 'start'}
                  fontSize="15"
                  fontWeight="700"
                  fontFamily="Plus Jakarta Sans, Inter, sans-serif"
                  fill={dark ? '#fff' : '#0E1320'}
                  stroke={dark ? '#0E1320' : '#fff'}
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  {c.name}
                </text>
              </g>
            )}
          </motion.g>
        );
      })}
    </svg>
  );
}
