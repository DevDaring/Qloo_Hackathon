import { ArrowRight, Hand, Play, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRuns } from '../api/hooks';
import { useProjectCtx } from './ProjectContext';
import { Button, Callout } from './ui';

/**
 * Explains how to get a campaign strategy when there is none yet, and offers the
 * one action that moves the user forward: start research, choose city × audience
 * pairs at the waiting decision, or wait for the running research.
 */
export function StrategyNextStep({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { pid, waitingRunId, openDecision } = useProjectCtx();
  const runs = useRuns(pid).data?.items ?? [];
  const running = runs.find((r) => r.status === 'running' || r.status === 'queued');
  const step = waitingRunId
    ? { text: 'Research is done and waiting for you: choose which city × audience pairs get a strategy.', cta: 'Choose cities & audiences', icon: <Hand className="h-4 w-4" />, act: () => (onNavigate?.(), openDecision(waitingRunId)) }
    : running
      ? { text: 'Research is running now. When it finishes you will choose city × audience pairs, and the strategies are written for them.', cta: 'Watch progress', icon: <Play className="h-4 w-4" />, to: `/projects/${pid}` }
      : runs.length === 0
        ? { text: 'This project has no research yet. Start research: LaunchLens gathers places and climate, asks Qloo where each audience’s tastes concentrate, ranks the cities, then asks you which pairs to plan for.', cta: 'Start research', icon: <Play className="h-4 w-4" />, to: `/projects/${pid}/explorer#start` }
        : { text: 'Strategies are written for the city × audience pairs you choose at the end of a research run. Open Campaign strategy to see or create them.', cta: 'Open Campaign strategy', icon: <Target className="h-4 w-4" />, to: `/projects/${pid}/strategy` };
  return (
    <Callout
      tone="accent"
      icon={<Target className="h-4 w-4 text-accent-ink" />}
      title="No campaign strategy yet"
      className={compact ? '' : 'mx-auto max-w-2xl'}
      action={
        step.to ? (
          <Link to={step.to} onClick={onNavigate} className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-[#FF8A5B] to-[#FF6A2F] px-4 text-sm font-semibold text-[#1A0E08] shadow-card transition hover:brightness-105 [@media(pointer:coarse)]:min-h-[44px]" data-testid="strategy-next-step">
            {step.icon} {step.cta} <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Button variant="brand" icon={step.icon} onClick={step.act} data-testid="strategy-next-step">
            {step.cta}
          </Button>
        )
      }
    >
      {step.text} Briefs and ads are always made from a strategy, so the right audience gets the right message.
    </Callout>
  );
}
