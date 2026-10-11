import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

/**
 * Keeps long-open tabs on the current release. The app shell (index.html) is never
 * cached, so comparing its main bundle name with the one this tab runs reveals a new
 * deploy. When one is found the next in-app navigation loads it automatically (so
 * nobody is stuck on old code), a hidden tab reloads when it is shown again, and a
 * slim bar offers an immediate reload.
 */
const BUNDLE = /\/assets\/index-[\w-]+\.js/;

function currentBundle(): string | null {
  const s = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')).find((x) => BUNDLE.test(x.src));
  return s ? (s.src.match(BUNDLE)?.[0] ?? null) : null;
}

export function UpdateWatcher() {
  const [stale, setStale] = useState(false);
  const loc = useLocation();
  // the page the user was on when the new release was found: reload only once they move on
  const staleAt = useRef<string | null>(null);
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // dev server: nothing to compare
    let alive = true;
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store', credentials: 'same-origin' })).text();
        const latest = html.match(BUNDLE)?.[0];
        if (alive && latest && latest !== mine) {
          staleAt.current ??= window.location.pathname;
          setStale(true);
        }
      } catch {
        /* offline: try again later */
      }
    };
    const t = window.setInterval(check, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    void check();
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, []);
  // a new release is picked up on the next page change: a full load of the page the user asked for
  useEffect(() => {
    if (stale && staleAt.current !== null && loc.pathname !== staleAt.current) window.location.reload();
  }, [loc.pathname, stale]);
  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[300] flex items-center justify-center gap-3 bg-gradient-to-r from-[#1F6FEB] to-[#FF7A45] px-4 py-2 text-[13px] font-medium text-white shadow-lift" data-testid="update-bar">
      <RefreshCw className="h-4 w-4" aria-hidden />
      LaunchLens has been updated.
      <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30">
        Reload now
      </button>
    </div>
  );
}
