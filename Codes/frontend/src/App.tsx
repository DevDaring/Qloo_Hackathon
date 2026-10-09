import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthGate } from './components/AppShell';
import { ProjectLayout } from './components/ProjectLayout';
import { SkeletonCard } from './components/ui';
import Landing from './pages/Landing';

const Login = lazy(() => import('./pages/Login'));
const Projects = lazy(() => import('./pages/Projects'));
const Overview = lazy(() => import('./pages/Overview'));
const ProductBrief = lazy(() => import('./pages/ProductBrief'));
const MarketExplorer = lazy(() => import('./pages/MarketExplorer'));
const LocationComparison = lazy(() => import('./pages/LocationComparison'));
const AudienceInsights = lazy(() => import('./pages/AudienceInsights'));
const CampaignStrategy = lazy(() => import('./pages/CampaignStrategy'));
const AdStudio = lazy(() => import('./pages/AdStudio'));
const AssetsExports = lazy(() => import('./pages/AssetsExports'));
const Results = lazy(() => import('./pages/Results'));
const SettingsStatus = lazy(() => import('./pages/SettingsStatus'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 pt-8 sm:px-6 lg:px-10">
      <div className="skeleton h-8 w-64" />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route element={<AuthGate />}>
          <Route path="/projects" element={<Projects />} />
          <Route path="/settings" element={<SettingsStatus />} />
          <Route path="/projects/:pid" element={<ProjectLayout />}>
            <Route index element={<Overview />} />
            <Route path="brief" element={<ProductBrief />} />
            <Route path="explorer" element={<MarketExplorer />} />
            <Route path="compare" element={<LocationComparison />} />
            <Route path="audiences" element={<AudienceInsights />} />
            <Route path="strategy" element={<CampaignStrategy />} />
            <Route path="studio" element={<AdStudio />} />
            <Route path="assets" element={<AssetsExports />} />
            <Route path="results" element={<Results />} />
            <Route path="settings" element={<SettingsStatus />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
