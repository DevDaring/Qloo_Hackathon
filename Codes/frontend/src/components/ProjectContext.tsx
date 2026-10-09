import { createContext, useContext } from 'react';
import type { ProjectDetail, RunEvent } from '../api/types';
import type { StreamState } from '../hooks/useProjectEvents';

export interface ProjectCtx {
  pid: string;
  project?: ProjectDetail;
  events: RunEvent[];
  stream: StreamState;
  /** the most recent run waiting for a user decision, if any */
  waitingRunId?: string;
  openDecision: (runId?: string) => void;
  consoleRunId?: string;
  setConsoleRunId: (id?: string) => void;
}

export const ProjectContext = createContext<ProjectCtx | null>(null);

export function useProjectCtx(): ProjectCtx {
  const c = useContext(ProjectContext);
  if (!c) throw new Error('useProjectCtx outside project layout');
  return c;
}
