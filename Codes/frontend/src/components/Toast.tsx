import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/format';
import { errorMessage } from '../api/client';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}
interface ToastApi {
  push: (t: Omit<ToastItem, 'id'>) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, e?: unknown) => void;
  info: (title: string, body?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      window.setTimeout(() => remove(id), t.kind === 'error' ? 8000 : 4500);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, body) => push({ kind: 'success', title, body }),
      info: (title, body) => push({ kind: 'info', title, body }),
      error: (title, e) => push({ kind: 'error', title, body: e === undefined ? undefined : errorMessage(e) }),
    }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur"
            >
              <span className={cn('mt-0.5', t.kind === 'success' ? 'text-ok' : t.kind === 'error' ? 'text-bad' : 'text-accent')}>
                {t.kind === 'success' ? <CheckCircle2 className="h-5 w-5" /> : t.kind === 'error' ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[13px] text-muted">{t.body}</p>}
              </div>
              <button onClick={() => remove(t.id)} className="rounded-md p-1 text-subtle hover:bg-surface2 hover:text-fg" aria-label="Dismiss notification">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
