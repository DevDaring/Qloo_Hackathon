import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

/* One shared theme for the whole app: every toggle (landing, login, sidebar) stays in sync.
   Default follows the system setting until the user picks one; the choice is remembered. */
function stored(): Theme | null {
  try {
    const t = localStorage.getItem('ll-theme');
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}
function system(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
let current: Theme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : stored() ?? system();
const listeners = new Set<() => void>();
function apply(t: Theme) {
  current = t;
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#03060F' : '#F7F8FB');
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined') {
  apply(current);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (!stored()) apply(e.matches ? 'dark' : 'light');
  });
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem('ll-theme', t);
  } catch {
    /* storage unavailable: still switch for this visit */
  }
  apply(t);
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
  const toggle = useCallback(() => setTheme(current === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle, setTheme };
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** true only on the first visit of this key in the browser session (for one-time entrance reveals). */
export function useFirstVisit(key: string): boolean {
  const [first] = useState(() => {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch {
      return false;
    }
  });
  return first;
}
