import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  Boxes,
  ChevronsUpDown,
  FolderArchive,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Moon,
  Package,
  Scale,
  Sun,
  Target,
  Users,
  WandSparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { onUnauthorized } from '../api/client';
import { mutations, useMe, useProjects } from '../api/hooks';
import { cn } from '../lib/format';
import { useOnline, useTheme } from '../hooks/useTheme';
import { Logo } from './Logo';
import { useDialog } from './Overlay';
import { Badge, ErrorState, Skeleton } from './ui';

export const PROJECT_NAV = [
  { to: '', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: 'brief', label: 'Product brief', icon: Package },
  { to: 'explorer', label: 'Market explorer', icon: MapIcon },
  { to: 'compare', label: 'Location comparison', icon: Scale },
  { to: 'audiences', label: 'Audience insights', icon: Users },
  { to: 'strategy', label: 'Campaign strategy', icon: Target },
  { to: 'studio', label: 'Ad studio', icon: WandSparkles },
  { to: 'assets', label: 'Assets & exports', icon: FolderArchive },
  { to: 'results', label: 'Results', icon: BarChart3 },
  { to: 'settings', label: 'Settings / status', icon: Gauge },
];

export function AuthGate() {
  const me = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.removeQueries({ queryKey: ['me'] });
        nav(`/login?next=${encodeURIComponent(loc.pathname)}`, { replace: true });
      }),
    [nav, loc.pathname, qc],
  );
  if (me.isLoading)
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-[264px] border-r border-line bg-surface p-4 lg:block">
          <Skeleton className="h-9 w-40" />
          <div className="mt-8 space-y-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="mt-6 h-48 w-full" />
        </div>
      </div>
    );
  if (me.error) {
    const status = (me.error as { status?: number }).status;
    if (status === 401) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
    return (
      <div className="mx-auto max-w-lg p-10">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  return <AppShell />;
}

function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeDrawer = useCallback(() => setMobileOpen(false), []);
  const drawerRef = useDialog(mobileOpen, closeDrawer); // Escape, focus trap and focus restore
  const loc = useLocation();
  const online = useOnline();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  return (
    <div className="flex min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 border-r border-line bg-surface/80 backdrop-blur-xl lg:block">
        <Sidebar />
      </aside>
      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[70] lg:hidden">
            <motion.div className="absolute inset-0 bg-[#0E1320]/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-surface shadow-lift"
              aria-label="Navigation"
            >
              <button className="absolute right-3 top-4 rounded-lg p-1.5 text-muted hover:bg-surface2" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
              <Sidebar />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur-xl lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-muted hover:bg-surface2" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/projects">
            <Logo />
          </Link>
        </header>
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-1.5 text-xs font-medium text-warn">
            <WifiOff className="h-3.5 w-3.5" /> You are offline. Showing cached data; changes will fail until the connection returns. Jobs keep running on the server.
          </div>
        )}
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 pt-8 sm:px-6 lg:px-10">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const me = useMe().data;
  const projects = useProjects().data?.items ?? [];
  const match = useMatch('/projects/:pid/*');
  const pid = match?.params.pid;
  const project = projects.find((p) => p.id === pid);
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [switcher, setSwitcher] = useState(false);
  useEffect(() => {
    if (!switcher) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSwitcher(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switcher]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-3 pt-5">
        <Link to="/projects" aria-label="LaunchLens projects">
          <Logo />
        </Link>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
        <SideLink to="/projects" icon={FolderKanban} label="Projects" end />
        {pid && (
          <div className="mt-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => setSwitcher((s) => !s)}
                aria-expanded={switcher}
                className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-card transition hover:border-fg/20"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] text-white">
                  <Boxes className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="eyebrow block text-[10px]">Project</span>
                  <span className="block truncate text-[13px] font-semibold">{project?.name ?? 'Loading…'}</span>
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-subtle" />
              </button>
              <AnimatePresence>
                {switcher && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lift"
                  >
                    {projects.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={cn('w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface2', p.id === pid && 'font-semibold')}
                          onClick={() => {
                            setSwitcher(false);
                            nav(`/projects/${p.id}`);
                          }}
                        >
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
            <div className="mt-3 space-y-0.5">
              {PROJECT_NAV.map((n) => (
                <SideLink key={n.label} to={`/projects/${pid}${n.to ? `/${n.to}` : ''}`} icon={n.icon} label={n.label} end={n.end} />
              ))}
            </div>
          </div>
        )}
        {!pid && (
          <div className="mt-1">
            <SideLink to="/settings" icon={Gauge} label="Settings / status" />
          </div>
        )}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2 rounded-xl px-2 py-1.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-display text-xs font-bold text-white dark:bg-white dark:text-[#0E1320]">
            {(me?.user.display_name ?? 'U').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{me?.user.display_name}</span>
            <span className="block truncate text-[11px] text-subtle">
              {me?.workspace.name} {me?.workspace.is_demo && <Badge tone="brand" className="ml-1 !py-0 !text-[9.5px]">demo</Badge>}
            </span>
          </span>
          <button onClick={toggle} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={async () => {
              try {
                await mutations.logout();
              } finally {
                qc.clear();
                nav('/login');
              }
            }}
            className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SideLink({ to, icon: Icon, label, end }: { to: string; icon: typeof Package; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
          isActive ? 'text-fg' : 'text-muted hover:bg-surface2 hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="side-active"
              className="absolute inset-0 rounded-lg border border-line bg-surface2 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]"
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            />
          )}
          {isActive && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-[#FF7A45] to-[#1F6FEB]" />}
          <Icon className={cn('relative h-[17px] w-[17px]', isActive ? 'text-brand-ink' : '')} />
          <span className="relative">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function PageWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn('mx-auto w-full max-w-[1440px] flex-1 px-4 pb-10 pt-6 sm:px-6 lg:px-10 lg:pt-8', className)}
    >
      {children}
    </motion.div>
  );
}

