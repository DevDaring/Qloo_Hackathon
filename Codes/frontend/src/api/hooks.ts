import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, get, patch, post, put, type Schemas } from './client';
import type * as T from './types';

export const ACTIVE_RUN = ['queued', 'running'];
export const ACTIVE_JOB = ['queued', 'running', 'waiting_for_provider', 'cancellation_requested'];
export const isActiveRun = (s?: string) => !!s && ACTIVE_RUN.includes(s);
export const isActiveJob = (s?: string) => !!s && ACTIVE_JOB.includes(s);

export type PlaceFilters = { area_id?: string; category?: string; role?: string; bbox?: string };

/* ---------------------------------------------------------------- session */
export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => get<T.Me>('/auth/me'), retry: false, staleTime: 60_000 });

export const usePublicConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => get<T.PublicConfig>('/public-config'), staleTime: Infinity });

/* ---------------------------------------------------------------- projects */
export const useProjects = (includeArchived = false) =>
  useQuery({
    queryKey: ['projects', includeArchived],
    queryFn: () => get<{ items: T.ProjectListItem[] }>('/projects', { include_archived: includeArchived }),
    refetchInterval: (q) =>
      q.state.data?.items.some((p) => isActiveRun(p.last_run?.status)) ? 6000 : false,
  });

export const useProject = (pid?: string) =>
  useQuery({
    queryKey: ['project', pid],
    queryFn: () => get<T.ProjectDetail>(`/projects/${pid}`),
    enabled: !!pid,
    refetchInterval: (q) => (q.state.data && (q.state.data.active_jobs > 0 || q.state.data.runs.some((r) => isActiveRun(r.status))) ? 5000 : false),
  });

export const useProduct = (pid?: string) =>
  useQuery({ queryKey: ['product', pid], queryFn: () => get<T.ProductResponse>(`/projects/${pid}/product`), enabled: !!pid });

export const useClaims = (pid?: string) =>
  useQuery({ queryKey: ['claims', pid], queryFn: () => get<{ items: T.Claim[] }>(`/projects/${pid}/claims`), enabled: !!pid });

export const useConstraints = (pid?: string) =>
  useQuery({
    queryKey: ['constraints', pid],
    queryFn: () => get<T.ConstraintsResponse>(`/projects/${pid}/constraints`),
    enabled: !!pid,
  });

export const useAudiences = (pid?: string) =>
  useQuery({
    queryKey: ['audiences', pid],
    queryFn: () => get<{ items: T.AudienceWithEntities[] }>(`/projects/${pid}/audiences`),
    enabled: !!pid,
  });

export const useAreas = (pid?: string) =>
  useQuery({ queryKey: ['areas', pid], queryFn: () => get<{ items: T.Area[] }>(`/projects/${pid}/areas`), enabled: !!pid });

/* ---------------------------------------------------------------- runs */
export const useRuns = (pid?: string) =>
  useQuery({
    queryKey: ['runs', pid],
    queryFn: () => get<{ items: T.Run[] }>(`/projects/${pid}/research-runs`),
    enabled: !!pid,
    refetchInterval: (q) => (q.state.data?.items.some((r) => isActiveRun(r.status)) ? 4000 : false),
  });

export const useRun = (rid?: string | null) =>
  useQuery({
    queryKey: ['run', rid],
    queryFn: () => get<T.RunDetail>(`/runs/${rid}`),
    enabled: !!rid,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return isActiveRun(d.run.status) || d.jobs.some((j) => isActiveJob(j.status)) ? 3000 : false;
    },
  });

/** Pick the run most useful to look at: the newest one with research results,
 * unless the caller pinned a run. */
export function pickDefaultRun(runs: T.Run[] | undefined, pinned?: string | null): T.Run | undefined {
  if (!runs?.length) return undefined;
  if (pinned) {
    const r = runs.find((x) => x.id === pinned);
    if (r) return r;
  }
  const withResults = runs.find((r) => r.qloo_enabled && (r.counts?.places ?? 0) > 0 && !isActiveRun(r.status));
  return withResults ?? runs.find((r) => (r.counts?.places ?? 0) > 0) ?? runs[0];
}

/** All retrieved places for the filter (pages of 500, capped at 2,000 for the browser). */
export const usePlaces = (rid: string | undefined, f: PlaceFilters) =>
  useQuery({
    queryKey: ['places', rid, f],
    queryFn: async () => {
      const first = await get<T.PlacesResponse>(`/runs/${rid}/places`, { ...f, page_size: 500, page: 1 });
      const pages = Math.min(4, Math.ceil(first.total / 500));
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, i) => get<T.PlacesResponse>(`/runs/${rid}/places`, { ...f, page_size: 500, page: i + 2 })),
      );
      return { ...first, items: [...first.items, ...rest.flatMap((r) => r.items)] };
    },
    enabled: !!rid,
    placeholderData: keepPreviousData,
  });

export const useAnalytics = (rid: string | undefined, f: PlaceFilters) =>
  useQuery({
    queryKey: ['analytics', rid, f],
    queryFn: () => get<T.Analytics>(`/runs/${rid}/analytics`, f),
    enabled: !!rid,
    placeholderData: keepPreviousData,
  });

export const useTasteLayer = (rid?: string, areaId?: string, audId?: string, enabled = false) =>
  useQuery({
    queryKey: ['taste', rid, areaId, audId],
    queryFn: () => get<T.TasteLayer>(`/runs/${rid}/taste-layer`, { area_id: areaId, audience_version_id: audId }),
    enabled: enabled && !!rid && !!areaId && !!audId,
    staleTime: 5 * 60_000,
  });

export const useRunDiff = (rid?: string) =>
  useQuery({ queryKey: ['diff', rid], queryFn: () => get<T.RunDiff>(`/runs/${rid}/diff`), enabled: !!rid });

export const useEvents = (pid?: string) =>
  useQuery({
    queryKey: ['events', pid],
    queryFn: () => get<{ items: T.RunEvent[]; last_id: number }>(`/projects/${pid}/events`, { after: 0, limit: 500 }),
    enabled: !!pid,
    staleTime: Infinity,
  });

/* ---------------------------------------------------------------- evidence */
export const useEvidence = (pid?: string, ids?: string[]) =>
  useQuery({
    queryKey: ['evidence', pid, [...(ids ?? [])].sort().join(',')],
    queryFn: () => get<{ items: T.EvidenceCard[] }>(`/projects/${pid}/evidence`, { ids: (ids ?? []).join(',') }),
    enabled: !!pid && !!ids && ids.length > 0,
    staleTime: 5 * 60_000,
  });

export const useRunEvidence = (pid?: string, rid?: string, areaId?: string) =>
  useQuery({
    queryKey: ['run-evidence', pid, rid, areaId],
    queryFn: () => get<{ items: T.EvidenceCard[] }>(`/projects/${pid}/evidence`, { run_id: rid, area_id: areaId }),
    enabled: !!pid && !!rid,
  });

/* ---------------------------------------------------------------- placements & strategies */
export const usePlacements = (pid?: string, params: { run_id?: string; area_id?: string; audience_version_id?: string } = {}) =>
  useQuery({
    queryKey: ['placements', pid, params],
    queryFn: () => get<T.PlacementsResponse>(`/projects/${pid}/placements`, params),
    enabled: !!pid,
  });

export const useStrategies = (pid?: string) =>
  useQuery({
    queryKey: ['strategies', pid],
    queryFn: () => get<{ items: T.Strategy[] }>(`/projects/${pid}/strategies`),
    enabled: !!pid,
  });

export const useStrategy = (sid?: string) =>
  useQuery({ queryKey: ['strategy', sid], queryFn: () => get<T.StrategyDetail>(`/strategies/${sid}`), enabled: !!sid });

/* ---------------------------------------------------------------- creative */
export const useBriefs = (pid?: string) =>
  useQuery({
    queryKey: ['briefs', pid],
    queryFn: () => get<{ items: T.BriefListItem[] }>(`/projects/${pid}/creative-briefs`),
    enabled: !!pid,
  });

export const useBrief = (bid?: string) =>
  useQuery({
    queryKey: ['brief', bid],
    queryFn: () => get<T.BriefDetail>(`/creative-briefs/${bid}`),
    enabled: !!bid,
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => isActiveJob(j.status)) ? 4000 : false),
  });

export const useEstimate = (
  bid: string | undefined,
  p: { presets?: string[]; mode?: 'full' | 'animatic'; only_scene?: number | null; narration?: boolean },
  enabled = true,
) =>
  useQuery({
    queryKey: ['estimate', bid, p],
    queryFn: () =>
      get<T.CostEstimate>(`/creative-briefs/${bid}/estimate`, {
        presets: p.presets?.join(','),
        mode: p.mode,
        only_scene: p.only_scene ?? undefined,
        narration: p.narration,
      }),
    enabled: enabled && !!bid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const useJob = (jid?: string | null) =>
  useQuery({
    queryKey: ['job', jid],
    queryFn: () => get<T.JobWithAttempts>(`/jobs/${jid}`),
    enabled: !!jid,
    refetchInterval: (q) => (isActiveJob(q.state.data?.status) ? 3000 : false),
  });

export const useProjectJobs = (pid?: string) =>
  useQuery({
    queryKey: ['jobs', pid],
    queryFn: () => get<{ items: T.Job[] }>(`/projects/${pid}/jobs`),
    enabled: !!pid,
    refetchInterval: (q) => (q.state.data?.items.some((j) => isActiveJob(j.status)) ? 4000 : false),
  });

/* ---------------------------------------------------------------- assets & exports */
export const useAssets = (pid?: string, kind?: string) =>
  useQuery({
    queryKey: ['assets', pid, kind ?? ''],
    queryFn: () => get<{ items: T.Asset[] }>(`/projects/${pid}/assets`, { kind }),
    enabled: !!pid,
  });

export const useAsset = (aid?: string | null) =>
  useQuery({ queryKey: ['asset', aid], queryFn: () => get<T.AssetDetail>(`/assets/${aid}`), enabled: !!aid });

export const useExports = (pid?: string) =>
  useQuery({
    queryKey: ['exports', pid],
    queryFn: () => get<{ items: T.ExportItem[] }>(`/projects/${pid}/exports`),
    enabled: !!pid,
    refetchInterval: (q) => (q.state.data?.items.some((e) => ['queued', 'running'].includes(e.status)) ? 3000 : false),
  });

export const useManifest = (eid?: string | null) =>
  useQuery({ queryKey: ['manifest', eid], queryFn: () => get<Record<string, unknown>>(`/exports/${eid}/manifest`), enabled: !!eid });

/* ---------------------------------------------------------------- results, status */
export const useResults = (pid?: string) =>
  useQuery({ queryKey: ['results', pid], queryFn: () => get<T.ResultsResponse>(`/projects/${pid}/results`), enabled: !!pid });

export const useProviders = (refresh = false) =>
  useQuery({
    queryKey: ['providers', refresh],
    queryFn: () => get<T.ProvidersStatus>('/providers/status', { refresh }),
    staleTime: 60_000,
  });

export const useUsage = (pid?: string) =>
  useQuery({ queryKey: ['usage', pid ?? 'all'], queryFn: () => get<T.Usage>('/usage', { project_id: pid }) });

export const useRevisions = (pid?: string) =>
  useQuery({ queryKey: ['revisions', pid], queryFn: () => get<{ items: T.Revision[] }>(`/projects/${pid}/revisions`), enabled: !!pid });

export const useConsultHistory = (pid?: string) =>
  useQuery({
    queryKey: ['consult', pid],
    queryFn: () =>
      get<{ items: { role: string; content: string; evidence_ids: string[]; proposed_revision: T.ConsultAnswer['proposed_revision']; created_at: string }[] }>(
        `/projects/${pid}/consult`,
      ),
    enabled: !!pid,
  });

/* ---------------------------------------------------------------- explanation views (read-only, no provider calls) */
export const useJourneyApi = (pid?: string) =>
  useQuery({ queryKey: ['journey', pid], queryFn: () => get<T.JourneyResponse>(`/projects/${pid}/journey`), enabled: !!pid, staleTime: 15_000 });

export const useTasteStory = (rid?: string, areaId?: string, audId?: string, placeId?: string) =>
  useQuery({
    queryKey: ['taste-story', rid, areaId, audId, placeId ?? null],
    queryFn: () =>
      get<T.TasteStory>(`/runs/${rid}/taste-story`, { area_id: areaId, audience_version_id: audId, ...(placeId ? { place_id: placeId } : {}) }),
    enabled: !!rid && !!areaId && !!audId,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useAudienceCompare = (rid?: string, areaId?: string, a?: string, b?: string) =>
  useQuery({
    queryKey: ['audience-compare', rid, areaId, a, b],
    queryFn: () => get<T.AudienceCompare>(`/runs/${rid}/audience-compare`, { area_id: areaId, a, b }),
    enabled: !!rid && !!areaId && !!a && !!b && a !== b,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useCreativeTrace = (bid?: string) =>
  useQuery({ queryKey: ['trace', bid], queryFn: () => get<T.CreativeTrace>(`/creative-briefs/${bid}/trace`), enabled: !!bid, staleTime: 60_000 });

export const useOpportunities = (rid?: string) =>
  useQuery({
    queryKey: ['opportunities', rid],
    queryFn: () => get<{ run_id: string; items: T.Opportunity[]; message: string | null }>(`/runs/${rid}/opportunities`),
    enabled: !!rid,
    staleTime: 5 * 60_000,
  });

export type RevisionBody = Partial<Schemas['RevisionApplyIn']> & { kind: Schemas['RevisionApplyIn']['kind'] };

/** Dry run of a revision. A POST, but it writes nothing and is allowed on the locked sample. */
export const useRevisionPreview = (pid?: string, body?: RevisionBody | null) =>
  useQuery({
    queryKey: ['revision-preview', pid, body],
    queryFn: () => post<T.RevisionPreview>(`/projects/${pid}/revisions/preview`, body),
    enabled: !!pid && !!body,
    retry: false,
    staleTime: 30_000,
  });

/* ---------------------------------------------------------------- mutations */
/** Generic mutation helper that invalidates the given query-key prefixes on success. */
export function useApiMutation<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // every successful write may move the project journey along
    onSuccess: () => Promise.all([...invalidate, ['journey']].map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export const mutations = {
  login: (b: Schemas['LoginIn']) => post<{ ok: boolean; user: T.Me['user'] }>('/auth/login', b),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  createProject: (b: Schemas['ProjectIn']) => post<T.Project>('/projects', b),
  patchProject: (pid: string, b: Partial<Schemas['ProjectPatch']>) => patch<T.Project>(`/projects/${pid}`, b),
  saveMapState: (pid: string, s: T.MapState) => put<{ saved: T.MapState }>(`/projects/${pid}/map-state`, s),
  saveProduct: (pid: string, b: Schemas['ProductIn']) => post<{ product: T.Product; revision: unknown }>(`/projects/${pid}/product`, b),
  extract: (pid: string, b: { text?: string; asset_id?: string }) => post<T.ExtractProposal>(`/projects/${pid}/product/extract`, b),
  addClaim: (pid: string, b: Schemas['ClaimIn']) => post<{ id: string; warnings: unknown; note: string }>(`/projects/${pid}/claims`, b),
  patchClaim: (cid: string, b: Partial<Schemas['ClaimPatch']>) => patch<{ ok: boolean }>(`/claims/${cid}`, b),
  upload: (pid: string, role: string, file: File, isPrimary = false) => {
    const fd = new FormData();
    fd.set('role', role);
    fd.set('file', file);
    fd.set('is_primary', String(isPrimary));
    return api<{ asset: T.Asset; extracted_chars: number }>(`/projects/${pid}/uploads`, { method: 'POST', form: fd });
  },
  putConstraints: (pid: string, b: Schemas['ConstraintsIn']) => put<{ constraints: T.Constraints; revision: unknown }>(`/projects/${pid}/constraints`, b),
  geoSearch: (q: string, country = 'IN') =>
    get<{ results: T.GeoResult[]; disambiguation_needed: boolean; source?: string; attribution?: string }>('/geo/search', { q, country }),
  saveArea: (pid: string, b: Schemas['AreaIn']) => post<T.Area>(`/projects/${pid}/areas`, b),
  patchArea: (aid: string, b: { name?: string; shortlisted_place_ids?: string[] }) => patch<T.Area>(`/areas/${aid}`, b),
  createAudience: (pid: string, b: Schemas['AudienceIn']) => post<T.Audience>(`/projects/${pid}/audiences`, b),
  updateAudience: (audienceId: string, b: Schemas['AudienceIn']) => put<{ audience: T.Audience; revision: unknown }>(`/audiences/${audienceId}`, b),
  archiveAudience: (audienceId: string) => api<{ archived: boolean }>(`/audiences/${audienceId}`, { method: 'DELETE' }),
  qlooSearch: (q: string) => get<{ entities: T.EntityCandidate[]; tags: T.EntityCandidate[] }>('/qloo/search', { q }),
  resolveEntity: (eid: string, b: Schemas['EntityResolveIn']) => post<T.ResolvedEntity>(`/entities/${eid}/resolve`, b),
  startRun: (pid: string, b: Partial<Schemas['RunIn']> = {}) =>
    post<{ run: T.Run; job: T.Job }>(`/projects/${pid}/research-runs`, { qloo_enabled: true, label: '', ...b }),
  resume: (rid: string, decision: Record<string, unknown>) => post<{ run: T.Run; job: T.Job }>(`/runs/${rid}/resume`, { decision }),
  cancelRun: (rid: string) => post<{ run_id: string; note: string }>(`/runs/${rid}/cancel`),
  compare: (pid: string, b: { run_id: string; area_ids: string[] }) =>
    post<{ items: T.Assessment[]; comparable: boolean; note: string }>(`/projects/${pid}/locations/compare`, b),
  patchPlacement: (id: string, b: Partial<Schemas['PlacementPatch']>) => patch<T.Placement>(`/placements/${id}`, b),
  createStrategy: (pid: string, b: Schemas['StrategyIn']) => post<{ job: T.Job; created: boolean }>(`/projects/${pid}/strategies`, b),
  createBrief: (pid: string, b: Partial<Schemas['BriefIn']> & { strategy_version_id: string }) =>
    post<{ job: T.Job }>(`/projects/${pid}/creative-briefs`, b),
  editBrief: (bid: string, b: Partial<Schemas['BriefPatch']> & { lock_version: number }) =>
    patch<{ brief: T.Brief; revision: unknown; claim_issues: unknown }>(`/creative-briefs/${bid}`, b),
  approveBrief: (bid: string, state: T.ApprovalState) => post<T.Brief>(`/creative-briefs/${bid}/approve`, { state }),
  duplicateBrief: (bid: string, b: Schemas['DuplicateIn']) => post<{ job: T.Job }>(`/creative-briefs/${bid}/duplicate`, b),
  editScene: (sid: string, b: Partial<Schemas['ScenePatch']>) =>
    patch<{ ok: boolean; regeneration_needed: boolean; note: string }>(`/scenes/${sid}`, b),
  genImages: (bid: string, b: Schemas['ImagesIn']) =>
    post<{ job: T.Job; created: boolean; estimate: T.GenEstimate }>(`/creative-briefs/${bid}/images`, b),
  genVideos: (bid: string, b: Schemas['VideosIn']) =>
    post<{ job: T.Job; created: boolean; estimate: T.GenEstimate }>(`/creative-briefs/${bid}/videos`, b),
  retryJob: (jid: string, confirm = false) =>
    post<{ job: T.Job; reused: string }>(`/jobs/${jid}/retry`, { confirm_unknown_submissions: confirm }),
  cancelJob: (jid: string) => post<{ status: string; note: string }>(`/jobs/${jid}/cancel`),
  reconcile: (aid: string, outcome: 'not_charged' | 'charged_no_output', note = '') =>
    post<{ status: string; ledger: string | null }>(`/attempts/${aid}/reconcile`, { outcome, note }),
  setApproval: (aid: string, state: T.ApprovalState) => post<T.Asset>(`/assets/${aid}/approval`, { state }),
  createExport: (pid: string) => post<{ export_id: string; job: T.Job }>(`/projects/${pid}/exports`),
  importResults: (pid: string, rows: Schemas['ResultRow'][]) => post<{ imported: number }>(`/projects/${pid}/results`, { rows }),
  importCsv: (pid: string, file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    return api<{ imported: number }>(`/projects/${pid}/results/csv`, { method: 'POST', form: fd });
  },
  applyRevision: (pid: string, b: Partial<Schemas['RevisionApplyIn']> & { kind: Schemas['RevisionApplyIn']['kind'] }) =>
    post<{ revision: unknown; run?: T.Run; job?: T.Job }>(`/projects/${pid}/revisions/apply`, b),
  consult: (pid: string, message: string, runId?: string) => post<T.ConsultAnswer>(`/projects/${pid}/consult`, { message, run_id: runId }),
  assistant: (
    messages: T.AssistantMessage[],
    projectId?: string,
    page?: { path: string; name: string; audience_version_id?: string; area_id?: string; run_id?: string },
  ) => post<T.AssistantReply>('/assistant/chat', { messages, project_id: projectId, page }),
  duplicateProject: (pid: string) => post<T.Project & { copied_from: string; next: string }>(`/projects/${pid}/duplicate`),
};
