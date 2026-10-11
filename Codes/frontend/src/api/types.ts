/** Response shapes hand-written from the Python serialisers
 * (backend/launchlens/api/deps.py, routes_*.py, services/*). Request bodies
 * use the generated OpenAPI types in schema.d.ts (see client.ts `Schemas`). */

export type ISO = string;
export type Lang = 'en' | 'hi' | 'bn' | 'es';
export type AudienceRole = 'product_user' | 'purchaser' | 'institutional_buyer' | 'distribution_partner';
export type Preset = 'square' | 'portrait' | 'vertical';
export type Orientation = 'vertical' | 'landscape';
export type ApprovalState = 'draft' | 'needs_review' | 'approved' | 'rejected';

export interface Me {
  user: { id: string; username: string; display_name: string };
  workspace: { id: string; name: string; is_demo: boolean; role: string };
}

export interface PublicConfig {
  appName: string;
  mapStyleUrl: string;
  mapPublicToken: string;
  demoMode: boolean;
  maxUploadMb: number;
  languages: Lang[];
}

export interface Asset {
  id: string;
  kind: string;
  mime_type: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  source: string;
  label: string;
  provider_model: string | null;
  remote_request_id: string | null;
  brief_id: string | null;
  preset: string | null;
  group_key: string;
  version: number;
  supersedes_id: string | null;
  approval_state: ApprovalState;
  stale: boolean;
  stale_reason: string | null;
  quality: AssetQuality | null;
  lineage: Record<string, unknown> | null;
  is_original: boolean;
  sha256: string;
  metadata: Record<string, unknown>;
  created_at: ISO;
  url: string;
}

export interface AssetDetail extends Asset {
  layout: Record<string, unknown> | null;
  versions: Asset[];
  parents: (Asset & { role: string })[];
  subtitles?: { srt?: string; vtt?: string } | null;
}

export interface AssetQuality {
  passed?: boolean | null;
  dimensions?: { expected: number[]; actual: number[]; ok: boolean };
  text_overflow?: Record<string, unknown> | null;
  contrast?: Record<string, number>;
  contrast_ok?: boolean;
  safe_area_ok?: boolean;
  product?: { aspect_preserved?: boolean; [k: string]: unknown };
  text_rendering?: { engine: string; deterministic: boolean; complex_script_shaping: boolean };
  claims?: Record<string, ClaimIssue[]> | ClaimIssue[] | null;
  background_review?: { model: string | null; flags: string[]; notes: string; passed: boolean | null };
  video?: Record<string, unknown> & { passed?: boolean };
  audio_state?: string;
  transform?: string;
  product_identity?: string;
  [k: string]: unknown;
}

export interface ClaimIssue {
  severity?: string;
  message?: string;
  rule?: string;
  [k: string]: unknown;
}

export interface RunSummary {
  id: string;
  status: string;
  stage: string;
  qloo_enabled?: boolean;
  experiment_label?: string;
  created_at?: ISO;
}

export interface Project {
  id: string;
  name: string;
  goal: string;
  status: string;
  country_code: string;
  currency: string;
  is_demo: boolean;
  /** read-only sample: every mutating request returns 409 project_locked */
  locked?: boolean;
  archived: boolean;
  saved_map_state: MapState;
  created_at: ISO;
  updated_at: ISO;
}

export interface MapState {
  center?: [number, number];
  zoom?: number;
  filters?: { area_id?: string; category?: string; role?: string };
  run_id?: string;
  area_id?: string;
  view?: 'map' | 'list';
}

export interface ProjectListItem extends Project {
  last_run: RunSummary | null;
  recent_outputs: Asset[];
  strategies: number;
  thumbnail_url?: string | null;
  journey?: {
    current: JourneyStageKey;
    last_completed: string | null;
    stages: { key: JourneyStageKey; status: JourneyStatus }[];
    next_action: JourneyNextAction | null;
  };
}

export interface Feature {
  key: string;
  name: string;
  mechanism: string;
  proposed_benefit: string;
  operating_conditions: string;
  evidence_status: 'verified' | 'owner_stated' | 'unverified' | 'unknown';
  source: string;
  prohibited_exaggerations: string[];
  critical_unknowns: string[];
  enabled: boolean;
}

export interface Product {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  price: number | null;
  currency: string;
  intended_benefits: string[];
  operating_limitations: string[];
  launch_date: string | null;
  distribution_options: string[];
  available_stock: number | null;
  brand_colours: string[];
  brand_voice: string;
  website: string;
  cta_destination: string;
  open_questions: string[];
  is_synthetic: boolean;
  features: Feature[];
  hash: string;
}

export interface Region {
  name: string;
  query?: string | null;
  lat?: number | null;
  lon?: number | null;
  radius_km?: number;
  label?: string | null;
  country_code?: string | null;
  source?: string | null;
}

export interface Constraints {
  id: string;
  version: number;
  country_code: string;
  candidate_regions: Region[];
  service_regions: Region[];
  excluded_regions: Region[];
  production_budget: number | null;
  ad_spend_budget: number | null;
  currency: string;
  min_ad_spend_per_location: number | null;
  distribution_requirements: string[];
  weights: Record<string, number>;
  hash: string;
}

export interface Audience {
  id: string; // audience version id
  audience_id: string;
  version: number;
  name: string;
  role: AudienceRole;
  description: string;
  needs: string[];
  voluntary_interests: { text: string; type?: string | null }[];
  languages: Lang[];
  research_notes: string;
  is_hypothetical_persona: boolean;
  hash: string;
}

export interface EntityCandidate {
  qloo_id: string;
  name?: string;
  type?: string;
  tags?: unknown[];
  [k: string]: unknown;
}

export interface ResolvedEntity {
  id: string;
  query_text: string;
  status: 'pending' | 'ambiguous' | 'resolved' | 'proxy' | 'not_found' | 'unavailable' | string;
  qloo_id: string | null;
  qloo_type: string | null;
  canonical_name: string | null;
  candidates: EntityCandidate[];
  proxy_for: string | null;
  proxy_reason?: string | null;
  tags: unknown[];
  audience_version_id: string | null;
}

export interface AudienceWithEntities extends Audience {
  entities: ResolvedEntity[];
  history: { version: number; id: string }[];
}

export interface Claim {
  id: string;
  text: string;
  feature_key: string | null;
  support_status: 'verified' | 'owner_stated' | 'unsupported' | 'prohibited';
  approved: boolean;
  evidence_ids?: string[];
}

export interface ProjectDetail extends Project {
  product: Product | null;
  constraints: Constraints | null;
  audiences: Audience[];
  claims: Claim[];
  product_assets: { asset_id: string; role: string; is_primary: boolean }[];
  asset_counts: Record<string, number>;
  runs: RunSummary[];
  briefs: number;
  active_jobs: number;
}

export interface ProductResponse {
  current: Product | null;
  versions: { id: string; version: number; created_at: ISO; change_note: string; is_synthetic: boolean }[];
}

export interface ExtractProposal {
  proposal: {
    name: string;
    description: string;
    category: string;
    price: number | null;
    currency: string | null;
    intended_benefits: string[];
    operating_limitations: string[];
    features: {
      key: string;
      name: string;
      mechanism: string;
      proposed_benefit: string;
      operating_conditions: string;
      critical_unknowns: string[];
    }[];
    open_questions: string[];
  };
  model: string;
  note: string;
}

export interface ConstraintsResponse {
  current: Constraints | null;
  default_weights: Record<string, number>;
  weight_labels: Record<string, string>;
  history: { version: number; created_at: ISO; change_note: string }[];
}

export interface GeoResult {
  label: string;
  lat: number;
  lon: number;
  type?: string;
  source?: string;
  country_code?: string;
  [k: string]: unknown;
}

export interface Area {
  id: string;
  name: string;
  kind: string;
  country_code: string;
  center: { lat: number; lon: number } | null;
  radius_m: number | null;
  crs: string;
  source: string;
  display_name: string | null;
  polygon: [number, number][];
  shortlisted_place_ids: string[];
  created_at: ISO;
}

export type StageStatusValue = { status: string; at?: ISO } | string;

export interface PendingDecision {
  type: 'intake' | 'entity_resolution' | 'select_targets' | 'creative_scope' | string;
  title: string;
  // intake
  critical?: IntakeIssue[];
  optional?: IntakeIssue[];
  // entity_resolution
  items?: unknown[];
  note?: string;
  // select_targets
  options?: TargetOption[];
  suggested?: TargetOption[];
  // creative_scope
  brief_ids?: string[];
  estimates?: { image_usd_each: string; video_usd_per_second: string; pricing_source: string; note: string };
  defaults?: {
    presets: Preset[];
    video_brief_ids: string[];
    orientations: Orientation[];
    mode: 'full' | 'animatic' | 'none';
    cap_usd: number;
    narration: boolean;
  };
  briefs?: number;
  resume_with?: Record<string, unknown>;
}

export interface IntakeIssue {
  field?: string;
  question?: string;
  message?: string;
  [k: string]: unknown;
}

export interface TargetOption {
  area_id: string;
  area_name: string;
  status: string;
  rank: number | null;
  audience_version_id: string;
  audience_name: string;
  audience_role: AudienceRole;
}

export interface Run {
  id: string;
  project_id: string;
  status: string;
  stage: string;
  qloo_enabled: boolean;
  experiment_label: string;
  stage_statuses: Record<string, StageStatusValue>;
  counts: Record<string, number>;
  errors: { stage?: string; area?: string; message?: string; brief_id?: string }[];
  pending_decision: PendingDecision | null;
  selections: { targets?: { area_id: string; audience_version_id: string }[] };
  previous_run_id: string | null;
  product_version_id: string | null;
  constraint_version_id: string | null;
  created_at: ISO;
  updated_at: ISO;
}

export interface Job {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: { message?: string; code?: string; kind?: string; [k: string]: unknown } | null;
  project_id: string | null;
  run_id: string | null;
  cost_cap_usd: number | null;
  created_at: ISO;
  updated_at: ISO;
  finished_at: ISO | null;
  heartbeat_at: ISO | null;
}

export interface Attempt {
  id: string;
  provider: string;
  operation: string;
  model: string;
  status: string;
  remote_request_id: string | null;
  error: Record<string, unknown> | null;
  cost_reserved_usd: number | null;
  cost_actual_usd: number | null;
  output_asset_ids: string[] | null;
  created_at: ISO;
}

export type JobWithAttempts = Omit<Job, 'attempts'> & { attempts: Attempt[] };

export interface Component {
  label: string;
  raw: number | null;
  normalized: number | null;
  weight: number;
  contribution: number | null;
  state: 'available' | 'missing' | 'disabled_by_experiment' | string;
  units?: string;
  higher_is_better?: boolean;
  evidence_ids?: string[];
  [k: string]: unknown;
}

export interface HardConstraint {
  name: string;
  reason: string;
  result: 'pass' | 'fail' | 'unknown' | string;
  evidence_ids?: string[];
}

export interface Assessment {
  id: string;
  area_id: string;
  area_name: string;
  center: { lat: number; lon: number } | null;
  radius_m: number | null;
  eligible: boolean;
  status: 'complete' | 'incomplete' | 'excluded' | string;
  hard_constraints: HardConstraint[];
  components: Record<string, Component>;
  weights: Record<string, number>;
  practical_index: number | null;
  cultural_index: number | null;
  planning_index: number | null;
  available_weight: number | null;
  evidence_coverage: number | null;
  rank: number | null;
  practical_rank: number | null;
  assumptions: string[];
  limitations: string[];
  evidence_ids: string[];
}

export interface RunDetail {
  run: Run;
  assessments: Assessment[];
  jobs: Job[];
  strategy_ids: string[];
}

export interface RunEvent {
  id: number;
  type: string;
  stage: string;
  message: string;
  data: Record<string, unknown>;
  run_id: string | null;
  job_id: string | null;
  created_at: ISO;
}

export interface Place {
  id: string;
  area_id: string;
  provider: string;
  provider_id: string;
  name: string;
  category: string;
  role: 'competitor' | 'partner' | 'venue' | 'institution' | string;
  role_basis: string;
  address: string;
  lat: number;
  lon: number;
  distance_m: number | null;
  accessibility: string;
  metadata: Record<string, unknown>;
  retrieved_at: ISO;
  evidence_id: string | null;
}

export interface PlacesResponse {
  items: Place[];
  total: number;
  page: number;
  page_size: number;
  note: string;
  attribution: string;
}

export type CoverageState = 'supported' | 'hypothesis' | 'unknown';

export interface Analytics {
  filters: Record<string, string | null>;
  total_places: number;
  category_distribution: Record<string, Record<string, number>>;
  competitors: Record<string, { confirmed: number; inferred_category_peers: number }>;
  competitor_density: { area: string; per_100_km2: number; area_km2: number; count: number }[];
  taste_profile: { area: string; title: string; value: number | null; units: string; top: unknown[]; evidence_id: string }[];
  evidence_coverage: ({ area: string } & Record<string, CoverageState | string>)[];
  feature_relevance: {
    area: string;
    feature: string;
    feature_key: string;
    status: CoverageState;
    note: string;
    evidence_id: string | null;
  }[];
  location_comparison: {
    area: string;
    eligible: boolean;
    status: string;
    planning_index: number | null;
    available_weight: number | null;
    components: Record<string, Partial<Component>>;
  }[];
  caveats: Record<string, string>;
}

export interface TasteLayer {
  available: boolean;
  reason?: string;
  points?: {
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
    value?: number;
    affinity?: number | null;
    affinity_rank?: number | null;
    popularity?: number | null;
    entity_brand_affinity_rank?: number | null;
    tag_affinity_rank?: number | null;
    [k: string]: unknown;
  }[];
  label?: { entity_type: string; signal: unknown; metric: string; scale: string; not: string };
  retrieved_at?: string;
}

export interface EvidenceCard {
  id: string;
  kind: string;
  badge: string;
  status: string;
  topic: string;
  title: string;
  statement: string;
  source: string;
  source_ref: string;
  retrieved_at: ISO | null;
  period: string;
  value: number | null;
  units: string;
  scope: Record<string, unknown>;
  formula: string;
  inputs: string[];
  limitations: string;
  area_id: string | null;
  run_id: string | null;
  redistributable: boolean;
  payload?: unknown;
}

export interface Placement {
  id: string;
  run_id: string;
  area_id: string;
  audience_version_id: string | null;
  place_id: string | null;
  channel_type: string;
  name: string;
  category: string;
  address: string;
  location: { lat: number; lon: number } | null;
  source: string;
  relationship_note: string;
  qloo_relevance: { state: string; [k: string]: unknown } | null;
  practical_evidence_ids: string[];
  activation: string;
  accessibility: string;
  verification: Record<string, 'verified' | 'unknown' | 'declined' | string>;
  status: 'candidate' | 'availability_unknown' | 'verified_opportunity' | 'rejected' | string;
  shortlisted: boolean;
  next_action: string;
  evidence_needed: string;
  suitability_score: number | null;
  owner_notes: string;
}

export interface PlacementsResponse {
  items: Placement[];
  run_id: string | null;
  legend: Record<string, string>;
}

export interface Ref {
  text: string;
  evidence_ids: string[];
}

export interface StrategyContent {
  positioning: string;
  main_feature_key: string;
  main_feature_rationale: Ref;
  supporting_benefits: Ref[];
  key_messages: Ref[];
  partner_shortlist: { placement_id: string; rationale: string; verification_questions: string[] }[];
  placement_options: { placement_id: string; rationale: string; verification_questions: string[] }[];
  launch_steps: { step: string; timing: string }[];
  pilot_plan: { duration_weeks: number; objective: string; steps: string[]; success_signals: string[] };
  kpis_to_test: { metric: string; target_to_test: string; rationale: string }[];
  expected_learning: string[];
  assumptions: string[];
  limitations: string[];
  feature_hypotheses: Ref[];
  selected: { area_id: string; area_name: string; audience_version_id: string; audience_name: string; audience_role: AudienceRole };
  location_summary?: { status: string; planning_index: number | null; available_weight: number; rank: number | null };
}

export interface BudgetScenario {
  status: 'scenario' | 'no_budget' | string;
  total?: number;
  currency: string;
  note?: string;
  lines: { placement: string; channel_type: string; amount: number; basis: string }[];
  assumptions?: string[];
  formula?: string;
}

export interface Strategy {
  id: string;
  project_id: string;
  run_id: string | null;
  area_id: string;
  audience_version_id: string;
  product_version_id: string;
  version: number;
  content: StrategyContent;
  budget_scenario: BudgetScenario;
  evidence_ids: string[];
  generator: { type?: string; model?: string; [k: string]: unknown } | null;
  validation: { dropped?: { claims?: { text: string; issues: ClaimIssue[] }[]; [k: string]: unknown }; claim_checker?: string } | null;
  stale: boolean;
  stale_reason: string | null;
  created_at: ISO;
}

export interface StrategyDetail extends Strategy {
  evidence: EvidenceCard[];
  placements: Placement[];
}

export interface BriefContent {
  message_hierarchy?: string[];
  headline: string;
  body: string;
  cta: string;
  disclaimer?: string;
  price_text?: string;
  tone?: string;
  setting?: string;
  visual_direction?: string;
  product_treatment?: string;
  mood?: string;
  accessibility_requirements?: string[];
  background_prompt?: string;
  language?: string;
  claim_issues?: Record<string, ClaimIssue[]>;
  source_copy?: { headline: string; body: string; cta: string };
  back_translation?: Record<string, string>;
  translation_model?: string;
  translation_fallback_fields?: string[] | null;
  copy_review?: CopyReview | null;
  [k: string]: unknown;
}

export interface Brief {
  id: string;
  lineage_id: string;
  version: number;
  project_id: string;
  strategy_version_id: string;
  product_version_id: string;
  area_id: string;
  audience_version_id: string;
  language: Lang;
  channel: string;
  objective: string;
  angle: string | null;
  identity_hash: string;
  content: BriefContent;
  decisions: { decision: string; rationale: string; evidence_ids: string[]; kind: string }[];
  approval_state: ApprovalState;
  translation_status: string;
  lock_version: number;
  stale: boolean;
  stale_reason: string | null;
  is_current: boolean;
  created_at: ISO;
  updated_at: ISO;
}

export interface CopyReview {
  model?: string;
  language?: string;
  spelling_and_grammar_ok?: boolean | null;
  meaning_preserved?: boolean | null;
  back_translation?: string;
  issues?: { field?: string; issue?: string; suggestion?: string }[];
}

export interface CostEstimate {
  images: { count: number; usd: string; model: string; source: string };
  video: {
    mode: string;
    scenes: number;
    generated_seconds: number;
    frames_usd: string;
    clips_list_usd: string;
    clips_held_usd: string;
    model: string;
    source: string;
    narration_chars?: number;
  };
  notes: string[];
}

export interface BriefListItem extends Brief {
  assets: Asset[];
}

export interface Scene {
  id: string;
  idx: number;
  kind: string;
  purpose: string;
  shot_description: string;
  duration_s: number;
  spoken_copy: string;
  on_screen_text: string;
  product_overlay: boolean;
  clip_asset_id: string | null;
  status: string;
}

export interface BriefDetail extends Brief {
  strategy: { id: string; version: number; area: string; audience: string; stale: boolean };
  storyboard: { id: string; total_seconds: number; aspect_ratio: string; audio_plan: Record<string, unknown> | null; scenes: Scene[] } | null;
  assets: Asset[];
  versions: { id: string; version: number; created_at: ISO }[];
  jobs: Job[];
}

export interface GenEstimate {
  usd: string;
  source: string;
  note: string;
  generated_seconds?: number;
}

export interface ExportItem {
  id: string;
  status: string;
  asset_id: string | null;
  files: number;
  included_versions: Record<string, unknown> | null;
  download_url: string | null;
  expires_at: ISO | null;
  created_at: ISO;
}

export interface ResultRowOut {
  id: string;
  period_start: string;
  period_end: string;
  area_name: string;
  channel: string;
  impressions: number | null;
  clicks: number | null;
  inquiries: number | null;
  leads: number | null;
  purchases: number | null;
  spend: number | null;
  currency: string;
  measurement_source: string;
  notes: string;
  strategy_version_id: string | null;
  brief_id: string | null;
  placement_id: string | null;
}

export interface ResultsResponse {
  items: ResultRowOut[];
  summary: ({
    segment: string;
    impressions: number | null;
    clicks: number | null;
    inquiries: number | null;
    leads: number | null;
    purchases: number | null;
    spend: number | null;
    rows: number;
    rates: Record<string, number>;
  })[];
  hypotheses: { strategy: string; kpis_to_test: StrategyContent['kpis_to_test']; feature_hypotheses: Ref[] }[];
  limitations: string[];
}

export interface ProviderProbe {
  configured?: boolean;
  reachable?: boolean | null;
  authorized?: boolean | null;
  operations?: Record<string, unknown>;
  message?: string;
  model?: string;
  error?: string;
  served_by?: string;
  [k: string]: unknown;
}

export interface ProvidersStatus {
  qloo: ProviderProbe & { base_url: string };
  reasoning: ProviderProbe & { primary: string; fallback: string; fallback_configured: boolean; fallback_enabled?: boolean };
  media: ProviderProbe & { image_model?: string; video_model?: string; available_models?: Record<string, string[]> };
  narration: { configured: boolean; fish: boolean; fal: boolean; sarvam?: boolean; order?: Record<string, string[]>; note: string };
  indic_language?: { provider: string; configured: boolean; translation_model?: string; tts_model?: string; verified?: string | boolean; note?: string };
  geo: {
    geocoding?: { provider: string; base_url: string; reachable: boolean; operation: string };
    places?: { provider: string; note: string };
    climate?: { provider: string; note: string };
    error?: string;
  };
  map: { style_url: string; attribution: string };
  storage: { backend: string };
  limits: Record<string, string | number>;
  legend: Record<string, string>;
  checked_at?: ISO;
  plain?: ProviderPlain[];
}

export type ProviderPlainState = 'working' | 'backup' | 'partial' | 'not_set_up' | 'key_rejected' | 'unreachable' | 'busy';
export interface ProviderPlain {
  key: string;
  name: string;
  state: ProviderPlainState;
  summary: string;
  impact: string | null;
  recovery: string[];
  checked_at: ISO | null;
}

export interface Usage {
  by_category: Record<string, { estimated_usd: string; actual_usd: string; reserved_usd: string; calls: number }>;
  today_usd: string;
  daily_cap_usd: string;
  currency: string;
  recent: {
    provider: string;
    model: string;
    operation: string;
    category: string;
    estimated_usd: number | null;
    actual_usd: number | null;
    state: string;
    pricing_source: string;
    created_at: ISO;
  }[];
}

export interface Experiment {
  id: string;
  conditions: { held_constant: string[]; varied: string; [k: string]: unknown };
  practical_evidence_identical: boolean;
  locations: {
    area: string;
    with_qloo: { eligible: boolean; rank: number | null; status: string; planning_index: number | null } | null;
    without_qloo: { eligible: boolean; rank: number | null; status: string; planning_index: number | null; practical_index: number | null } | null;
    hard_constraints_identical: boolean;
  }[];
  strategies: {
    with_qloo: { strategies: number; unsupported_claims_removed: number; main_features: string[]; placements: string[] };
    without_qloo: { strategies: number; unsupported_claims_removed: number; main_features: string[]; placements: string[] };
  };
  placement_changes: { only_with_qloo: string[]; only_without_qloo: string[] };
  owner_ratings: Record<string, number> | null;
  notes: string[];
}

export interface RunDiff {
  available: boolean;
  reason?: string;
  run_id?: string;
  against?: string;
  areas?: {
    area: string;
    before: { eligible: boolean; status: string; planning_index: number | null; rank: number | null } | null;
    after: { eligible: boolean; status: string; planning_index: number | null; rank: number | null } | null;
    changed: boolean;
    why: string[];
  }[];
  strategies?: { new_versions: string[]; decisions: unknown[] };
  revisions?: { kind: string; summary: string; invalidated: unknown; preserved: unknown }[];
  inputs_changed?: { product_version: boolean; constraints_version: boolean };
}

export interface Revision {
  id: string;
  kind: string;
  summary: string;
  before: unknown;
  after: unknown;
  invalidated: unknown;
  preserved: unknown;
  run_id: string | null;
  created_at: ISO;
}

export interface ConsultAnswer {
  answer: string;
  evidence: EvidenceCard[];
  hypotheses: string[];
  unknowns: string[];
  proposed_revision: {
    kind: string;
    region_name?: string | null;
    ad_spend_budget?: number | null;
    feature_key?: string | null;
    audience_name?: string | null;
    role?: string | null;
    rationale?: string;
  } | null;
  dropped_evidence_ids: string[];
  model: string;
}


/* ======================================================= journey (GET /projects/{id}/journey) */
export type JourneyStageKey = 'brief' | 'audience' | 'explore' | 'strategy' | 'create' | 'export';
export type JourneyStatus = 'done' | 'active' | 'attention' | 'todo';
export interface JourneyNextAction {
  label: string;
  /** absolute app path, may carry a #anchor */
  to: string;
  why: string;
  decision_run_id?: string;
  /** an in-page action instead of navigation, e.g. "open_console" */
  action?: 'open_console' | string;
  secondary?: { label: string; action: 'duplicate' | string };
}
export interface JourneyResponse {
  project_id: string;
  locked: boolean;
  current: JourneyStageKey;
  last_completed: string | null;
  stages: {
    key: JourneyStageKey;
    label: string;
    path: string;
    status: JourneyStatus;
    summary: string;
    blockers: { message: string; to: string; fix: string }[];
  }[];
  next_action: JourneyNextAction | null;
  context: { run_id: string | null; run_status: string | null; product_version: number | null };
}

/* ======================================================= Feature A: taste story */
export type EdgeKind = 'qloo_explainability' | 'qloo_combined_set' | 'app_derived' | 'generated_hypothesis';
export interface EvidenceBrief {
  id: string;
  kind: string;
  nature: string;
  topic: string;
  title: string;
  status: string;
  source: string;
  retrieved_at: ISO | null;
  badge: string;
}
export interface StoryInterest {
  id: string | null;
  entity_row_id?: string;
  label: string;
  query_text: string;
  status: string;
  type: string | null;
  is_tag: boolean;
  proxy_for: string | null;
  used_as_signal: boolean;
}
export interface CitySignal {
  state: 'available' | 'sparse' | 'empty' | 'missing' | string;
  reason?: string;
  lift?: number | null;
  log2_lift?: number | null;
  n_signal?: number;
  n_baseline?: number;
  evidence_id?: string;
  retrieved_at?: ISO | null;
  formula?: string;
  meaning?: string;
}
export interface StoryRecommendation {
  id: string;
  qloo_id: string | null;
  name: string;
  category: string;
  affinity: number;
  affinity_rank: number;
  of: number;
  popularity: number | null;
  distance_m: number | null;
  retrieved_at: ISO | null;
  accessibility: string;
  explanation: {
    audience_version_id: string;
    run_id: string;
    signal_ids: string[];
    candidate_id: string | null;
    evidence_ids: string[];
    query_fingerprint: string | null;
    retrieved_at: ISO | null;
    status: 'provided' | 'not_provided' | 'not_matched' | string;
    contributions: { id: string; score?: number | null; name?: string; [k: string]: unknown }[] | null;
    warnings: string[];
  };
}
export interface StoryEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  score?: number | null;
  cites?: boolean;
  evidence_ids: string[];
}
export interface TasteStory {
  run_id: string;
  area: { id: string; name: string | null };
  audience: { id: string; name: string | null; role: string | null };
  qloo_enabled: boolean;
  focus_place_id?: string;
  focus_note?: string;
  state: 'complete' | 'partial' | 'no_signals' | 'no_recommendations' | 'qloo_disabled';
  message: string | null;
  attribution: 'per_input' | 'combined_set' | null;
  interests: StoryInterest[];
  city_signal: CitySignal;
  recommendations: StoryRecommendation[];
  placement: {
    id: string;
    name: string;
    place_id: string;
    category: string;
    shortlisted: boolean;
    suitability: number | null;
    formula: string;
    status: string;
    verification: Record<string, string>;
    accessibility: string;
    next_action: string;
    evidence_needed: string;
    practical_evidence_ids: string[];
  } | null;
  hypothesis: {
    strategy_id: string;
    version?: number;
    generated: true;
    note: string;
    positioning: string | null;
    main_feature_key: string | null;
    message: string | null;
    message_evidence_ids: string[];
    pilot_objective: string | null;
    generator: string | null;
    model: string | null;
    from_this_run: boolean;
  } | null;
  creative: {
    brief_id: string;
    language: string;
    headline: string | null;
    decision: { text: string | null; rationale: string | null; kind: string | null; evidence_ids: string[] };
    preview_url: string | null;
    preview_stale: boolean | null;
    generated: true;
  } | null;
  edges: StoryEdge[];
  warnings: string[];
  legend: Record<EdgeKind, string>;
  evidence: Record<string, EvidenceBrief>;
  unknown_evidence_ids: string[];
}

/* ======================================================= Feature C: audience compare */
export interface CompareSide {
  audience: { id: string; name: string; role: string; needs?: string[]; languages?: string[] };
  interests: StoryInterest[];
  city_signal: CitySignal;
  shortlist: { placement_id: string; place_id: string | null; name: string; category: string; rank: number; suitability: number | null; affinity: number | null; shortlisted: boolean }[];
  strategy: { id: string; positioning: string | null; main_feature_key: string | null; message: string | null; generated: true } | null;
}
export interface AudienceCompare {
  run_id: string;
  area: { id: string; name: string };
  shared: { product_version: number | null; constraints_version: number | null; ad_spend_budget: number | null; note: string };
  a: CompareSide;
  b: CompareSide;
  differences: {
    only_a: string[];
    only_b: string[];
    both: { name: string; rank_a: number; rank_b: number }[];
    interests_only_a: string[];
    interests_only_b: string[];
    main_feature_changed: boolean;
  };
  changed: boolean;
  summary: string;
}

/* ======================================================= revision preview */
export interface RevisionPreview {
  kind: string;
  summary: string;
  affected: Record<string, unknown>;
  preserved: Record<string, unknown>;
  cost_if_applied: string;
  writes: string;
  provider_calls?: string;
}

/* ======================================================= Feature D: creative trace */
export interface CreativeTrace {
  brief_id: string;
  version: number;
  language: string;
  channel: string;
  copy: { headline: string | null; body: string | null; cta: string | null; disclaimer: string | null };
  translation_status: string;
  chain: {
    product_fact: {
      feature_key: string | null;
      name: string | null;
      mechanism: string | null;
      evidence_status: string | null;
      source: string | null;
      nature: 'product_fact';
      operating_conditions: string | null;
    };
    strategy: {
      id: string | null;
      positioning: string | null;
      main_feature_rationale: string | null;
      rationale_evidence: EvidenceBrief[];
      key_messages: { text: string; evidence: EvidenceBrief[] }[];
      generated: true;
      generator?: string | null;
    };
    decisions: { decision: string; rationale: string; nature: 'evidence' | 'generated_hypothesis'; evidence: EvidenceBrief[] }[];
    approved_claims: { id: string; text: string; support_status: string; feature_key: string | null }[];
  };
  pilot_card: {
    label: string;
    audience: { name: string | null; role: string | null };
    area: string | null;
    placement: { id: string; name: string; status: string; next_action: string } | null;
    message: string | null;
    measurement: { metric: string | null; target_to_test: string | null; objective: string | null; duration_weeks: number | null };
    results_recorded: number;
    results_note: string;
  };
  variants: { brief_id: string; audience: string | null; language: string; headline: string | null; strategy_version_id?: string; same_audience: boolean }[];
  unknown_evidence_ids: string[];
}

/* ======================================================= Feature E: opportunities */
export interface Opportunity {
  placement_id: string;
  name: string;
  category: string;
  area: string | null;
  area_id: string;
  audience: { id: string; name: string | null };
  signal: {
    affinity: number | null;
    affinity_rank_in_candidates: number | null;
    relative_affinity_score: number | null;
    affinity_rank: number | null;
    affinity_rank_of: number | null;
    popularity: number | null;
    meaning: string;
  };
  constraints: { unknown: string[]; accessibility: string; status: string; distance_m: number | null };
  pilot_proposal: { generated_from_template: true; text: string };
  next_action: string;
}

/* ======================================================= Feature B: experiment analysis */
export interface ExperimentAnalysis {
  id: string;
  recorded_at: ISO;
  baseline: { run_id: string; snapshot_at: ISO };
  conditions: { held_constant: string[]; varied: string; model?: string; product_version_id?: string; constraint_version_id?: string; [k: string]: unknown };
  validity: {
    valid: boolean;
    practical_evidence_identical: boolean;
    mismatches: unknown[];
    pinned_to_baseline: boolean;
    snapshot_differences: string[];
    confounders: string[];
  };
  practical_evidence_identical: boolean;
  locations: {
    area_id: string;
    area: string;
    with_qloo: { eligible: boolean; status: string; rank: number | null; planning_index: number | null; cultural_state: string | null; cultural_log2_lift: number | null } | null;
    without_qloo: { eligible: boolean; status: string; practical_rank: number | null; practical_index: number | null; note?: string } | null;
    hard_constraints_identical: boolean;
  }[];
  location_order: { with_qloo: string[]; without_qloo_practical: string[]; changed: boolean };
  ranking_only: { area: string; audience_version_id: string; candidates: number; with_qloo_affinity: number; kendall_tau: number | null; practical_top3: string[]; taste_top3: string[]; changed: boolean }[];
  discovery: { area: string; audience_version_id: string; added_by_qloo: string[]; no_longer_shortlisted: string[]; jaccard_overlap: number | null; qloo_sourced: number }[];
  feature_emphasis: ({ area: string; audience_version_id: string; with_qloo: string | null; without_qloo: string | null } | { note: string })[];
  cost_latency: {
    with_qloo: { cost_usd: number | null; latency_s: number | null; qloo?: unknown };
    without_qloo: { cost_usd: number | null; latency_s: number | null };
  };
  verdict: 'material change' | 'no material change' | string;
  blinded: { A: Record<string, string[]>; B: Record<string, string[]>; mapping: Record<string, string> | null; ratings?: Record<string, unknown> } | null;
  notes: string[];
}

/* ======================================================= floating assistant (POST /assistant/chat) */
export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface QlooLookup {
  interest: string;
  target_type: string;
  city: string | null;
  signal: { name: string; type: string; id: string } | null;
  results: { name: string; affinity: number | null; popularity: number | null; address: string | null }[];
  note: string | null;
}
export interface AssistantReply {
  answer: string;
  used_qloo: boolean;
  qloo: QlooLookup[];
  links: { label: string; to: string }[];
  suggestions: string[];
  model: string;
  qloo_calls?: Record<string, unknown>;
  /** a verified step-by-step guide with annotated screenshots, when the question is "how do I …" */
  howto?: HowTo | null;
}
export interface HowTo {
  key: string;
  title: string;
  needs: string | null;
  steps: { n: number; text: string; to: string | null; image: string }[];
}
