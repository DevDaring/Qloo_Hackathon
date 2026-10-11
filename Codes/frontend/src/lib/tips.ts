/**
 * Hover / focus explanations, in plain US English. One registry for the whole app:
 * elements opt in with `data-tip="<key>"` (or the <Tip k="…"> wrapper), and the
 * global TipLayer renders the card. Showing a tip never triggers the action.
 */
export interface TipEntry {
  title?: string;
  body?: string;
  /** a feature added for the judges' review */
  isNew?: boolean;
  /** what clicking does — so nobody has to click to find out */
  click?: string;
}

export const TIPS: Record<string, TipEntry> = {
  /* ------------------------------------------------ guide & shell */
  'project-guide': {
    title: 'Project guide',
    body: 'A step-by-step tour of every feature using the US sample. It moves between pages for you and highlights what matters on each one.',
    isNew: true,
    click: 'Starts the tour. You can skip it at any time with Esc.',
  },
  'theme-toggle': {
    title: 'Light or dark theme',
    body: 'Switches the whole app between light and dark. Your choice is remembered on this device.',
    click: 'Changes the theme instantly. Nothing about your project changes.',
  },
  locked: {
    title: 'Read-only sample',
    body: 'Everyone sees the same results here, so the sample can’t be edited. A copy keeps the inputs and decisions and is fully yours.',
  },
  duplicate: {
    title: 'Duplicate to edit',
    body: 'Copies this sample’s product facts, claims, media, cities, audiences and resolved Qloo interests into a new project you can change.',
    isNew: true,
    click: 'Creates your copy and opens it. Research isn’t copied — re-running it reuses cached provider data.',
  },

  assistant: {
    title: 'Ask LaunchLens',
    body: 'Ask LaunchLens — app help and marketing answers grounded in Qloo taste data. It can look up what fans of an artist, brand or show also like, and where they go in a city.',
    isNew: true,
    click: 'Opens the chat on the right. It only reads — it never changes your project or spends on media.',
  },
  'qloo-affinity': {
    title: 'Qloo affinity',
    body: 'How strongly fans of the interest relate to this result, relative to the other results in the same list. It is not demand, sales or audience size. Popularity is a separate, general number.',
  },

  /* ------------------------------------------------ research */
  'start-research': {
    title: 'Start research',
    body: 'Find places and audience matches for your selected cities: places and climate evidence for each city, plus the venues Qloo matches to each audience’s tastes.',
    click: 'Starts a research run. No images or videos are generated and nothing is bought.',
  },
  'view-taste-layer': {
    title: 'Taste layer (Qloo heatmap)',
    body: 'Shades the map by relative taste affinity for the selected audience. It is a relative signal, not demand or foot traffic.',
    click: 'Loads the heatmap for the city on screen.',
  },
  'qloo-changed': {
    title: 'See what Qloo changed',
    body: 'Compare this research snapshot with a practical baseline — the same run without Qloo taste signals — to see exactly what Qloo added: city order, venues found, ranking and messaging.',
    isNew: true,
    click: 'Opens the side-by-side comparison. Nothing is re-run.',
  },
  'why-places': {
    title: 'Why these places?',
    body: 'Follows one audience in one city: their interests, the places Qloo recommends, the placement chosen, the campaign hypothesis and the ad it led to.',
    isNew: true,
    click: 'Shows the story. Every Qloo link opens its evidence.',
  },
  'why-place': {
    title: 'Why this place?',
    body: 'Explains why Qloo recommended this venue for an audience — its affinity rank, popularity (a separate number) and what is still unknown before booking.',
    isNew: true,
    click: 'Opens the explanation in a side panel.',
  },
  'compare-audiences': {
    title: 'Compare two audiences',
    body: 'Same city, same practical evidence, same budget — only the audience changes. Shows which venues, interests and messages differ.',
    isNew: true,
    click: 'Switches to the two-column comparison.',
  },
  'taste-lift': {
    title: 'Taste lift in this city',
    body: 'How much more often this city shows up among places Qloo recommends for these interests than among places returned with no interests. 2× means twice as often. A relative signal, not demand.',
  },
  'combined-set': {
    title: 'Recommended for the combined interest set',
    body: 'Qloo scored these places for all of the audience’s interests together and didn’t say which interest drove each one — so we don’t pretend to know.',
  },
  'qloo-attribution': {
    title: 'Qloo attribution',
    body: 'Qloo explained which of the audience’s inputs drove this recommendation.',
    click: 'Opens the Qloo evidence: source, date and scope.',
  },
  'generated-hypothesis': {
    title: 'Generated hypothesis',
    body: 'Proposed by a language model from the cited evidence. It is an idea to test in a pilot — not a Qloo fact and not a result.',
  },
  opportunities: {
    title: 'Underexplored opportunities',
    body: 'Venues with strong taste relevance that aren’t shortlisted yet. Affinity and popularity are shown separately; neither measures competition or whether a venue will partner.',
    isNew: true,
  },

  /* ------------------------------------------------ experiment validity */
  'validity-valid': {
    title: 'Valid comparison',
    body: 'Both runs used identical practical evidence (places, climate) copied from the same snapshot, so differences come from Qloo signals alone.',
  },
  'validity-invalid': {
    title: 'Not a clean comparison',
    body: 'Something other than Qloo differs between the two runs — the list explains what. Read the differences with care.',
  },
  'order-unchanged': {
    title: 'City order',
    body: 'Whether the ranking of eligible cities moved once taste signals were added. Hard constraints (like service coverage) are applied first in both runs.',
  },

  /* ------------------------------------------------ revisions */
  'revision-preview': {
    title: 'Preview the change',
    body: 'A dry run: lists what would be re-run or marked stale and what stays exactly as it is. Nothing is written.',
    isNew: true,
    click: 'Opens the before/after preview. You decide whether to apply it.',
  },
  'revision-apply': {
    title: 'Apply & re-run',
    body: 'Saves the change as a new version and starts a new research run. Earlier versions, strategies and creative stay available.',
    click: 'Applies the revision. Re-running research reuses cached provider data.',
  },

  /* ------------------------------------------------ creative */
  'why-message': {
    title: 'Why this message?',
    body: 'Traces the ad copy back through the creative decisions and the campaign hypothesis to the product fact and the evidence behind it.',
    isNew: true,
    click: 'Shows the trace next to the ad.',
  },
  'pilot-card': {
    title: 'Pilot hypothesis',
    body: 'Who to test with, where, what to measure and for how long. It is a plan — measured results live on the Results page and are never mixed in.',
    isNew: true,
  },
  'language-switch': {
    title: 'Audience & language variants',
    body: 'Each variant is its own ad for one audience in one language (English, Spanish, Hindi or Bengali). Machine translations are flagged for review.',
    click: 'Switches the studio to that variant.',
  },
  'generate-flyers': {
    title: 'Generate flyers',
    body: 'Creates the selected format: an AI background with the real product photo, logo and your exact copy composed on top. Every result needs your review.',
    click: 'Opens the cost review with a spending cap — nothing is spent until you confirm.',
  },
  'generate-video': {
    title: 'Generate video',
    body: 'Creates short video clips for each storyboard scene and assembles vertical and landscape versions with captions.',
    click: 'Opens the cost review — nothing is spent until you confirm.',
  },
  'regenerate-background': {
    title: 'Regenerate background',
    body: 'Replaces only the AI background; copy, product photo and layout stay the same.',
    click: 'Opens the cost review first.',
  },
  'build-package': {
    title: 'Build package',
    body: 'Download strategy, permitted evidence summaries and selected creative — one package with a manifest of file hashes.',
    click: 'Builds the package on the server. No new AI generation, no spending.',
  },

  /* ------------------------------------------------ evidence badges */
  'evidence-Supported': { title: 'Supported', body: 'An observed fact from a named source, with date, place and units.' },
  'evidence-Owner-provided': { title: 'Owner-provided', body: 'Supplied by the product owner (specs, prices, service areas). True as stated, not independently verified.' },
  'evidence-Provider signal': { title: 'Provider signal (Qloo)', body: 'A Qloo taste or affinity signal, kept with its provider meaning. Relative taste — not demand, foot traffic or purchase probability.' },
  'evidence-Derived': { title: 'Derived', body: 'A reproducible calculation (distance, budget split, rank) with a stated formula and inputs.' },
  'evidence-Hypothesis': { title: 'Hypothesis', body: 'An interpretation or strategy idea that still needs testing. Not proof.' },
  'evidence-Demo': { title: 'Demo', body: 'Synthetic demonstration data, always labelled as such.' },
  'evidence-Unknown': { title: 'Unknown', body: 'No evidence exists yet. Unknown is not zero — it is a gap to fill.' },
};
