/**
 * Client for the read-only assistant API (`/api/chat/...`).
 *
 * Everything is server-authoritative: the backend computes the facts, runs the
 * intent router / guardrails and validates the model output before returning it.
 * The client never sees an API key, never receives a partial/streamed answer, and
 * never talks to a model provider directly. A turn is only ever "done" when the
 * returned message carries a final `status`.
 */
import { http } from './http';

export type TurnStatus =
  | 'ok'
  | 'refused'
  | 'clarify'
  | 'error'
  | 'not_configured';

export interface ChatStatus {
  configured: boolean;
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
}

export interface ChatSettings {
  consentGiven: boolean;
  consentProvider: string | null;
  retentionDays: number | null; // null == keep until manually deleted
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastMessageAt: string | null;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  status: TurnStatus;
  intent: string | null;
  guardrail: string | null;
  factRefs: string[];
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string | null;
}

export interface ThreadExport {
  thread: ChatThread;
  messages: ChatMessage[];
}

export interface FullExport {
  exportedAt: string;
  threads: ThreadExport[];
}

/** Shape of the 403 `detail` returned when consent is missing / stale. */
export interface ConsentRequired {
  code: 'consent_required';
  provider: string;
  providerLabel: string;
  model: string;
}

const RETENTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '365 days' },
  { value: 'keep', label: 'Keep until I delete' },
];

export const chatApi = {
  status: () => http.get<ChatStatus>('/chat/status'),
  settings: () => http.get<ChatSettings>('/chat/settings'),
  saveSettings: (body: {
    consentGiven?: boolean;
    retentionDays?: number | null;
    keepUntilDeleted?: boolean;
  }) => http.put<ChatSettings>('/chat/settings', body),

  listThreads: () => http.get<ChatThread[]>('/chat/threads'),
  createThread: (title?: string) =>
    http.post<ChatThread>('/chat/threads', title ? { title } : {}),
  renameThread: (id: string, title: string) =>
    http.patch<ChatThread>(`/chat/threads/${id}`, { title }),
  deleteThread: (id: string) => http.del<{ ok: boolean }>(`/chat/threads/${id}`),

  listMessages: (id: string) => http.get<ChatMessage[]>(`/chat/threads/${id}/messages`),
  postMessage: (id: string, content: string) =>
    http.post<ChatMessage>(`/chat/threads/${id}/messages`, { content }),
  retry: (id: string) => http.post<ChatMessage>(`/chat/threads/${id}/retry`),

  exportThread: (id: string) => http.get<ThreadExport>(`/chat/threads/${id}/export`),
  exportAll: () => http.get<FullExport>('/chat/export'),
  deleteHistory: () => http.del<{ ok: boolean; deletedMessages: number }>('/chat/history'),
};

export { RETENTION_OPTIONS };

/** Narrow an unknown thrown value to the consent-required detail, if it matches. */
export function asConsentRequired(detail: unknown): ConsentRequired | null {
  if (
    detail &&
    typeof detail === 'object' &&
    (detail as ConsentRequired).code === 'consent_required'
  ) {
    return detail as ConsentRequired;
  }
  return null;
}
