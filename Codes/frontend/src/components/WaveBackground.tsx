/**
 * Dark-theme backdrop: a deep blue → black gradient that slowly drifts, with soft
 * blue light waves travelling across it. Pure CSS (GPU transforms only), fixed
 * behind every page, hidden in the light theme and still under reduced motion.
 */
const WAVE =
  'M0 120 C 180 60 360 60 540 120 S 900 180 1080 120 S 1440 60 1620 120 S 1980 180 2160 120 S 2520 60 2700 120 S 3060 180 3240 120 L 3240 240 L 0 240 Z';

export function WaveBackground() {
  return (
    <div aria-hidden className="wave-bg">
      <div className="wave-bg__gradient" />
      <div className="wave-bg__glow" />
      {[1, 2, 3].map((i) => (
        <svg key={i} className={`wave-bg__wave wave-bg__wave--${i}`} viewBox="0 0 3240 240" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`ll-wave-${i}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#1F6FEB" stopOpacity="0" />
              <stop offset="0.25" stopColor="#3B82F6" stopOpacity="0.9" />
              <stop offset="0.5" stopColor="#0B3B8F" stopOpacity="0.6" />
              <stop offset="0.75" stopColor="#3B82F6" stopOpacity="0.9" />
              <stop offset="1" stopColor="#1F6FEB" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={WAVE} fill={`url(#ll-wave-${i})`} />
        </svg>
      ))}
      <div className="wave-bg__vignette" />
    </div>
  );
}
