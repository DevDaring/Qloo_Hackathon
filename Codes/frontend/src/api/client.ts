/** Thin fetch wrapper: same-origin cookies, JSON in/out and the backend's
 * standard error shape {error:{request_id, code, message, retryable, fields, details}}. */
import type { components } from './schema';

export type Schemas = components['schemas'];

export const API = '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  fields: Record<string, string>;
  details: Record<string, unknown>;
  requestId?: string;
  offline: boolean;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    retryable?: boolean;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
    requestId?: string;
    offline?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable ?? false;
    this.fields = init.fields ?? {};
    this.details = init.details ?? {};
    this.requestId = init.requestId;
    this.offline = init.offline ?? false;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const url = path.startsWith('/api') ? path : `${API}${path}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(cb: () => void): () => void {
  unauthorizedListeners.add(cb);
  return () => unauthorizedListeners.delete(cb);
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, query, signal } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError({
      status: 0,
      code: 'offline',
      message: navigator.onLine ? 'The LaunchLens server could not be reached.' : 'You appear to be offline.',
      retryable: true,
      offline: true,
    });
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: Record<string, unknown> } | null)?.error;
    const apiErr = new ApiError({
      status: res.status,
      code: (err?.code as string) ?? `http_${res.status}`,
      message:
        (err?.message as string) ??
        (res.status === 429 ? 'Too many requests; please wait a moment.' : `Request failed (${res.status}).`),
      retryable: (err?.retryable as boolean) ?? res.status >= 500,
      fields: (err?.fields as Record<string, string>) ?? {},
      details: (err?.details as Record<string, unknown>) ?? {},
      requestId: (err?.request_id as string) ?? res.headers.get('x-request-id') ?? undefined,
    });
    if (res.status === 401 && !path.includes('/auth/login')) unauthorizedListeners.forEach((cb) => cb());
    throw apiErr;
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

export const downloadUrl = (assetId: string, attachment = false) =>
  `${API}/assets/${assetId}/download${attachment ? '?attachment=true' : ''}`;
