/** "Why this place?" — the taste story for one Qloo place, opened from the Market explorer. */
import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTasteStory } from '../api/hooks';
import type { Place } from '../api/types';
import { Drawer } from './Overlay';
import { useProjectCtx } from './ProjectContext';
import { TasteStory } from './TasteStory';
import { Select } from './ui';

export function WhyThisPlace({ place, runId, areaName, onClose }: { place: Place | null; runId?: string; areaName?: string; onClose: () => void }) {
  const { project, sel } = useProjectCtx();
  const auds = project?.audiences ?? [];
  const aff = ((place?.metadata ?? {}) as { qloo_affinity_by_audience?: Record<string, number | null> }).qloo_affinity_by_audience ?? {};
  // the audience this place matters to: the working-context audience if Qloo scored it, else the strongest affinity
  const best = Object.entries(aff)
    .filter(([, v]) => v != null)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
  const initial = (sel.audienceId && aff[sel.audienceId] != null ? sel.audienceId : best) ?? auds[0]?.id;
  const [aud, setAud] = useState(initial);
  useEffect(() => setAud(initial), [place?.id, initial]);
  const story = useTasteStory(runId, place?.area_id, aud, place?.id).data;
  const inStory = !!story?.recommendations.some((r) => r.id === place?.id);
  return (
    <Drawer
      open={!!place}
      onClose={onClose}
      width="max-w-2xl"
      title={place ? `Why ${place.name}?` : 'Why this place?'}
      subtitle={<span>Interests → Qloo recommendation → placement → campaign hypothesis → creative, for one audience{areaName ? ` in ${areaName}` : ''}.</span>}
    >
      <div className="space-y-4" data-testid="why-this-place">
        <label className="block">
          <span className="label">Audience</span>
          <Select value={aud ?? ''} onChange={(e) => setAud(e.target.value)}>
            {auds.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name.replace(/\s*\(hypothetical persona\)/i, '')}
                {aff[a.id] != null ? ` · affinity ${Number(aff[a.id]).toFixed(2)}` : ' · not scored for this place'}
              </option>
            ))}
          </Select>
        </label>
        {story && story.recommendations.length > 0 && !inStory && (
          <p className="flex items-start gap-2 rounded-xl bg-surface2/70 px-3 py-2 text-[12.5px] text-muted">
            <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {story.focus_note ?? `Qloo gave ${place?.name} no affinity for this audience's interests.`} The story below shows the places Qloo did recommend.
          </p>
        )}
        {place && <TasteStory runId={runId} areaId={place.area_id} audienceId={aud} focusPlaceId={place.id} forceList />}
      </div>
    </Drawer>
  );
}
