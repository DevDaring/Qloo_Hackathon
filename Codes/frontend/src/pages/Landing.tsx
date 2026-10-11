import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Brain,
  CloudSun,
  Download,
  Film,
  Fingerprint,
  Globe2,
  Layers,
  MapPinned,
  Package,
  Play,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Users,
  Workflow,
} from 'lucide-react';
import { usePublicConfig } from '../api/hooks';
import { IntroFallback } from '../components/intro/IntroFallback';
import { GlobePoster, Starfield } from '../components/intro/IntroOverlays';
import { Reveal, RevealLi, useReveal } from '../components/Reveal';
import { Logo } from '../components/Logo';
import { EVIDENCE_BADGES } from '../lib/labels';
import { cn } from '../lib/format';
import { ThemeToggle } from '../components/ThemeToggle';

const STEPS = [
  { icon: Package, title: 'Describe product', body: 'Structured facts, features, prohibited exaggerations and open questions — versioned.' },
  { icon: MapPinned, title: 'Discover places', body: 'Candidate cities, retrieved businesses, climate evidence and hard service constraints.' },
  { icon: Users, title: 'Understand audiences', body: 'Users, purchasers, institutions and partners — with Qloo taste signals where available.' },
  { icon: Store, title: 'Pick placements', body: 'Partners, venues and digital options, each with verification still to do.' },
  { icon: Film, title: 'Generate flyers & video', body: 'Grok Imagine imagery from xAI (NanoGPT and OpenRouter as backups), deterministic typography, real MP4s with captions — within your cap.' },
  { icon: Download, title: 'Export with evidence', body: 'A campaign package with strategy, evidence summary, assets and a manifest.' },
];

const POWERED = [
  { icon: Fingerprint, name: 'Qloo Taste AI' },
  { icon: Brain, name: 'OpenAI' },
  { icon: Sparkles, name: 'xAI Grok Imagine' },
  { icon: Globe2, name: 'OpenStreetMap' },
  { icon: CloudSun, name: 'Open-Meteo' },
  { icon: Workflow, name: 'LangGraph' },
];

const BADGE_ORDER = ['Supported', 'Owner-provided', 'Provider signal', 'Derived', 'Hypothesis', 'Unknown'];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#FBFBFD] text-fg dark:bg-transparent">
      <TopNav />
      <Hero />
      <HowItWorks />
      <EvidenceModel />
      <Principles />
      <PoweredBy />
      <CTA />
      <Footer />
    </div>
  );
}

function TopNav() {
  const { scrollY } = useScroll();
  const [overHero, setOverHero] = useState(true);
  useMotionValueEvent(scrollY, 'change', (v) => {
    const h = document.getElementById('hero')?.offsetHeight ?? 800;
    setOverHero(v < h - 72);
  });
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl transition-colors duration-300',
        overHero ? 'border-white/10 bg-[#060A14]/40' : 'border-line bg-[#FBFBFD]/85 dark:border-white/10 dark:bg-[#02040a]/70',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="LaunchLens home">
          <Logo inverted={overHero} />
        </Link>
        <nav className={cn('hidden items-center gap-7 text-sm font-medium md:flex', overHero ? 'text-white/75' : 'text-muted')} aria-label="Sections">
          <a href="#how" className={overHero ? 'hover:text-white' : 'hover:text-fg'}>How it works</a>
          <a href="#evidence" className={overHero ? 'hover:text-white' : 'hover:text-fg'}>Evidence model</a>
          <a href="#powered" className={overHero ? 'hover:text-white' : 'hover:text-fg'}>Powered by</a>
        </nav>
        <div className="flex items-center gap-2.5">
        <ThemeToggle onDark={overHero} />
        <Link
          to="/login"
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-medium transition active:scale-[0.97]',
            overHero ? 'bg-white text-[#0E1320] hover:bg-white/90' : 'bg-ink text-white shadow-[0_6px_16px_-6px_rgb(14_19_32/0.5)] hover:bg-ink/90 dark:bg-white dark:text-[#0E1320]',
          )}
        >
          Sign in <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero */
const GlobeIntro = lazy(() => import('../components/intro/GlobeIntro'));
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/dark';

function HeroVisual() {
  const cfg = usePublicConfig();
  const [fallback, setFallback] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const on = () => setCompact(window.innerWidth < 768);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // use the configured OpenFreeMap host, but its colourful "liberty" style reads better as a globe
  const styleUrl = cfg.data?.mapStyleUrl ? cfg.data.mapStyleUrl.replace(/\/styles\/[a-z]+$/, '/styles/dark') : cfg.isError ? DEFAULT_STYLE : null;
  if (fallback) return <IntroFallback compact={compact} />;
  if (!styleUrl) return <PlaceholderGlobe />;
  return (
    <Suspense fallback={<PlaceholderGlobe />}>
      <GlobeIntro styleUrl={styleUrl} onFallback={(why) => setFallback(why)} />
    </Suspense>
  );
}

function PlaceholderGlobe() {
  return <GlobePoster />;
}

function Hero() {
  // reduced motion: everything in the hero is rendered in place immediately
  const still = useReducedMotion();
  return (
    <section id="hero" className="relative isolate flex flex-col overflow-hidden bg-[#060A14] pt-16 text-white lg:block lg:h-[100svh] lg:max-h-[1000px] lg:min-h-[760px] lg:pt-0">
      <Starfield />
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[#FF7A45]/20 blur-[130px]" />
        <div className="absolute -bottom-40 right-[-80px] h-[620px] w-[620px] rounded-full bg-[#1F6FEB]/25 blur-[140px]" />
      </div>
      {/* the visual: full-bleed behind the text on desktop, a block above the text on phones */}
      <div className="relative h-[470px] w-full sm:h-[540px] lg:absolute lg:inset-0 lg:h-auto">
        <HeroVisual />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-[58%] bg-gradient-to-r from-[#060A14] via-[#060A14]/90 to-transparent lg:block" />
      <div className="pointer-events-none relative z-10 mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:flex lg:h-full lg:items-center lg:pb-0">
        <div className="pointer-events-auto lg:max-w-[560px]">
          <motion.div
            initial={still ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] py-1 pl-1 pr-3 text-[12.5px] font-medium text-white/75 backdrop-blur"
          >
            <span className="shrink-0 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0E1320]">Qloo Agentic Hackathon</span>
            Launch planning with visible evidence
          </motion.div>
          <h1 className="font-display text-[40px] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-6xl lg:text-[62px]">
            {['Find where your', 'product fits.'].map((line, i) => (
              <motion.span
                key={line}
                className="block"
                initial={still ? false : { opacity: 0, y: 28, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                {line}
              </motion.span>
            ))}
            <motion.span
              className="block bg-gradient-to-r from-[#FF8A5B] via-[#FF6F91] to-[#7FB2FF] bg-clip-text pb-1 text-transparent"
              initial={still ? false : { opacity: 0, y: 28, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.36, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              Prove why. <span className="whitespace-nowrap">Ship the ads.</span>
            </motion.span>
          </h1>
          <motion.p
            initial={still ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/70"
          >
            LaunchLens turns a product brief into a launch plan — from global taste signals down to the cities, people and placements that matter — then produces audience-specific
            flyers and video ads. Every recommendation links to evidence you can inspect.
          </motion.p>
          <motion.div initial={still ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.45 }} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/login"
              className="group inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-[#FF8A5B] to-[#FF6A2F] px-6 text-[15px] font-semibold text-[#1A0E08] shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_14px_30px_-10px_rgb(255_106_47/0.75)] transition hover:brightness-105 active:scale-[0.97]"
            >
              Open the jury demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-5 text-[15px] font-medium text-white backdrop-blur transition hover:border-white/40 hover:bg-white/10 active:scale-[0.97]"
            >
              <Play className="h-4 w-4" /> See how it works
            </a>
          </motion.div>
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.95 }} className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/70">
            {['Hard constraints before taste', 'Unknown is never zero', 'Nothing bought or sent automatically'].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-emerald-400" /> {t}
              </li>
            ))}
          </motion.ul>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const line = useReveal<HTMLDivElement>();
  return (
    <section id="how" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead eyebrow="How it works" title="From product brief to campaign package — in six honest steps" sub="One LangGraph workflow with checkpoints that belong to you: pick targets, then approve what gets generated and a spending cap." />
        <div ref={line.ref} className="relative mt-14">
          <svg className="pointer-events-none absolute left-0 right-0 top-[38px] hidden h-2 w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
            <motion.line
              x1="8"
              y1="1"
              x2="92"
              y2="1"
              stroke="url(#howg)"
              strokeWidth="0.25"
              strokeDasharray="1 1"
              initial={line.animateIn ? { pathLength: 0 } : false}
              animate={{ pathLength: line.shown ? 1 : 0 }}
              transition={{ duration: 1.6, ease: 'easeInOut' }}
            />
            <defs>
              <linearGradient id="howg">
                <stop offset="0" stopColor="#FF7A45" />
                <stop offset="1" stopColor="#1F6FEB" />
              </linearGradient>
            </defs>
          </svg>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
            {STEPS.map((s, i) => (
              <RevealLi
                key={s.title}
                hidden={{ opacity: 0, y: 24 }}
                show={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="group relative"
              >
                <div className="relative mx-auto mb-4 flex h-[76px] w-[76px] items-center justify-center lg:mx-0">
                  <span className="absolute inset-0 rounded-[22px] bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] opacity-20 blur-md transition group-hover:opacity-50" />
                  <span className="relative flex h-full w-full items-center justify-center rounded-[22px] border border-line bg-white shadow-card transition group-hover:-translate-y-1 group-hover:shadow-lift dark:bg-surface">
                    <s.icon className="h-7 w-7 text-fg" strokeWidth={1.6} />
                  </span>
                  <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink font-display text-[11px] font-bold text-white dark:bg-white dark:text-[#0E1320]">
                    {i + 1}
                  </span>
                </div>
                <h3 className="text-center font-display text-[15.5px] font-bold lg:text-left">{s.title}</h3>
                <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-muted lg:text-left">{s.body}</p>
              </RevealLi>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ evidence model */
function EvidenceModel() {
  return (
    <section id="evidence" className="relative scroll-mt-20 overflow-hidden bg-[#0E1320] py-20 text-white sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/4 h-[460px] w-[460px] animate-mesh rounded-full bg-[#FF7A45]/20 blur-[120px]" />
        <div className="absolute -bottom-40 right-1/4 h-[460px] w-[460px] animate-mesh rounded-full bg-[#1F6FEB]/25 blur-[120px] [animation-delay:-8s]" />
      </div>
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead dark eyebrow="The evidence model" title="Every claim wears its badge" sub="Six kinds of evidence are kept distinct in storage, reasoning, charts, exports and every screen. Tap any badge in the app for its plain-language meaning." />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BADGE_ORDER.map((k, i) => {
            const b = EVIDENCE_BADGES[k];
            return (
              <Reveal
                key={k}
                hidden={{ opacity: 0, y: 24, scale: 0.96 }}
                show={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * 0.08, type: 'spring', stiffness: 160, damping: 18 }}
                whileHover={{ y: -4 }}
                className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur transition hover:border-white/25 hover:bg-white/[0.07]"
              >
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold', b.cls)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', b.dot)} />
                  {b.label}
                </span>
                <p className="mt-3 text-[14px] leading-relaxed text-white/75">{b.meaning}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Principles() {
  const items = [
    { icon: ShieldCheck, title: 'Hard constraints first', body: 'A high-affinity city outside your service area is excluded — taste never overrides a failed constraint.' },
    { icon: Layers, title: 'Incomplete stays incomplete', body: 'Missing components are shown as missing. A provisional index shows its available weight and is never silently renormalised.' },
    { icon: ScanSearch, title: 'Nothing auto-approved', body: 'Flyers and videos get dimension, contrast, safe-area, claim and fidelity checks — then wait for a human.' },
    { icon: Target, title: 'KPIs are targets to test', body: 'Strategies propose pilots and hypotheses, not promised outcomes. Imported results stay separate from plans.' },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHead eyebrow="Built to be trusted" title="Planning aids that show their working" />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal
              key={it.title}
              hidden={{ opacity: 0, y: 20 }}
              show={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.6 }}
              className="card card-hover p-6"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-accent-soft">
                <it.icon className="h-5 w-5 text-brand-ink" />
              </span>
              <h3 className="mt-4 font-display text-[16px] font-bold">{it.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{it.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function PoweredBy() {
  const row = [...POWERED, ...POWERED];
  return (
    <section id="powered" className="scroll-mt-20 border-y border-line bg-white/60 py-12 dark:bg-surface/40">
      <p className="eyebrow mb-6 text-center">Powered by</p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="flex w-max animate-marquee gap-4 hover:[animation-play-state:paused]">
          {row.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-5 py-3 font-display text-[15px] font-semibold shadow-card">
              <p.icon className="h-5 w-5 text-brand-ink" /> {p.name}
            </span>
          ))}
        </div>
      </div>
      <p className="mx-auto mt-6 max-w-2xl px-4 text-center text-xs text-subtle">
        Provider names identify integrations and data sources; they do not imply endorsement. Each provider's readiness (configured, reachable, authorized, operations) is shown live on
        the Settings / status page.
      </p>
    </section>
  );
}

function CTA() {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28">
      <Reveal
        hidden={{ opacity: 0, y: 24 }}
        show={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="relative mx-auto max-w-5xl overflow-hidden rounded-[32px] bg-[#0E1320] px-6 py-14 text-center text-white shadow-lift sm:px-14"
      >
        <div aria-hidden className="absolute inset-0">
          <div className="absolute -left-20 -top-20 h-72 w-72 animate-mesh rounded-full bg-[#FF7A45]/40 blur-[90px]" />
          <div className="absolute -bottom-24 -right-10 h-80 w-80 animate-mesh rounded-full bg-[#1F6FEB]/40 blur-[90px] [animation-delay:-7s]" />
        </div>
        <div className="relative">
          <Bot className="mx-auto h-10 w-10 text-[#FFB088]" strokeWidth={1.5} />
          <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">See the sample IoT-wheelchair launch</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/70">
            Kolkata, New Delhi and Chennai — three audiences, a service-area exclusion, placements to verify, and evidence on every card. Jury credentials are on the sign-in page.
          </p>
          <Link
            to="/login"
            className="group mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-[#0E1320] shadow-[0_14px_30px_-10px_rgb(255_255_255/0.4)] transition hover:bg-white/90 active:scale-[0.97]"
          >
            Sign in with jury access <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 text-center sm:px-6 md:flex-row md:text-left">
        <Logo />
        <p className="max-w-xl text-[13px] text-muted">
          Recommendations are planning aids, not guarantees. No ads are bought or sent automatically.
          <span className="mt-1 block text-[11.5px] text-subtle">Built for the Qloo Agentic Hackathon.</span>
          <span className="mt-1 block text-[11.5px] text-subtle">Illustrations of people: AI-generated (xAI). Ads shown are real outputs from the synthetic sample project. Globe imagery: NASA Blue Marble &amp; Black Marble (NASA EOSDIS GIBS); map data © OpenStreetMap contributors · OpenFreeMap.</span>
        </p>
        <p className="text-xs text-subtle">Map data © OpenStreetMap contributors</p>
      </div>
    </footer>
  );
}

function SectionHead({ eyebrow, title, sub, dark }: { eyebrow: string; title: string; sub?: string; dark?: boolean }) {
  return (
    <Reveal hidden={{ opacity: 0, y: 16 }} show={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="mx-auto max-w-3xl text-center">
      <p className={cn('mb-3 text-[12px] font-bold uppercase tracking-[0.16em]', dark ? 'text-[#FFB088]' : 'text-brand-ink')}>{eyebrow}</p>
      <h2 className={cn('font-display text-3xl font-extrabold tracking-tight sm:text-[42px] sm:leading-[1.1]', dark && 'text-white')}>{title}</h2>
      {sub && <p className={cn('mt-4 text-[16px] leading-relaxed', dark ? 'text-white/65' : 'text-muted')}>{sub}</p>}
    </Reveal>
  );
}
