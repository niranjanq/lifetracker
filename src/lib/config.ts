/**
 * API base path. Requests go to `/api/...` which the Vite dev server proxies to
 * the FastAPI backend (same-origin → cookies + SameSite=lax work), and which an
 * reverse-proxy maps to the API in production.
 */
export const API_BASE = '/api';

export function getCsrfToken(): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith('plt_csrf='));
  return match ? decodeURIComponent(match.slice('plt_csrf='.length)) : null;
}
