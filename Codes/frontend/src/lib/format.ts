export function cn(...xs: (string | false | null | undefined | 0)[]): string {
  return xs.filter(Boolean).join(' ');
}

export function fmtDate(iso?: string | null, withTime = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(iso, false);
}

export function fmtMoney(v: number | string | null | undefined, currency = 'INR'): string {
  if (v === null || v === undefined || v === '') return 'Unknown';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return String(v);
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'USD' ? 2 : 0,
    }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

export function fmtUsd(v: number | string | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v === '' || v === 'unknown') return 'unknown';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return String(v);
  return `$${n.toFixed(digits)}`;
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return 'Unknown';
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return 'Unknown';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtBytes(b?: number | null): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

export function titleCase(s?: string | null): string {
  if (!s) return '';
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanize(s?: string | null): string {
  if (!s) return '';
  const t = s.replace(/[_-]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function shortId(id?: string | null): string {
  return id ? id.slice(0, 8) : '—';
}

export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
