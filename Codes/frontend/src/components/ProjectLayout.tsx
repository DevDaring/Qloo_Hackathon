import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Hand } from 'lucide-react';
import { useProject } from '../api/hooks';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { DecisionPanel } from './DecisionPanel';
import { EvidenceProvider } from './Evidence';
import { ProjectContext, loadSelection, saveSelection, type ProjectCtx, type Selection } from './ProjectContext';
import { JourneyHeader } from './JourneyBar';
import { LockedBanner } from './Locked';
import { useHashTarget } from '../hooks/useHashTarget';
import { RunConsole } from './RunConsole';
import { OPEN_CONSOLE_EVENT, ProjectNotifications, takeConsoleRequest } from './Activity';
import { Button, ErrorState, Skeleton } from './ui';

export function ProjectLayout() {
  const { pid = '' } = useParams();
  const loc = useLocation();
  const pq = useProject(pid);
  const { events, state } = useProjectEvents(pid);
  const [decisionRun, setDecisionRun] = useState<string | undefined>();
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [consoleRunId, setConsoleRunId] = useState<string | undefined>();
  const [consoleOpen, setConsoleOpen] = useState(() => takeConsoleRequest(pid));
  // the header activity indicator (and notifications) can open the console from anywhere
  useEffect(() => {
    const open = () => setConsoleOpen(true);
    window.addEventListener(OPEN_CONSOLE_EVENT, open);
    return () => window.removeEventListener(OPEN_CONSOLE_EVENT, open);
  }, []);
  const [sel, setSelState] = useState<Selection>(() => loadSelection(pid));
  const setSel = useCallback(
    (patch: Partial<Selection>) =>
      setSelState((cur) => {
        const next = { ...cur, ...patch };
        saveSelection(pid, next);
        return next;
      }),
    [pid],
  );
  const waitingRunId = pq.data?.runs.find((r) => r.status === 'waiting_for_user')?.id;
  // journey deep links: #decision opens the decision panel, other anchors scroll to and focus their target
  useHashTarget((h) => {
    if (h !== 'decision' || !waitingRunId) return false;
    setDecisionRun(waitingRunId);
    setDecisionOpen(true);
    return true;
  });

  const ctx = useMemo<ProjectCtx>(
    () => ({
      pid,
      project: pq.data,
      events,
      stream: state,
      waitingRunId,
      openDecision: (runId) => {
        setDecisionRun(runId ?? waitingRunId);
        setDecisionOpen(true);
      },
      consoleRunId,
      setConsoleRunId,
      consoleOpen,
      setConsoleOpen,
      sel,
      setSel,
    }),
    [pid, pq.data, events, state, waitingRunId, consoleRunId, consoleOpen, sel, setSel],
  );

  if (pq.error && (pq.error as { status?: number }).status === 404)
    return (
      <div className="mx-auto max-w-lg p-10">
        <ErrorState error={pq.error} />
      </div>
    );

  return (
    <ProjectContext.Provider value={ctx}>
      <EvidenceProvider projectId={pid}>
        <div className="flex min-h-full flex-1 flex-col">
          <AnimatePresence>
            {waitingRunId && !pq.data?.locked && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="relative overflow-hidden border-b border-brand/30 bg-gradient-to-r from-[#FFF1EA] via-[#FFF7F2] to-[#EEF4FF] dark:from-brand-soft dark:via-surface dark:to-accent-soft">
                  <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-10">
                    <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[#1A0E08]">
                      <span className="absolute inset-0 animate-pulsering rounded-full bg-brand/60" aria-hidden />
                      <Hand className="relative h-3.5 w-3.5" />
                    </span>
                    <p className="min-w-0 flex-1 text-sm">
                      <b>Decision needed.</b>{' '}
                      <span className="text-muted">{pq.data?.runs.find((r) => r.id === waitingRunId)?.stage === 'creative_planner' ? 'Approve what to generate and a spending cap.' : 'The research run is paused for your choice.'}</span>
                    </p>
                    <Button size="sm" variant="primary" onClick={() => ctx.openDecision(waitingRunId)}>
                      Review &amp; decide
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {pq.data?.locked && <LockedBanner pid={pid} />}
          <JourneyHeader />
          {pq.error && !pq.data && (
            <div className="mx-auto w-full max-w-[1440px] px-4 pt-6 sm:px-6 lg:px-10">
              <ErrorState error={pq.error} onRetry={() => pq.refetch()} />
            </div>
          )}
          <div key={loc.pathname} className="flex flex-1 flex-col">
            <Suspense
              fallback={
                <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 pt-8 sm:px-6 lg:px-10">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-64 w-full" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
          <RunConsole />
          <ProjectNotifications />
        </div>
        <DecisionPanel pid={pid} runId={decisionRun} open={decisionOpen} onClose={() => setDecisionOpen(false)} />
      </EvidenceProvider>
    </ProjectContext.Provider>
  );
}
