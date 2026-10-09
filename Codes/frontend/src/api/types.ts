/** Response shapes hand-written from the Python serialisers
 * (backend/launchlens/api/deps.py, routes_*.py, services/*). Request bodies
 * use the generated OpenAPI types in schema.d.ts (see client.ts `Schemas`). */

export type ISO = string;
export type Lang = 'en' | 'hi' | 'bn';
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
