import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { cn } from '../lib/format';

/** Light / dark switch. A real two-state control (aria-pressed) with a visible label for screen readers. */
export function ThemeToggle({ className, onDark }: { className?: string; onDark?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? 'Dark theme on — switch to light' : 'Light theme on — switch to dark'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'inline-flex h-9 w-[62px] shrink-0 items-center rounded-full border p-1 transition-colors duration-300',
        onDark || dark ? 'border-white/15 bg-white/10' : 'border-line bg-surface2',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full shadow transition-transform duration-300 ease-out motion-reduce:transition-none',
          dark ? 'translate-x-[25px] bg-[#0B1A3A] text-[#8FB8FF]' : 'translate-x-0 bg-white text-[#FF7A45]',
        )}
      >
        {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </span>
    </button>
  );
}
