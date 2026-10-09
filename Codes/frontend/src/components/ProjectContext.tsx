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
  /** the user's working context, shared by every project page (persisted per project for the session) */
  sel: Selection;
  setSel: (patch: Partial<Selection>) => void;
}

export interface Selection {
  audienceId?: string; // audience *version* id
  areaId?: string;
  runId?: string;
}

export function loadSelection(pid: string): Selection {
  try {
    return JSON.parse(sessionStorage.getItem(`ll-sel-${pid}`) ?? '{}') as Selection;
  } catch {
    return {};
  }
}
export function saveSelection(pid: string, s: Selection) {
  try {
    sessionStorage.setItem(`ll-sel-${pid}`, JSON.stringify(s));
  } catch {
    /* storage unavailable: selection lives in memory only */
  }
}

export const ProjectContext = createContext<ProjectCtx | null>(null);

export function useProjectCtx(): ProjectCtx {
  const c = useContext(ProjectContext);
  if (!c) throw new Error('useProjectCtx outside project layout');
  return c;
}
