import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Eye, Send, Sparkles, Wand } from 'lucide-react';
import { mutations, pickDefaultRun, useApiMutation, useConsultHistory, useRun, useRuns, type RevisionBody } from '../api/hooks';
import { RevisionPreviewSheet } from './RevisionPreview';
import type { ConsultAnswer } from '../api/types';
import { humanize } from '../lib/format';
import { EvidenceChip } from './Evidence';
import { useProjectCtx } from './ProjectContext';
import { useToast } from './Toast';
import { Badge, Button, Card, CardHeader, ErrorState, Textarea } from './ui';


export function ConsultPanel() {
  const { pid, project } = useProjectCtx();
  // suggestions from this project's own cities (excluded, top-ranked, runner-up)
  const runs = useRuns(pid);
  const assess = useRun(pickDefaultRun(runs.data?.items)?.id).data?.assessments ?? [];
  const excluded = assess.find((a) => !a.eligible)?.area_name;
  const ranked = assess.filter((a) => a.eligible).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const SUGGESTIONS = [
    excluded ? `Why is ${excluded} excluded?` : 'Which hard constraints matter most here?',
    ranked[0] ? `What is still unknown about ${ranked[0].area_name}?` : 'What is still unknown?',
    ranked[1] ? `Which feature should we lead with in ${ranked[1].area_name}?` : 'Which feature should we lead with?',
  ];
  const hist = useConsultHistory(pid);
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState<ConsultAnswer | null>(null);
  const toast = useToast();
  const ask = useApiMutation((m: string) => mutations.consult(pid, m), [['consult', pid]]);
  const [preview, setPreview] = useState<RevisionBody | null>(null);
  const toBody = (p: NonNullable<ConsultAnswer['proposed_revision']>): RevisionBody => {
    const aud = project?.audiences.find((a) => a.name === p.audience_name);
    return {
      kind: p.kind as RevisionBody['kind'],
      region_name: p.region_name ?? undefined,
      ad_spend_budget: p.ad_spend_budget ?? undefined,
      feature_key: p.feature_key ?? undefined,
      audience_id: aud?.audience_id,
      role: (p.role as 'purchaser') ?? undefined,
    };
  };
  const items = (hist.data?.items ?? []).slice(-4);

  const submit = (text: string) => {
    if (!text.trim()) return;
    ask.mutate(text.trim(), {
      onSuccess: (a) => {
        setLast(a);
        setMsg('');
      },
      onError: (e) => toast.error('Consultation unavailable', e),
    });
  };

  return (
    <Card>
      <CardHeader icon={<Bot className="h-4 w-4" />} title="Ask about this project" subtitle="Answers only from this project's evidence and assessments; unknowns are stated. For general marketing questions, use the chat button." />
      <div className="space-y-3 p-5">
        {items.length > 0 && !last && (
          <ul className="max-h-56 space-y-2 overflow-y-auto pr-1 text-[13px]">
            {items.map((m, i) => (
              <li key={i} className={m.role === 'user' ? 'ml-6 rounded-xl bg-surface2 px-3 py-2' : 'mr-2 rounded-xl border border-line px-3 py-2'}>
                <p className="whitespace-pre-line">{m.content}</p>
                {m.evidence_ids?.length > 0 && <EvidenceChip ids={m.evidence_ids} className="mt-1.5" title="Evidence cited in answer" />}
              </li>
            ))}
          </ul>
        )}
        <AnimatePresence>
          {last && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 rounded-xl border border-line bg-surface2/50 p-3 text-[13.5px]">
              <p className="whitespace-pre-line leading-relaxed">{last.answer}</p>
              <div className="flex flex-wrap gap-1.5">
                {last.evidence.length > 0 && <EvidenceChip ids={last.evidence.map((e) => e.id)} title="Evidence cited in answer" />}
                {last.dropped_evidence_ids.length > 0 && <Badge tone="warn">{last.dropped_evidence_ids.length} invalid citation(s) removed</Badge>}
                <Badge>{last.model}</Badge>
              </div>
              {last.hypotheses.length > 0 && (
                <div>
                  <p className="eyebrow">Hypotheses</p>
                  <ul className="list-disc pl-5 text-muted">{last.hypotheses.map((h) => <li key={h}>{h}</li>)}</ul>
                </div>
              )}
              {last.unknowns.length > 0 && (
                <div>
                  <p className="eyebrow">Unknowns</p>
                  <ul className="list-disc pl-5 text-muted">{last.unknowns.map((h) => <li key={h}>{h}</li>)}</ul>
                </div>
              )}
              {last.proposed_revision && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft/50 p-2.5">
                  <Wand className="h-4 w-4 text-brand-ink" />
                  <span className="min-w-0 flex-1 text-[13px]">
                    Proposed revision: <b>{humanize(last.proposed_revision.kind)}</b>{' '}
                    {last.proposed_revision.region_name ?? last.proposed_revision.feature_key ?? last.proposed_revision.ad_spend_budget ?? last.proposed_revision.role ?? ''}
                    <span className="block text-xs text-muted">{last.proposed_revision.rationale} — nothing changes until you preview and confirm.</span>
                  </span>
<Button size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPreview(toBody(last.proposed_revision!))} data-tip="revision-preview">
                    Preview the change
                  </Button>
                </div>
              )}
              <button className="text-xs font-medium text-muted hover:text-fg" onClick={() => setLast(null)}>
                Show conversation
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {ask.error && <ErrorState error={ask.error} compact />}
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => submit(s)} disabled={ask.isPending} className="chip transition hover:border-accent/40 hover:text-fg">
              <Sparkles className="h-3 w-3" /> {s}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(msg);
          }}
        >
          <label htmlFor="consult" className="sr-only">
            Question
          </label>
          <Textarea id="consult" value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} className="min-h-[44px]" placeholder="Ask about locations, evidence or trade-offs…" />
          <Button type="submit" loading={ask.isPending} aria-label="Ask" icon={<Send className="h-4 w-4" />} />
        </form>
      </div>
      <RevisionPreviewSheet open={!!preview} body={preview} onClose={() => setPreview(null)} rationale={last?.proposed_revision?.rationale} />
    </Card>
  );
}
