import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Compass } from 'lucide-react';
import { Logo } from '../components/Logo';

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden page-canvas px-6 text-center">
      <div aria-hidden className="absolute -top-32 left-1/3 h-96 w-96 animate-mesh rounded-full bg-[#FF7A45]/20 blur-[110px]" />
      <div aria-hidden className="absolute -bottom-32 right-1/3 h-96 w-96 animate-mesh rounded-full bg-[#1F6FEB]/20 blur-[110px]" />
      <Logo className="relative mb-10" />
      <motion.div initial={{ rotate: -40, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }}>
        <Compass className="relative h-14 w-14 text-brand-ink" strokeWidth={1.4} />
      </motion.div>
      <h1 className="relative mt-5 font-display text-4xl font-extrabold tracking-tight">This place isn’t on the map</h1>
      <p className="relative mt-2 max-w-md text-muted">The page you asked for doesn’t exist. Unknown is not zero — but here it really is nothing.</p>
      <div className="relative mt-8 flex gap-3">
        <Link to="/" className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface2">
          Home
        </Link>
        <Link to="/projects" className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-medium text-white dark:bg-white dark:text-[#0E1320]">
          Projects
        </Link>
      </div>
    </div>
  );
}
