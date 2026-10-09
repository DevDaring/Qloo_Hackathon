import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Lock, Sparkles, User } from 'lucide-react';
import { ApiError } from '../api/client';
import { mutations } from '../api/hooks';
import { IndiaMap } from '../components/IndiaMap';
import { Logo } from '../components/Logo';
import { Button, CopyButton, Field, Input } from '../components/ui';

const JURY = { username: 'TestUser', password: 'TestUser11' };

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  async function submit(u: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      await mutations.login({ username: u, password: p });
      await qc.invalidateQueries({ queryKey: ['me'] });
      const next = params.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/projects', { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError({ msg: 'Username or password is incorrect.' });
        else if (e.status === 429) setError({ msg: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
        else setError({ msg: e.message, fields: e.fields });
      } else setError({ msg: 'Sign-in failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError({ msg: 'Enter your username and password.' });
      return;
    }
    submit(username, password);
  };

  const juryLogin = () => {
    setUsername(JURY.username);
    setPassword(JURY.password);
    submit(JURY.username, JURY.password);
  };

  return (
    <div className="grid min-h-screen overflow-x-hidden bg-bg lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <div className="relative hidden overflow-hidden bg-[#0E1320] text-white lg:block">
        <div aria-hidden className="absolute inset-0">
          <div className="absolute -left-24 -top-24 h-[420px] w-[420px] animate-mesh rounded-full bg-[#FF7A45]/30 blur-[110px]" />
          <div className="absolute -bottom-32 right-0 h-[480px] w-[480px] animate-mesh rounded-full bg-[#1F6FEB]/30 blur-[120px] [animation-delay:-9s]" />
          <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:44px_44px]" />
        </div>
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          <Link to="/" className="inline-flex w-fit items-center gap-2 text-sm text-white/70 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <div className="mx-auto w-full max-w-[460px]">
            <IndiaMap dark className="h-auto w-full" />
          </div>
          <div>
            <Logo inverted />
            <p className="mt-4 max-w-md font-display text-2xl font-bold leading-snug tracking-tight">
              Where should a fan-and-speech power wheelchair launch first — and what should each audience see?
            </p>
            <p className="mt-3 max-w-md text-sm text-white/60">The sample project answers with evidence, honest unknowns and ads you can review before anything is spent.</p>
          </div>
        </div>
      </div>

      {/* form */}
      <div className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 lg:hidden">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#FF7A45]/20 blur-[90px]" />
        </div>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="relative w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Link to="/">
              <Logo />
            </Link>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-[15px] text-muted">Welcome to LaunchLens. Jury members can use the access below.</p>

          {/* jury card */}
          <motion.section
            aria-labelledby="jury-title"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 20 }}
            className="relative mt-6 overflow-hidden rounded-2xl p-[1.5px]"
          >
            <div aria-hidden className="absolute inset-0 animate-[spin_6s_linear_infinite] bg-[conic-gradient(from_0deg,#FF7A45,#F0567A,#1F6FEB,#FF7A45)] [mask-image:radial-gradient(circle,black,black)] motion-reduce:animate-none" style={{ inset: '-60%' }} />
            <div className="relative rounded-[15px] bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#FF7A45] to-[#1F6FEB] text-white">
                  <KeyRound className="h-3.5 w-3.5" />
                </span>
                <h2 id="jury-title" className="font-display text-[15px] font-bold">
                  Jury access
                </h2>
                <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-bold text-brand-ink">Demo workspace</span>
              </div>
              <dl className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2 rounded-xl bg-surface2 px-3 py-2">
                  <div>
                    <dt className="text-[11px] font-medium text-subtle">Username</dt>
                    <dd className="font-mono text-[15px] font-semibold">{JURY.username}</dd>
                  </div>
                  <CopyButton text={JURY.username} label="Copy" />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-surface2 px-3 py-2">
                  <div>
                    <dt className="text-[11px] font-medium text-subtle">Password</dt>
                    <dd className="font-mono text-[15px] font-semibold">{JURY.password}</dd>
                  </div>
                  <CopyButton text={JURY.password} label="Copy" />
                </div>
              </dl>
              <Button variant="brand" size="lg" className="mt-3 w-full" onClick={juryLogin} loading={busy} icon={<Sparkles className="h-4 w-4" />}>
                Use jury login
              </Button>
            </div>
          </motion.section>

          <div className="my-6 flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" /> or sign in manually <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Username" htmlFor="username" error={error?.fields?.username}>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <Input id="username" autoComplete="username" className="pl-9" value={username} onChange={(e) => setUsername(e.target.value)} invalid={!!error} />
              </div>
            </Field>
            <Field label="Password" htmlFor="password" error={error?.fields?.password}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <Input
                  id="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pl-9 pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={!!error}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-subtle hover:text-fg"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error.msg}
                </motion.div>
              )}
            </AnimatePresence>
            <Button type="submit" size="lg" className="w-full" loading={busy} icon={!busy ? <ArrowRight className="h-4 w-4" /> : undefined}>
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-subtle">Sessions use a secure HttpOnly cookie. Provider keys stay on the server and never reach the browser.</p>
        </motion.div>
      </div>
    </div>
  );
}
