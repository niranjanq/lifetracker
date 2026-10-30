/**
 * Read-only assistant (/assistant).
 *
 * The client is intentionally thin and honest:
 *  - Nothing renders as an "answer" until the backend has validated it. There is
 *    no local fallback, no fabricated data and no partial/streamed text.
 *  - Explicit, informed consent for THIS provider is required BEFORE any request
 *    that could transmit personal facts, and it is re-checked server-side.
 *  - When the provider is not configured we say so plainly instead of pretending
 *    to answer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Plus, Send, Sparkles, Trash2, Download, Pencil, ShieldCheck,
  RefreshCw, AlertTriangle, LogOut, Check, X,
} from 'lucide-react';
import {
  Button, Card, CardTitle, Chip, ConfirmDialog, EmptyState, Field, Modal,
  Segmented, Spinner, Textarea,
} from '../components/ui/primitives';
import { useApp } from '../state/store';
import { ApiError } from '../api/http';
import {
  chatApi, asConsentRequired, RETENTION_OPTIONS,
  type ChatStatus, type ChatSettings, type ChatThread, type ChatMessage,
} from '../api/chat';
import { downloadText } from '../lib/csv';
import { cn } from '../lib/cn';

const STARTERS = [
  'Where did my money go last month?',
  'How much of my budget have I used?',
  'Compare my spending to the previous month.',
  'Summarize my recorded wellbeing trends.',
  'Did I log my medication last week?',
];

const MAX_CHARS = 2000;

function formatStamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tz = 'Asia/Kolkata';
  const dayKey = (dt: Date) =>
    dt.toLocaleDateString('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const sameDay = dayKey(d) === dayKey(new Date());
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz });
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: tz })}, ${time}`;
}

type Boot =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; status: ChatStatus; settings: ChatSettings };

export function Assistant() {
  const { pushToast } = useApp();
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });

  const load = useCallback(async () => {
    setBoot({ phase: 'loading' });
    try {
      const [status, settings] = await Promise.all([chatApi.status(), chatApi.settings()]);
      setBoot({ phase: 'ready', status, settings });
    } catch (e) {
      setBoot({ phase: 'error', message: e instanceof Error ? e.message : 'Could not load the assistant.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (boot.phase === 'loading') {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner className="h-6 w-6" />
          <p className="text-sm">Preparing your assistant…</p>
        </div>
      </div>
    );
  }

  if (boot.phase === 'error') {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <Card>
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title="Couldn't reach the assistant"
            description={boot.message}
            action={<Button variant="primary" onClick={() => void load()}>Try again</Button>}
          />
        </Card>
      </div>
    );
  }

  const { status, settings } = boot;

  if (!status.configured) {
    return <NotConfigured onRefresh={() => void load()} />;
  }

  const needsConsent = !settings.consentGiven || settings.consentProvider !== status.provider;
  if (needsConsent) {
    return (
      <ConsentGate
        status={status}
        onAgreed={async () => {
          const next = await chatApi.saveSettings({ consentGiven: true });
          setBoot({ phase: 'ready', status, settings: next });
        }}
        onDecline={() => void load()}
      />
    );
  }

  return (
    <ChatWorkspace
      status={status}
      settings={settings}
      onWithdraw={async () => {
        const next = await chatApi.saveSettings({ consentGiven: false });
        setBoot({ phase: 'ready', status, settings: next });
        pushToast({ kind: 'info', message: 'Consent withdrawn. The assistant will not send your data until you re-enable it.' });
      }}
      pushToast={pushToast}
    />
  );
}

/* ------------------------------ Not configured ----------------------------- */
function NotConfigured({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="mx-auto max-w-2xl pt-6">
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet/15 text-violet">
            <Sparkles size={20} />
          </span>
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight">The assistant isn&rsquo;t set up yet</h1>
            <p className="mt-1 text-sm text-muted">
              A read-only model provider has to be configured by the server administrator (an API key and base URL
              in the backend environment) before the assistant can answer questions about your records. Until then it
              stays off — it will never invent answers or use placeholder data.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="secondary" onClick={onRefresh}>
            <RefreshCw size={16} /> Check again
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- Consent -------------------------------- */
function ConsentGate({
  status, onAgreed, onDecline,
}: {
  status: ChatStatus;
  onAgreed: () => Promise<void>;
  onDecline: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-2xl pt-6">
      <Card>
        <CardTitle>
          <span className="flex items-center gap-2"><ShieldCheck size={18} className="text-lime" /> Before we begin</span>
        </CardTitle>
        <p className="text-sm text-muted">
          This assistant can answer questions about <strong className="text-ink">your own</strong> financial and
          health records. It computes the numbers deterministically on this server, then sends only the specific,
          minimal facts needed to phrase an answer to an external provider. It never acts on your behalf or changes
          any data.
        </p>

        <ul className="mt-4 flex flex-col gap-2 text-sm">
          <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-lime" />
            <span>Your question is processed by <strong className="text-ink">{status.providerLabel}</strong> (model: <code className="text-lime">{status.model}</code>).</span></li>
          <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-lime" />
            <span>Only the record facts relevant to your question are transmitted — never your credentials, session tokens or account identifiers.</span></li>
          <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-lime" />
            <span>The provider&rsquo;s own privacy, retention and training policies apply to anything it receives. <strong className="text-ink">Deleting your chats here does not delete records held by the provider.</strong></span></li>
          <li className="flex gap-2"><X size={16} className="mt-0.5 shrink-0 text-coral" />
            <span>You can withdraw consent at any time from the assistant header; the chat then stops sending data.</span></li>
        </ul>

        <label className="mt-5 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-lowest/40 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-lime"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span className="text-sm text-ink">
            I understand my selected record data will be sent to {status.providerLabel} to generate answers, and that
            I can read my provider&rsquo;s privacy terms before continuing.
          </span>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onDecline} disabled={busy}>Not now</Button>
          <Button
            variant="primary"
            disabled={!checked || busy}
            onClick={async () => {
              setBusy(true);
              try { await onAgreed(); } finally { setBusy(false); }
            }}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck size={16} />} Enable assistant
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------- Workspace ------------------------------- */
function ChatWorkspace({
  status, settings, onWithdraw, pushToast,
}: {
  status: ChatStatus;
  settings: ChatSettings;
  onWithdraw: () => Promise<void>;
  pushToast: ReturnType<typeof useApp>['pushToast'];
}) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<ChatThread | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ChatThread | null>(null);
  const [confirmHistory, setConfirmHistory] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const list = await chatApi.listThreads();
    setThreads(list);
    return list;
  }, []);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    setLoadingThread(true);
    setInlineError(null);
    try {
      setMessages(await chatApi.listMessages(id));
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadThreads();
      if (list.length) await openThread(list[0].id);
    })().catch(() => pushToast({ kind: 'error', message: 'Could not load your conversations.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest turn in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const reloadMessages = useCallback(async (id: string) => {
    setMessages(await chatApi.listMessages(id));
  }, []);

  const handleSend = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    setSending(true);
    setInlineError(null);

    try {
      let id = activeId;
      if (!id) {
        const t = await chatApi.createThread();
        setThreads((prev) => [t, ...prev]);
        setActiveId(t.id);
        id = t.id;
      }
      // Reflect the user's turn immediately, then trust the server list.
      setMessages((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`, threadId: id!, role: 'user', content: text,
          status: 'ok', intent: null, guardrail: null, factRefs: [], model: null,
          inputTokens: null, outputTokens: null, createdAt: new Date().toISOString(),
        },
      ]);
      setComposer('');
      await chatApi.postMessage(id, text);
      await reloadMessages(id);
      await loadThreads();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && asConsentRequired(e.detail)) {
        pushToast({ kind: 'info', message: 'Consent is required again before continuing.' });
        await onWithdraw();
      } else if (e instanceof ApiError) {
        setInlineError(e.message);
      } else {
        setInlineError('Something went wrong. Your message is preserved — try again.');
      }
      if (activeId) await reloadMessages(activeId);
    } finally {
      setSending(false);
    }
  }, [activeId, sending, reloadMessages, loadThreads, onWithdraw, pushToast]);

  const handleRetry = useCallback(async () => {
    if (!activeId || sending) return;
    setSending(true);
    setInlineError(null);
    try {
      await chatApi.retry(activeId);
      await reloadMessages(activeId);
    } catch (e) {
      setInlineError(e instanceof ApiError ? e.message : 'Retry failed. Please try again.');
      await reloadMessages(activeId);
    } finally {
      setSending(false);
    }
  }, [activeId, sending, reloadMessages]);

  const newConversation = useCallback(async () => {
    const t = await chatApi.createThread();
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setMessages([]);
    setInlineError(null);
  }, []);

  const exportAll = useCallback(async () => {
    try {
      const data = await chatApi.exportAll();
      downloadText(`assistant-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
      pushToast({ kind: 'success', message: 'Assistant history exported.' });
    } catch (e) {
      pushToast({ kind: 'error', message: e instanceof Error ? e.message : 'Export failed.' });
    }
  }, [pushToast]);

  const doRename = useCallback(async () => {
    if (!renaming) return;
    const title = renameValue.trim();
    if (!title) return;
    const updated = await chatApi.renameThread(renaming.id, title);
    setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setRenaming(null);
  }, [renaming, renameValue]);

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    await chatApi.deleteThread(id);
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
        if (next[0]) void openThread(next[0].id); else setMessages([]);
      }
      return next;
    });
    setConfirmDelete(null);
    pushToast({ kind: 'success', message: 'Conversation deleted.' });
  }, [confirmDelete, activeId, openThread, pushToast]);

  const doDeleteHistory = useCallback(async () => {
    await chatApi.deleteHistory();
    setConfirmHistory(false);
    setActiveId(null);
    setThreads([]);
    setMessages([]);
    pushToast({ kind: 'success', message: 'All assistant history deleted from this app.' });
  }, [pushToast]);

  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === 'assistant'), [messages]);
  const canRetry = lastAssistant && (lastAssistant.status === 'error' || lastAssistant.status === 'not_configured');

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
      {/* Thread rail */}
      <aside className="lg:w-72 lg:shrink-0">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-display text-[15px] font-semibold">
              <Sparkles size={16} className="text-violet" /> Assistant
            </span>
          </div>
          <Button variant="primary" onClick={() => void newConversation()} className="w-full">
            <Plus size={16} /> New conversation
          </Button>

          <div className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto lg:max-h-[calc(100vh-320px)]">
            {threads.length === 0 && (
              <p className="px-1 py-2 text-[13px] text-muted">No conversations yet.</p>
            )}
            {threads.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors',
                  t.id === activeId ? 'border-lime/40 bg-lime/10' : 'border-transparent hover:bg-raised/60',
                )}
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => void openThread(t.id)}>
                  <span className="block truncate text-sm text-ink">{t.title}</span>
                  <span className="block truncate text-[11px] text-muted">{formatStamp(t.lastMessageAt ?? t.updatedAt)}</span>
                </button>
                <button
                  aria-label="Rename conversation"
                  className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                  onClick={() => { setRenaming(t); setRenameValue(t.title); }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  aria-label="Delete conversation"
                  className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  onClick={() => setConfirmDelete(t)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void exportAll()} className="flex-1">
                <Download size={14} /> Export all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} className="flex-1">
                Settings
              </Button>
            </div>
          </div>
        </Card>
      </aside>

      {/* Conversation */}
      <section className="flex min-h-[60vh] flex-1 flex-col">
        <Card className="flex min-h-[60vh] flex-1 flex-col p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck size={16} className="text-lime" />
              <span className="text-muted">Read-only · grounded in your own records</span>
            </div>
            <button className="flex items-center gap-1 text-[12px] text-muted hover:text-ink" onClick={() => void onWithdraw()} title="Withdraw consent">
              <LogOut size={14} /> Withdraw consent
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {loadingThread ? (
              <div className="grid h-full place-items-center text-muted"><Spinner className="h-5 w-5" /></div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-lime/15 text-lime"><Bot size={24} /></span>
                <div>
                  <p className="font-display text-[15px] font-semibold text-ink">Ask about your own records</p>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
                    I can summarize spending, budgets and salary, or describe logged health trends. I won&rsquo;t give
                    investment, medical or other professional advice.
                  </p>
                </div>
                <div className="flex w-full max-w-xl flex-col gap-2">
                  {STARTERS.map((q) => (
                    <button
                      key={q}
                      onClick={() => void handleSend(q)}
                      disabled={sending}
                      className="rounded-field border border-line bg-lowest/50 px-3 py-2 text-left text-[13px] text-ink transition-colors hover:border-lime/50 hover:bg-raised disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
          </div>

          {inlineError && (
            <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-[13px] text-ink">
              <AlertTriangle size={15} className="shrink-0 text-coral" />
              <span className="flex-1">{inlineError}</span>
            </div>
          )}

          {canRetry && (
            <div className="mx-4 mb-2">
              <Button variant="secondary" size="sm" onClick={() => void handleRetry()} disabled={sending}>
                {sending ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />} Retry last answer
              </Button>
            </div>
          )}

          <Composer
            value={composer}
            onChange={setComposer}
            onSend={() => void handleSend(composer)}
            sending={sending}
          />
        </Card>
      </section>

      {/* Rename modal */}
      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename conversation"
        footer={<><Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" onClick={() => void doRename()}>Save</Button></>}
      >
        <Field label="Title">
          <Textarea rows={1} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={200} />
        </Field>
      </Modal>

      {/* Delete thread confirm */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete conversation?"
        message="This permanently removes this conversation from the app. Records already processed by the provider are outside our control."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void doDelete()}
      />

      {/* Settings modal */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => pushToast({ kind: 'success', message: 'Assistant settings saved.' })}
        onConfirmDeleteHistory={() => setConfirmHistory(true)}
      />

      {/* Delete-all-history confirm */}
      <ConfirmDialog
        open={confirmHistory}
        title="Delete all assistant history?"
        message="This removes every conversation and message stored in this app. It cannot be undone and does not delete records held by the provider."
        confirmLabel="Delete everything"
        onCancel={() => setConfirmHistory(false)}
        onConfirm={() => void doDeleteHistory()}
      />
    </div>
  );
}

/* -------------------------------- Bubble ---------------------------------- */
function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-lime/15 px-3.5 py-2 text-sm text-ink">
          <p className="whitespace-pre-wrap">{message.content}</p>
          <div className="mt-1 text-right text-[10px] text-muted">{formatStamp(message.createdAt)}</div>
        </div>
      </div>
    );
  }

  const tone =
    message.status === 'ok' ? 'lime'
      : message.status === 'refused' || message.status === 'error' ? 'coral'
        : 'muted';

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-line bg-lowest/60 px-3.5 py-2.5 text-sm">
        <div className="mb-1 flex items-center gap-2">
          <Bot size={15} className="text-violet" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Assistant</span>
          {message.status !== 'ok' && (
            <Chip tone={tone as 'lime' | 'coral' | 'muted'}>
              {message.status === 'refused' ? 'Out of scope'
                : message.status === 'clarify' ? 'Needs detail'
                  : message.status === 'not_configured' ? 'Not configured'
                    : 'Could not answer'}
            </Chip>
          )}
        </div>
        <p className="whitespace-pre-wrap text-ink">{message.content}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
          <span>{formatStamp(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Composer ------------------------------- */
function Composer({
  value, onChange, onSend, sending,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const over = value.length > MAX_CHARS;
  return (
    <div className="border-t border-line p-3">
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={value}
          disabled={sending}
          placeholder="Ask about your records…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!over) onSend();
            }
          }}
          className={cn(
            'max-h-40 min-h-[42px] flex-1 resize-y rounded-field border bg-lowest/70 px-3 py-2.5 text-sm text-ink placeholder:text-muted/60',
            'focus:outline-none focus:ring-2 focus:ring-lime/20 transition',
            over ? 'border-danger/60' : 'border-line focus:border-lime/60',
          )}
        />
        <Button variant="primary" onClick={onSend} disabled={sending || !value.trim() || over}>
          {sending ? <Spinner className="h-4 w-4" /> : <Send size={16} />}
          <span className="hidden sm:inline">{sending ? 'Thinking…' : 'Send'}</span>
        </Button>
      </div>
      <div className={cn('mt-1 flex justify-end text-[11px]', over ? 'text-danger' : 'text-muted')}>
        {value.length} / {MAX_CHARS}
      </div>
    </div>
  );
}

/* ----------------------------- Settings modal ---------------------------- */
function SettingsModal({
  open, settings, onClose, onSaved, onConfirmDeleteHistory,
}: {
  open: boolean;
  settings: ChatSettings;
  onClose: () => void;
  onSaved: (s: ChatSettings) => void;
  onConfirmDeleteHistory: () => void;
}) {
  const [retention, setRetention] = useState<string>(
    settings.retentionDays == null ? 'keep' : String(settings.retentionDays),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setRetention(settings.retentionDays == null ? 'keep' : String(settings.retentionDays));
  }, [open, settings.retentionDays]);

  async function save() {
    setBusy(true);
    try {
      const keep = retention === 'keep';
      const next = await chatApi.saveSettings({
        keepUntilDeleted: keep,
        retentionDays: keep ? undefined : Number(retention),
      });
      onSaved(next);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assistant settings"
      footer={<Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : <Check size={16} />} Save</Button>}
    >
      <div className="flex flex-col gap-5">
        <Field
          label="Chat retention"
          hint="How long this app keeps your assistant messages. Applies to stored chats only — never to records already held by the provider."
        >
          <Segmented
            ariaLabel="Chat retention"
            value={retention}
            onChange={setRetention}
            options={RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Field>

        <div className="rounded-lg border border-line bg-lowest/40 p-3 text-[13px] text-muted">
          <div className="mb-1 flex items-center gap-2 font-semibold text-ink"><ShieldCheck size={15} className="text-lime" /> Current consent</div>
          {settings.consentGiven
            ? <>You have consented to processing by <strong className="text-ink">{settings.consentProvider}</strong>. Withdraw any time from the assistant header.</>
            : 'Consent is not active. The assistant will not send your data.'}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/5 p-3">
          <div className="text-sm">
            <p className="font-semibold text-ink">Delete all assistant history</p>
            <p className="text-[12px] text-muted">Removes every conversation stored in this app.</p>
          </div>
          <Button variant="danger" size="sm" onClick={onConfirmDeleteHistory}>
            <Trash2 size={14} /> Delete all
          </Button>
        </div>
      </div>
    </Modal>
  );
}

