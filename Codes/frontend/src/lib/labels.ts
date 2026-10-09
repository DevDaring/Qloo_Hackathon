import type { AudienceRole } from '../api/types';

export const STAGES: { key: string; label: string; short: string; decision?: boolean }[] = [
  { key: 'intake_validator', label: 'Intake validator', short: 'Intake' },
  { key: 'research_planner', label: 'Research planner', short: 'Plan' },
  { key: 'entity_resolver', label: 'Entity resolver (Qloo)', short: 'Entities' },
  { key: 'geographic_researcher', label: 'Geographic researcher', short: 'Places' },
  { key: 'taste_analyst', label: 'Taste analyst (Qloo)', short: 'Taste' },
  { key: 'market_evaluator', label: 'Market evaluator', short: 'Evaluate' },
  { key: 'placement_researcher', label: 'Placement researcher', short: 'Placements' },
  { key: 'await_selection', label: 'Your choice: targets', short: 'Select', decision: true },
  { key: 'strategy_writer', label: 'Strategy writer', short: 'Strategy' },
  { key: 'creative_planner', label: 'Creative planner', short: 'Briefs' },
  { key: 'await_creative', label: 'Your choice: scope & cap', short: 'Approve', decision: true },
  { key: 'image_producer', label: 'Image producer (xAI)', short: 'Flyers' },
  { key: 'video_producer', label: 'Video producer (xAI)', short: 'Video' },
  { key: 'quality_reviewer', label: 'Quality reviewer', short: 'Review' },
  { key: 'exporter', label: 'Exporter', short: 'Export' },
];

export const ROLE_LABEL: Record<AudienceRole | string, string> = {
  product_user: 'Product user',
  purchaser: 'Purchaser',
  institutional_buyer: 'Institutional buyer',
  distribution_partner: 'Distribution partner',
};

export const LANG_LABEL: Record<string, string> = { en: 'English', hi: 'हिन्दी Hindi', bn: 'বাংলা Bengali' };

export const PLACE_ROLE_LABEL: Record<string, string> = {
  competitor: 'Competitor',
  partner: 'Potential partner',
  venue: 'Demo venue',
  institution: 'Institution',
};

export const PLACE_ROLE_COLOR: Record<string, string> = {
  competitor: '#E5484D',
  partner: '#1F6FEB',
  venue: '#FF7A45',
  institution: '#12A594',
};

export const PLACEMENT_STATUS: Record<string, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'bad' }> = {
  candidate: { label: 'Candidate', tone: 'neutral' },
  availability_unknown: { label: 'Availability unknown', tone: 'warn' },
  verified_opportunity: { label: 'Verified opportunity', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

/** Evidence badges with the plain-language meaning shown in tooltips. */
export const EVIDENCE_BADGES: Record<string, { label: string; meaning: string; cls: string; dot: string }> = {
  Supported: {
    label: 'Supported',
    meaning: 'An observed fact or measurement retrieved from a named source, with date, geography and units.',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
    dot: 'bg-emerald-500',
  },
  'Owner-provided': {
    label: 'Owner-provided',
    meaning: 'Supplied by you (product specs, prices, service areas). True as stated by the owner, not independently verified.',
    cls: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900',
    dot: 'bg-indigo-500',
  },
  'Provider signal': {
    label: 'Provider signal (Qloo)',
    meaning: 'A Qloo taste/affinity signal kept with its provider meaning. Relative taste — not demand, footfall or purchase probability.',
    cls: 'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
    dot: 'bg-violet-500',
  },
  Derived: {
    label: 'Derived',
    meaning: 'A reproducible calculation (distance, budget split, rank) with a stated formula and referenced inputs.',
    cls: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900',
    dot: 'bg-sky-500',
  },
  Hypothesis: {
    label: 'Hypothesis',
    meaning: 'An interpretation or strategy idea that still needs to be tested. Not proof.',
    cls: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
    dot: 'bg-amber-500',
  },
  Demo: {
    label: 'Demo',
    meaning: 'Explicitly labelled synthetic demonstration data. Never presented as live data.',
    cls: 'bg-pink-50 text-pink-800 border-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:border-pink-900',
    dot: 'bg-pink-500',
  },
  Unknown: {
    label: 'Unknown',
    meaning: 'No evidence exists for this. Unknown is not zero — it is a gap to fill.',
    cls: 'bg-slate-50 text-slate-700 border-dashed border-slate-300 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-600',
    dot: 'bg-slate-400',
  },
  Stale: {
    label: 'Stale',
    meaning: 'An input this depends on has changed since it was produced. Regenerate before relying on it.',
    cls: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900',
    dot: 'bg-orange-500',
  },
  'Needs review': {
    label: 'Needs review',
    meaning: 'Automated checks passed or were inconclusive; a person must review before approval. Nothing is auto-approved.',
    cls: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900',
    dot: 'bg-blue-500',
  },
};

export const KIND_TO_BADGE: Record<string, string> = {
  observed_fact: 'Supported',
  owner_fact: 'Owner-provided',
  provider_signal: 'Provider signal',
  derived_metric: 'Derived',
  hypothesis: 'Hypothesis',
  synthetic_fixture: 'Demo',
  data_gap: 'Unknown',
  supported: 'Supported',
  unknown: 'Unknown',
};

export const AUDIO_STATE_LABEL: Record<string, string> = {
  silent_captioned: 'Silent · captioned',
  narration_tts_needs_review: 'TTS narration · needs review',
  licensed_audio_supplied: 'Licensed audio supplied',
};

export const PRESETS: { key: 'square' | 'portrait' | 'vertical'; label: string; w: number; h: number }[] = [
  { key: 'square', label: 'Square', w: 1080, h: 1080 },
  { key: 'portrait', label: 'Portrait', w: 1080, h: 1350 },
  { key: 'vertical', label: 'Vertical', w: 1080, h: 1920 },
];

export const ANGLES = ['fan_comfort', 'speech_presence', 'institutional_brief', 'distributor_intro'] as const;
