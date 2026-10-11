import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

let cancelPending: (() => void) | null = null;

/**
 * Scroll an element (by id) into view, focus it and pulse a strong highlight ring
 * for about 3 seconds. The element often renders after data loads, so it is polled
 * for a few seconds. Used by deep links (`#anchor`) and the chat's "Show me".
 */
export function highlightTarget(id: string, opts: { focus?: boolean } = {}) {
  cancelPending?.();
  let tries = 0;
  let timer = 0;
  let cancelled = false;
  cancelPending = () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const attempt = () => {
    if (cancelled) return;
    const el = document.getElementById(id);
    const r = el?.getBoundingClientRect();
    if (el && r && (r.width > 0 || r.height > 0)) {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      if (opts.focus !== false) {
        const focusable = el.matches('a,button,input,select,textarea,[tabindex]') ? el : null;
        if (!focusable) el.setAttribute('tabindex', '-1');
        (focusable ?? el).focus({ preventScroll: true });
      }
      el.classList.remove('hash-target');
      void el.offsetWidth; // restart the animation when the same target is shown twice
      el.classList.add('hash-target');
      window.setTimeout(() => el.classList.remove('hash-target'), 3200);
      return;
    }
    if (++tries < 40) timer = window.setTimeout(attempt, 150);
  };
  timer = window.setTimeout(attempt, 80);
}

/**
 * Deep links such as `/projects/{id}/audiences#entity-…` or `studio?tab=video#generate-video`
 * scroll to, focus and highlight their target.
 */
export function useHashTarget(onSpecial?: (hash: string) => boolean) {
  const loc = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(loc.hash.replace(/^#/, ''));
    if (!id) return;
    if (onSpecial?.(id)) return;
    highlightTarget(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, loc.search, loc.hash, loc.key]);
}
