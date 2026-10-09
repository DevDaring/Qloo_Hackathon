import { useEffect, useState } from 'react';
import { Captions, Film, Volume2, VolumeX } from 'lucide-react';
import { useAsset } from '../api/hooks';
import type { Asset } from '../api/types';
import { AUDIO_STATE_LABEL } from '../lib/labels';
import { Badge, Skeleton, Tooltip } from './ui';

/** MP4 player with a captions track built from the asset's WebVTT (Blob URL). */
export function VideoPlayer({ asset, lang }: { asset: Asset; lang?: string }) {
  const d = useAsset(asset.id);
  const [vtt, setVtt] = useState<string | null>(null);
  useEffect(() => {
    const text = d.data?.subtitles?.vtt;
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
    setVtt(url);
    return () => URL.revokeObjectURL(url);
  }, [d.data?.subtitles?.vtt]);
  const audio = String((asset.metadata?.audio_state as string) ?? (asset.quality?.audio_state as string) ?? 'unknown');
  const native = asset.kind === 'video_final';
  const np = asset.metadata?.narration_providers ?? (asset.quality as Record<string, unknown> | null)?.narration_providers;
  const narrators = Array.isArray(np) ? (np as unknown[]).map(String) : [];
  const vertical = (asset.height ?? 0) > (asset.width ?? 0);
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-[#0B0F1A]">
      <div className={vertical ? 'mx-auto max-w-[300px]' : ''}>
        {d.isLoading ? (
          <Skeleton className={vertical ? 'aspect-[9/16] w-full' : 'aspect-video w-full'} />
        ) : (
          <video key={vtt ?? 'novtt'} controls preload="metadata" playsInline className="block w-full" aria-label={asset.label}>
            <source src={asset.url} type={asset.mime_type} />
            {vtt && <track kind="captions" src={vtt} srcLang={lang ?? 'en'} label="Captions" default />}
          </video>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-1.5 bg-surface px-3 py-2.5 text-xs">
        {native ? (
          <Badge tone="violet" icon={<Film className="h-3 w-3" />}>xAI clips + assembly</Badge>
        ) : (
          <Tooltip content="An animatic is a draft built from stills. It is NOT an xAI-generated video.">
            <span tabIndex={0}>
              <Badge tone="warn">Animatic draft — not xAI video</Badge>
            </span>
          </Tooltip>
        )}
        <Badge>{asset.preset}</Badge>
        <Badge>{asset.duration_s?.toFixed(1)} s</Badge>
        <Badge tone={audio === 'silent_captioned' ? 'neutral' : 'warn'} icon={audio === 'silent_captioned' ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}>
          {AUDIO_STATE_LABEL[audio] ?? audio}
        </Badge>
        {narrators.length > 0 && <Badge tone="accent">Narration: {narrators.join(' → ')}</Badge>}
        {vtt && <Badge tone="ok" icon={<Captions className="h-3 w-3" />}>Captions</Badge>}
        <Badge tone={asset.approval_state === 'approved' ? 'ok' : asset.approval_state === 'rejected' ? 'bad' : 'accent'}>{asset.approval_state.replace('_', ' ')}</Badge>
        <span className="ml-auto text-subtle">v{asset.version}</span>
      </figcaption>
    </figure>
  );
}
