/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        surface2: v('surface-2'),
        line: v('border'),
        fg: v('text'),
        muted: v('muted'),
        subtle: v('subtle'),
        brand: { DEFAULT: v('primary'), ink: v('primary-ink'), soft: v('primary-soft') },
        accent: { DEFAULT: v('secondary'), ink: v('secondary-ink'), soft: v('secondary-soft') },
        ink: v('ink'),
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        bad: { DEFAULT: v('bad'), soft: v('bad-soft') },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { xl: '14px', '2xl': '18px', '3xl': '24px' },
      boxShadow: {
        card: '0 1px 2px rgb(14 19 32 / 0.04), 0 4px 16px -4px rgb(14 19 32 / 0.06)',
        lift: '0 2px 4px rgb(14 19 32 / 0.04), 0 18px 40px -12px rgb(14 19 32 / 0.18)',
        glow: '0 0 0 1px rgb(255 122 69 / 0.25), 0 10px 40px -10px rgb(255 122 69 / 0.55)',
        ring: '0 0 0 3px rgb(31 111 235 / 0.35)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        mesh: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(6%, -4%) scale(1.08)' },
          '66%': { transform: 'translate(-5%, 5%) scale(0.95)' },
        },
        pulsering: { '0%': { transform: 'scale(.6)', opacity: '0.8' }, '100%': { transform: 'scale(2.6)', opacity: '0' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        twinkle: { '0%,100%': { opacity: '0.15' }, '50%': { opacity: '0.9' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        mesh: 'mesh 18s ease-in-out infinite',
        pulsering: 'pulsering 2.4s cubic-bezier(.2,.6,.3,1) infinite',
        floaty: 'floaty 6s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
