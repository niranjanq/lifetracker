import { API_BASE, getCsrfToken } from '../lib/config';

export type ApiErrorKind = 'network' | 'http';

/**
 * Thrown for every failed request. `isNetwork` is true when the backend could
 * not be reached at all (server down / proxy not running) — this MUST be shown
 * as a connectivity error, never mistaken for "logged out" (point 10).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly detail?: unknown;
  readonly isNetwork: boolean;
  readonly isUnauthorized: boolean;

  constructor(status: number, kind: ApiErrorKind, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.detail = detail;
    this.isNetwork = kind === 'network';
    this.isUnauthorized = status === 401;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include', // send + receive the HttpOnly session cookie
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch itself rejected → backend unreachable, not an auth problem.
    throw new ApiError(0, 'network', 'Cannot reach the server. Check that the backend is running.');
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const raw = (payload as { detail?: unknown } | null)?.detail ?? payload;
    let message: string;
    if (typeof raw === 'string') {
      message = raw;
    } else if (Array.isArray(raw)) {
      // FastAPI returns 422 validation errors as an array of { loc, msg, ... }.
      message = raw
        .map((d) => {
          const item = d as { loc?: unknown[]; msg?: string };
          const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
          const msg = item.msg ?? 'invalid input';
          return field ? `${field}: ${msg}` : msg;
        })
        .join('; ');
    } else {
      message = res.status === 401 ? 'Not authenticated' : `Request failed (${res.status})`;
    }
    throw new ApiError(res.status, 'http', message, raw);
  }

  return payload as T;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
