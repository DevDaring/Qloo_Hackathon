import { useId } from 'react';
import { cn } from '../lib/format';

export function LogoMark({ className }: { className?: string }) {
  const gid = `ll-g-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 40 40" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7A45" />
          <stop offset="1" stopColor="#1F6FEB" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="#0E1320" />
      <circle cx="18.5" cy="18.5" r="8.5" fill="none" stroke={`url(#${gid})`} strokeWidth="3.6" />
      <path d="M25 25l6.5 6.5" stroke={`url(#${gid})`} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="18.5" cy="18.5" r="2.6" fill="#FF7A45" />
    </svg>
  );
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('font-display text-[17px] font-bold tracking-tight', inverted ? 'text-white' : 'text-fg')}>
        Launch<span className="text-gradient">Lens</span>
      </span>
    </span>
  );
}
