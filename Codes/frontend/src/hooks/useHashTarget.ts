import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Deep links such as `/projects/{id}/audiences#entity-…` or `brief#constraints`
 * (journey blockers) scroll to and focus their target. Targets often render
 * after data loads, so the element is polled for a few seconds.
 */
export function useHashTarget(onSpecial?: (hash: string) => boolean) {
  const loc = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(loc.hash.replace(/^#/, ''));
    if (!id) return;
    if (onSpecial?.(id)) return;
    let tries = 0;
    let timer = 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const attempt = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        const focusable = el.matches('a,button,input,select,textarea,[tabindex]') ? el : null;
        if (!focusable) el.setAttribute('tabindex', '-1');
        (focusable ?? el).focus({ preventScroll: true });
        el.classList.add('hash-target');
        window.setTimeout(() => el.classList.remove('hash-target'), 2400);
        return;
      }
      if (++tries < 30) timer = window.setTimeout(attempt, 150);
    };
    timer = window.setTimeout(attempt, 80);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, loc.hash]);
}
