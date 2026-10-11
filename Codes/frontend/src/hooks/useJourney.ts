/**
 * Project journey: Brief → Audience → Explore → Strategy → Create → Export.
 *
 * Stage states, blockers (with deep links) and the next action come from
 * `GET /projects/{id}/journey`; this module maps that response into the view
 * model the journey bar and project cards render.
 */
import { useMemo } from 'react';
import { useJourneyApi } from '../api/hooks';
import type { JourneyNextAction, JourneyResponse, JourneyStageKey, JourneyStatus, ProjectDetail } from '../api/types';

export type StageId = JourneyStageKey;
export type StageStatus = JourneyStatus;

export interface Blocker {
  text: string;
  /** absolute app path (may carry a #anchor) that fixes it */
  to: string;
  fix: string;
}

export interface JourneyStage {
  id: StageId;
  label: string;
  /** absolute path of the stage's primary page */
  to: string;
  status: StageStatus;
  summary: string;
  blockers: Blocker[];
}

export interface NextAction {
  label: string;
  why: string;
  to?: string;
  /** a decision that belongs to the user (opens the decision panel instead of navigating) */
  decisionRunId?: string;
  /** an in-page action (e.g. open the run console) */
  action?: string;
  /** e.g. "Duplicate to edit" on the locked sample */
  secondary?: JourneyNextAction['secondary'];
}

export interface Journey {
  stages: JourneyStage[];
  next: NextAction | null;
  current: StageId | null;
  lastCompleted: string | null;
  locked: boolean;
  loading: boolean;
}

export const STAGE_DEFS: { id: StageId; label: string; pages: string[] }[] = [
  { id: 'brief', label: 'Brief', pages: ['brief'] },
  { id: 'audience', label: 'Audience', pages: ['audiences'] },
  { id: 'explore', label: 'Explore', pages: ['explorer', 'compare'] },
  { id: 'strategy', label: 'Strategy', pages: ['strategy'] },
  { id: 'create', label: 'Create', pages: ['studio'] },
  { id: 'export', label: 'Export', pages: ['assets', 'results'] },
];
const STAGE_PATH: Record<StageId, string> = { brief: 'brief', audience: 'audiences', explore: 'explorer', strategy: 'strategy', create: 'studio', export: 'assets' };

export function stageForPath(sub: string): StageId | null {
  const seg = sub.split('/')[0];
  return STAGE_DEFS.find((s) => s.pages.includes(seg))?.id ?? null;
}

export function mapNextAction(n: JourneyNextAction | null | undefined): NextAction | null {
  if (!n) return null;
  return { label: n.label, why: n.why, to: n.to, decisionRunId: n.decision_run_id, action: n.action, secondary: n.secondary };
}

export function mapJourney(pid: string, r: JourneyResponse | undefined): Journey {
  if (!r)
    return {
      stages: STAGE_DEFS.map((d) => ({ id: d.id, label: d.label, to: `/projects/${pid}/${STAGE_PATH[d.id]}`, status: 'todo', summary: '…', blockers: [] })),
      next: null,
      current: null,
      lastCompleted: null,
      locked: false,
      loading: true,
    };
  return {
    stages: r.stages.map((s) => ({
      id: s.key,
      label: s.label,
      to: s.path,
      status: s.status,
      summary: s.summary,
      blockers: s.blockers.map((b) => ({ text: b.message, to: b.to, fix: b.fix })),
    })),
    next: mapNextAction(r.next_action),
    current: r.current,
    lastCompleted: r.last_completed,
    locked: r.locked,
    loading: false,
  };
}

export function useJourney(pid: string): Journey {
  const q = useJourneyApi(pid);
  return useMemo(() => mapJourney(pid, q.data), [pid, q.data]);
}

/** What must exist before research can start (shown visibly next to the Start research action). */
export function researchPrereqs(p?: ProjectDetail): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (!p.product) out.push('save the product brief');
  if (!p.constraints || !p.constraints.candidate_regions.length) out.push('choose candidate cities');
  if (!p.audiences.length) out.push('define at least one audience');
  // one research run at a time: a second click would only queue a duplicate
  if (p.runs?.some((r) => r.status === 'running' || r.status === 'queued')) out.push('wait for the research run in progress to finish');
  return out;
}
