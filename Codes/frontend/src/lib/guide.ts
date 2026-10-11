/**
 * The project guide: a step-by-step tour through every feature of the US sample.
 * Each step names a route (relative to the sample project) and a `data-tour` anchor.
 * Copy is plain US English; "New" marks features added for this review.
 */
export interface GuideStep {
  id: string;
  /** route for the step; `pid` is the sample project id */
  path: (pid: string) => string;
  /** value of the data-tour attribute to spotlight */
  target: string;
  title: string;
  body: string;
  isNew?: boolean;
}

const base = (pid: string) => `/projects/${pid}`;

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'samples',
    path: () => '/projects',
    target: 'samples',
    title: 'Two ready-made samples',
    body: 'A US portable-speaker launch (New York, Phoenix, Houston) and an India wheelchair launch. Both are fully researched and read-only, so you can explore without changing anything. We’ll walk through the US sample.',
  },
  {
    id: 'journey',
    path: (p) => base(p),
    target: 'journey',
    title: 'The launch journey',
    body: 'Every project moves from Brief to Audience, Explore, Strategy, Create and Export. The bar shows where the project stands and the single next step that matters most.',
    isNew: true,
  },
  {
    id: 'brief',
    path: (p) => `${base(p)}/brief`,
    target: 'brief',
    title: 'Product brief',
    body: 'Facts, features and approved claims. Ads may only say what the brief supports — unsupported claims are blocked before anything is generated.',
  },
  {
    id: 'interests',
    path: (p) => `${base(p)}/audiences`,
    target: 'interests',
    title: 'Audiences and their interests',
    body: 'Each audience’s interests are resolved to real Qloo entities and tags. When there’s no good match, it says “not found” instead of guessing.',
  },
  {
    id: 'taste-story',
    path: (p) => `${base(p)}/audiences`,
    target: 'taste-story',
    title: 'Why these places?',
    body: 'Follow one audience in one city from their interests to the venues Qloo recommends, the placement, the campaign idea and the ad. Solid blue links are Qloo evidence; dashed purple ones are generated hypotheses.',
    isNew: true,
  },
  {
    id: 'audience-compare',
    path: (p) => `${base(p)}/audiences?view=compare`,
    target: 'audience-compare',
    title: 'Compare two audiences',
    body: 'Same city, same evidence, same budget — only the audience changes. Qloo’s taste signals are why the venue lists and messages differ.',
    isNew: true,
  },
  {
    id: 'explorer',
    path: (p) => `${base(p)}/explorer`,
    target: 'explorer',
    title: 'Market explorer',
    body: 'Every retrieved place on a map and in a list, with its source. Select a Qloo place and choose “Why this place?” to see its affinity rank and what’s still unknown.',
  },
  {
    id: 'locations',
    path: (p) => `${base(p)}/compare`,
    target: 'locations',
    title: 'Hard constraints first',
    body: 'Cities that fail a hard rule — like Houston, outside the launch partner’s service area — are excluded before any scoring. Eligible cities then get transparent component scores, including Qloo’s city taste lift.',
  },
  {
    id: 'impact',
    path: (p) => `${base(p)}/compare?view=impact`,
    target: 'impact',
    title: 'See what Qloo changed',
    body: 'The same research run with and without Qloo, with everything else held constant. It shows plainly whether the city order, the venues found and the messaging changed.',
    isNew: true,
  },
  {
    id: 'strategy',
    path: (p) => `${base(p)}/strategy`,
    target: 'strategy',
    title: 'Campaign strategy',
    body: 'Positioning, the feature to lead with, a pilot plan and the KPIs to test — each statement linked to its evidence or labeled as a hypothesis.',
  },
  {
    id: 'studio',
    path: (p) => `${base(p)}/studio`,
    target: 'studio',
    title: 'Ad studio',
    body: 'English and Spanish variants for each audience. “Why this message?” traces the copy back to the product fact and its evidence, and the pilot card says exactly what to test.',
    isNew: true,
  },
  {
    id: 'packages',
    path: (p) => `${base(p)}/assets`,
    target: 'packages',
    title: 'Assets & exports',
    body: 'Download a campaign package — strategy, evidence summaries and approved creative — with a manifest of file hashes. Building a package doesn’t generate anything new or spend money.',
  },
  {
    id: 'providers',
    path: (p) => `${base(p)}/settings`,
    target: 'providers',
    title: 'Honest service status',
    body: 'Plain-language health for Qloo and every other provider, including when a backup model is answering and what to do if something is down.',
  },
  {
    id: 'finish',
    path: (p) => base(p),
    target: 'locked-banner',
    title: 'Make it yours',
    body: 'The samples are read-only so every judge sees the same results. Duplicate one to edit the brief, audiences or cities and run your own research. Questions any time? The chat button at the bottom right answers app and marketing questions with Qloo data.',
  },
];
