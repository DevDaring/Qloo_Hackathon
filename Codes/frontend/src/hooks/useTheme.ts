import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function read(): Theme {
  try {
    return localStorage.getItem('ll-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('ll-theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
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
