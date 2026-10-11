import { useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapPin, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { mutations } from '../api/hooks';
import type { GeoResult, Region } from '../api/types';
import { cn, fmtBytes } from '../lib/format';
import { Button, ErrorState, Input, InlineSpinner, Tooltip } from './ui';

/** Editable list of short strings ("tags"). Enter or comma adds. */
export function TagInput({
  value,
  onChange,
  placeholder,
  tone = 'neutral',
  id,
  ariaLabel,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  tone?: 'neutral' | 'warn' | 'bad' | 'accent';
  id?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  const chip: Record<string, string> = {
    neutral: 'bg-surface2 text-fg border-line',
    warn: 'bg-warn-soft text-warn border-warn/30',
    bad: 'bg-bad-soft text-bad border-bad/25',
    accent: 'bg-accent-soft text-accent-ink border-accent/25',
  };
  return (
    <div className="input flex min-h-[42px] flex-wrap items-center gap-1.5 py-1.5">
      <AnimatePresence initial={false}>
        {value.map((v, i) => (
          <motion.span
            key={v}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={cn('inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-0.5 text-[12.5px] font-medium', chip[tone])}
          >
            <span className="break-words">{v}</span>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-0.5 opacity-60 hover:opacity-100" aria-label={`Remove ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        id={id}
        aria-label={ariaLabel}
        className="min-w-[120px] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-subtle"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
      />
    </div>
  );
}

/** Geocoder search with an explicit disambiguation picker. */
export function GeoSearch({ onPick, country = 'IN', placeholder = 'City, neighbourhood, address or "lat, lon"' }: { onPick: (r: GeoResult) => void; country?: string; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await mutations.geoSearch(q.trim(), country);
      if (r.results.length === 1 && !r.disambiguation_needed) {
        onPick(r.results[0]);
        setResults(null);
        setQ('');
      } else setResults(r.results);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            className="pl-9"
            value={q}
            placeholder={placeholder}
            aria-label="Search location"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
        </div>
        <Tooltip content={q.trim().length < 2 ? 'Type at least two letters of a place first.' : 'Look the place up on OpenStreetMap (Nominatim).'}>
          <Button variant="outline" onClick={search} loading={busy} disabled={q.trim().length < 2}>
            Search
          </Button>
        </Tooltip>
      </div>
      {err != null && <ErrorState error={err} compact className="mt-2" />}
      {results && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-1.5 shadow-card">
          <p className="px-2 py-1 text-xs text-muted">
            {results.length === 0 ? 'No matches. Try a different spelling or coordinates.' : `${results.length} matches — choose the right place (© OpenStreetMap contributors):`}
          </p>
          <ul role="listbox" aria-label="Location matches">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onPick(r);
                    setResults(null);
                    setQ('');
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface2"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-ink" />
                  <span className="min-w-0">
                    <span className="block truncate">{r.label}</span>
                    <span className="num block text-[11px] text-subtle">
                      {r.lat.toFixed(4)}, {r.lon.toFixed(4)} {r.type ? `· ${r.type}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="px-2 py-1 text-xs text-muted hover:text-fg" onClick={() => setResults(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export function RegionList({
  value,
  onChange,
  withRadius = true,
  defaultRadius = 5,
  emptyText,
  tone = 'accent',
}: {
  value: Region[];
  onChange: (v: Region[]) => void;
  withRadius?: boolean;
  defaultRadius?: number;
  emptyText: string;
  tone?: 'accent' | 'bad' | 'brand';
}) {
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-subtle">{emptyText}</p>}
      <AnimatePresence initial={false}>
        {value.map((r, i) => (
          <motion.div
            key={`${r.name}-${i}`}
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2"
          >
            <MapPin className={cn('h-4 w-4 shrink-0', tone === 'bad' ? 'text-bad' : tone === 'brand' ? 'text-brand-ink' : 'text-accent')} />
            <Input
              aria-label="Region name"
              className="h-8 w-40 flex-none py-1 text-[13px] font-semibold"
              value={r.name}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-muted" title={r.label ?? ''}>
              {r.label ?? 'No geocoded label'}
              {r.lat != null && r.lon != null && <span className="num ml-1 text-subtle">({r.lat.toFixed(3)}, {r.lon.toFixed(3)})</span>}
            </span>
            {withRadius && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                radius
                <Input
                  type="number"
                  min={0.5}
                  max={200}
                  step={0.5}
                  className="h-8 w-20 py-1 text-[13px]"
                  value={r.radius_km ?? defaultRadius}
                  onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, radius_km: Number(e.target.value) } : x)))}
                />
                km
              </label>
            )}
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-subtle hover:bg-bad-soft hover:text-bad" aria-label={`Remove ${r.name}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <GeoSearch
        onPick={(g) =>
          onChange([
            ...value,
            {
              name: g.label.split(',')[0].trim().slice(0, 200),
              label: g.label.slice(0, 400),
              lat: g.lat,
              lon: g.lon,
              radius_km: defaultRadius,
              country_code: (g.country_code as string | undefined)?.slice(0, 2) || null,
              source: g.source ?? 'geocoder',
            },
          ])
        }
      />
    </div>
  );
}

/** Drag-and-drop upload zone with keyboard access. */
export function Dropzone({
  onFiles,
  accept,
  maxMb,
  busy,
  label = 'Drop files here or browse',
  hint,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  maxMb?: number;
  busy?: boolean;
  label?: string;
  hint?: string;
}) {
  const [over, setOver] = useState(false);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const handle = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list);
    const big = maxMb ? files.find((f) => f.size > maxMb * 1024 * 1024) : undefined;
    if (big) {
      setTooBig(`${big.name} is ${fmtBytes(big.size)}; the limit is ${maxMb} MB.`);
      return;
    }
    setTooBig(null);
    onFiles(files);
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-9 text-center transition',
          over ? 'scale-[1.01] border-brand bg-brand-soft/50' : 'border-line bg-surface2/40 hover:border-fg/25 hover:bg-surface2/70',
        )}
      >
        {busy ? (
          <InlineSpinner label="Uploading…" />
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface shadow-card">
              <UploadCloud className="h-5 w-5 text-brand-ink" />
            </span>
            <span className="text-sm font-semibold">{label}</span>
            {hint && <span className="text-xs text-muted">{hint}</span>}
          </>
        )}
      </button>
      <input ref={input} type="file" className="sr-only" accept={accept} multiple onChange={(e) => handle(e.target.files)} tabIndex={-1} aria-hidden />
      {tooBig && (
        <p role="alert" className="mt-2 text-xs font-medium text-bad">
          {tooBig}
        </p>
      )}
    </div>
  );
}

export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.fields : {};
}

export function AddRow({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-muted transition hover:border-brand/50 hover:bg-brand-soft/30 hover:text-fg"
    >
      <Plus className="h-4 w-4" /> {label}
    </button>
  );
}

