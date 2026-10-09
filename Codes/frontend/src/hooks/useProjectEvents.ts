import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API, get } from '../api/client';
import type { RunEvent } from '../api/types';

export type StreamState = 'connecting' | 'live' | 'polling' | 'offline';

const KEEP = 250;

/** Persisted project event stream: loads recent history, then follows the SSE
 * stream (EventSource resends Last-Event-ID on reconnect). If SSE keeps failing,
 * falls back to polling /projects/{id}/events?after=<last_id> every 3 s.
 * Relevant react-query caches are invalidated as events arrive. */
export function useProjectEvents(pid?: string) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [state, setState] = useState<StreamState>('connecting');
  const lastId = useRef(0);
  const pending = useRef<Set<string>>(new Set());
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: number | null = null;
    let failures = 0;
    lastId.current = 0;
    setEvents([]);
    setState('connecting');

    const scheduleInvalidate = (evs: RunEvent[]) => {
      for (const e of evs) {
        const t = e.type;
        pending.current.add('project');
        if (t.startsWith('run.')) {
          pending.current.add('run');
          if (t === 'run.strategy' || t === 'run.finished') pending.current.add('strategies');
          if (t === 'run.finished' || t === 'run.waiting') pending.current.add('creative');
        }
        if (t.startsWith('job.')) {
          pending.current.add('jobs');
          if (/completed|failed|partially|cancelled|waiting_for_user/.test(t)) pending.current.add('creative');
          if (e.job_id) qc.invalidateQueries({ queryKey: ['job', e.job_id] });
        }
      }
      if (flushTimer.current) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const p = pending.current;
        pending.current = new Set();
        if (p.has('project')) {
          qc.invalidateQueries({ queryKey: ['project', pid] });
          qc.invalidateQueries({ queryKey: ['projects'] });
        }
        if (p.has('run')) {
          qc.invalidateQueries({ queryKey: ['run'] });
          qc.invalidateQueries({ queryKey: ['runs', pid] });
          qc.invalidateQueries({ queryKey: ['placements', pid] });
        }
        if (p.has('strategies')) qc.invalidateQueries({ queryKey: ['strategies', pid] });
        if (p.has('jobs')) qc.invalidateQueries({ queryKey: ['jobs', pid] });
        if (p.has('creative')) {
          qc.invalidateQueries({ queryKey: ['briefs', pid] });
          qc.invalidateQueries({ queryKey: ['brief'] });
          qc.invalidateQueries({ queryKey: ['assets', pid] });
          qc.invalidateQueries({ queryKey: ['exports', pid] });
          qc.invalidateQueries({ queryKey: ['usage'] });
        }
      }, 700);
    };

    const add = (evs: RunEvent[], live: boolean) => {
      const fresh = evs.filter((e) => e.id > lastId.current);
      if (!fresh.length) return;
      lastId.current = fresh[fresh.length - 1].id;
      setEvents((xs) => [...xs, ...fresh].slice(-KEEP));
      if (live) scheduleInvalidate(fresh);
    };

    const poll = async () => {
      try {
        const r = await get<{ items: RunEvent[]; last_id: number }>(`/projects/${pid}/events`, { after: lastId.current, limit: 200 });
        if (cancelled) return;
        add(r.items, true);
        setState('polling');
      } catch {
        if (!cancelled) setState('offline');
      }
      if (!cancelled) pollTimer = window.setTimeout(poll, 3000);
    };

    const openStream = () => {
      if (cancelled) return;
      if (typeof EventSource === 'undefined') {
        poll();
        return;
      }
      es = new EventSource(`${API}/projects/${pid}/event-stream?after=${lastId.current}`, { withCredentials: true });
      es.onopen = () => {
        failures = 0;
        setState('live');
      };
      es.onmessage = (m) => {
        try {
          add([JSON.parse(m.data) as RunEvent], true);
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        failures += 1;
        if (es && (es.readyState === EventSource.CLOSED || failures >= 3)) {
          es.close();
          es = null;
          setState('polling');
          poll();
        } else {
          setState('connecting');
        }
      };
    };

    (async () => {
      // history: page through the persisted log, keep the most recent events
      try {
        let after = 0;
        const all: RunEvent[] = [];
        for (let i = 0; i < 20; i++) {
          const r = await get<{ items: RunEvent[]; last_id: number }>(`/projects/${pid}/events`, { after, limit: 500 });
          all.push(...r.items);
          if (r.items.length < 500) break;
          after = r.last_id;
        }
        if (cancelled) return;
        add(all.slice(-KEEP), false);
        if (!all.length) lastId.current = 0;
      } catch {
        if (!cancelled) setState('offline');
      }
      openStream();
    })();

    const onOnline = () => {
      if (!es && !pollTimer) openStream();
    };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) window.clearTimeout(pollTimer);
      window.removeEventListener('online', onOnline);
    };
  }, [pid, qc]);

  return { events, state };
}
