/**
 * Floating Assistant chat widget.
 *
 * A corner bubble that opens a compact, read-only assistant over the user's own
 * records — without navigating away. It is the same thin, honest client as the
 * full `/assistant` page: nothing renders as an answer until the backend has
 * validated it, informed consent is required before any request that could
 * transmit personal facts, and when the provider isn't configured we say so
 * plainly instead of pretending to answer. The bubble is shown on every
 * authenticated screen regardless of provider configuration.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, X, Send, Sparkles, ShieldCheck, RefreshCw, AlertTriangle, Check, LogOut,
} from 'lucide-react';
import { Button, Chip, Spinner } from '../ui/primitives';
import { useApp } from '../../state/store';
import { ApiError } from '../../api/http';
import {
  chatApi, asConsentRequired,
  type ChatStatus, type ChatSettings, type ChatMessage,
} from '../../api/chat';
import { cn } from '../../lib/cn';

const STARTERS = [
  'Where did my money go last month?',
  'How much of my budget have I used?',
  'Summarize my recorded wellbeing trends.',
];
const MAX_CHARS = 2000;

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

type Boot =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; status: ChatStatus; settings: ChatSettings };

export function AssistantWidget() {
  const { pushToast } = useApp();
  const [open, setOpen] = useState(false);
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setBoot({ phase: 'loading' });
    try {
      const [status, settings] = await Promise.all([chatApi.status(), chatApi.settings()]);
      setBoot({ phase: 'ready', status, settings });
    } catch (e) {
      setBoot({ phase: 'error', message: e instanceof Error ? e.message : 'Could not load the assistant.' });
    }
  }, []);

  // Fetch lazily the first time the panel is opened.
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void load();
    }
  }, [open, load]);

  // Consent toggles refresh settings in place without a full reload.
  const applySettings = useCallback((settings: ChatSettings) => {
    setBoot((b) => (b.phase === 'ready' ? { phase: 'ready', status: b.status, settings } : b));
  }, []);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Assistant"
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line',
            'bg-surface/95 shadow-2xl backdrop-blur',
            'inset-x-3 bottom-24 max-h-[70vh] sm:inset-x-auto',
            'sm:right-6 sm:bottom-24 sm:w-[380px] sm:max-h-[min(620px,72vh)]',
          )}
        >
          <WidgetBody boot={boot} onReload={() => void load()} applySettings={applySettings} pushToast={pushToast} onClose={() => setOpen(false)} />
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        className={cn(
          'fixed right-4 bottom-20 z-50 grid h-14 w-14 place-items-center rounded-full',
          'bg-lime text-lime-on shadow-lime transition-transform duration-150',
          'hover:scale-105 active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2',
          'lg:right-6 lg:bottom-6',
        )}
      >
        {open ? <X size={24} /> : <Bot size={24} />}
      </button>
    </>
  );
}

/* ---------------------------------- Body ---------------------------------- */
function WidgetBody({
  boot, onReload, applySettings, pushToast, onClose,
}: {
  boot: Boot;
  onReload: () => void;
  applySettings: (s: ChatSettings) => void;
  pushToast: ReturnType<typeof useApp>['pushToast'];
  onClose: () => void;
}) {
  if (boot.phase === 'loading') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-muted">
        <Spinner className="h-6 w-6" />
        <p className="text-sm">Preparing your assistant…</p>
      </div>
    );
  }

  if (boot.phase === 'error') {
    return (
      <PanelShell onClose={onClose} title="Assistant">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle size={26} className="text-coral" />
          <p className="text-sm text-ink">{boot.message}</p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            <RefreshCw size={14} /> Try again
          </Button>
        </div>
      </PanelShell>
    );
  }

  const { status, settings } = boot;

  if (!status.configured) {
    return (
      <PanelShell onClose={onClose} title="Assistant">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet/15 text-violet"><Sparkles size={22} /></span>
          <p className="font-display text-[15px] font-semibold text-ink">The assistant isn&rsquo;t set up yet</p>
          <p className="text-[13px] text-muted">
            A read-only model provider has to be configured by the server administrator (an API key and base URL in the
            backend environment) before it can answer questions about your records. Until then it stays off — it will
            never invent answers or use placeholder data.
          </p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            <RefreshCw size={14} /> Check again
          </Button>
        </div>
      </PanelShell>
    );
  }

  const needsConsent = !settings.consentGiven || settings.consentProvider !== status.provider;
  if (needsConsent) {
    return (
      <ConsentPanel
        status={status}
        onClose={onClose}
        onAgreed={async () => {
          const next = await chatApi.saveSettings({ consentGiven: true });
          applySettings(next);
        }}
      />
    );
  }

  return (
    <ChatPanel
      status={status}
      onClose={onClose}
      pushToast={pushToast}
      onWithdraw={async () => {
        const next = await chatApi.saveSettings({ consentGiven: false });
        applySettings(next);
        pushToast({ kind: 'info', message: 'Consent withdrawn. The assistant will not send your data until you re-enable it.' });
      }}
    />
  );
}

// (settings updates are applied by the parent via applySettings)

/* ------------------------------ Panel shell ------------------------------- */
function PanelShell({
  title, onClose, children, right,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
          <Sparkles size={16} className="text-violet" /> {title}
        </span>
        <div className="flex items-center gap-2">
          {right}
          <button type="button" onClick={onClose} aria-label="Close assistant" className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink">
            <X size={18} />
          </button>
        </div>
      </header>
      {children}
    </>
  );
}

/* -------------------------------- Consent -------------------------------- */
function ConsentPanel({
  status, onClose, onAgreed,
}: {
  status: ChatStatus;
  onClose: () => void;
  onAgreed: () => Promise<void>;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <PanelShell onClose={onClose} title="Before we begin">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-[13px]">
        <p className="text-muted">
          This assistant answers questions about <strong className="text-ink">your own</strong> records. It computes
          numbers deterministically on this server, then sends only the minimal facts needed to phrase an answer to an
          external provider. It never changes your data.
        </p>
        <ul className="flex flex-col gap-1.5 text-ink">
          <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-lime" />
            <span>Processed by <strong>{status.providerLabel}</strong> (model: <code className="text-lime">{status.model}</code>).</span></li>
          <li className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-lime" />
            <span>Only relevant record facts are sent — never credentials or session tokens.</span></li>
          <li className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-coral" />
            <span>The provider&rsquo;s own privacy and retention policies apply. Deleting chats here does not delete records held by the provider.</span></li>
        </ul>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-lowest/40 p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-lime" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span className="text-ink">I understand my selected record data will be sent to {status.providerLabel} to generate answers.</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-line p-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Not now</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!checked || busy}
          onClick={async () => { setBusy(true); try { await onAgreed(); } finally { setBusy(false); } }}
        >
          {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck size={15} />} Enable
        </Button>
      </div>
    </PanelShell>
  );
}

/* --------------------------------- Chat ---------------------------------- */
function ChatPanel({
  status, onClose, onWithdraw, pushToast,
}: {
  status: ChatStatus;
  onClose: () => void;
  onWithdraw: () => Promise<void>;
  pushToast: ReturnType<typeof useApp>['pushToast'];
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const reload = useCallback(async (id: string) => {
    setMessages(await chatApi.listMessages(id));
  }, []);

  const handleSend = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    setSending(true);
    setInlineError(null);
    try {
      let id = threadId;
      if (!id) {
        const t = await chatApi.createThread();
        setThreadId(t.id);
        id = t.id;
      }
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
      await reload(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && asConsentRequired(e.detail)) {
        pushToast({ kind: 'info', message: 'Consent is required again before continuing.' });
        await onWithdraw();
      } else if (e instanceof ApiError) {
        setInlineError(e.message);
      } else {
        setInlineError('Something went wrong. Your message is preserved — try again.');
      }
      if (threadId) await reload(threadId);
    } finally {
      setSending(false);
    }
  }, [threadId, sending, reload, onWithdraw, pushToast]);

  const handleRetry = useCallback(async () => {
    if (!threadId || sending) return;
    setSending(true);
    setInlineError(null);
    try {
      await chatApi.retry(threadId);
      await reload(threadId);
    } catch (e) {
      setInlineError(e instanceof ApiError ? e.message : 'Retry failed. Please try again.');
      await reload(threadId);
    } finally {
      setSending(false);
    }
  }, [threadId, sending, reload]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const canRetry = lastAssistant && (lastAssistant.status === 'error' || lastAssistant.status === 'not_configured');

  return (
    <PanelShell
      onClose={onClose}
      title="Assistant"
    >
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-lime/15 text-lime"><Bot size={22} /></span>
            <p className="text-[13px] text-muted">Ask about your own records — spending, budgets, salary or logged health trends.</p>
            <div className="flex w-full flex-col gap-2">
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
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>

      {inlineError && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-[13px] text-ink">
          <AlertTriangle size={15} className="shrink-0 text-coral" />
          <span className="flex-1">{inlineError}</span>
        </div>
      )}
      {canRetry && (
        <div className="mx-3 mb-2">
          <Button variant="secondary" size="sm" onClick={() => void handleRetry()} disabled={sending}>
            {sending ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />} Retry last answer
          </Button>
        </div>
      )}

      <div className="border-t border-line p-2.5">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={composer}
            disabled={sending}
            placeholder="Ask about your records…"
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (composer.length <= MAX_CHARS) void handleSend(composer);
              }
            }}
            className={cn(
              'max-h-28 min-h-[40px] flex-1 resize-y rounded-field border bg-lowest/70 px-3 py-2 text-sm text-ink placeholder:text-muted/60',
              'focus:outline-none focus:ring-2 focus:ring-lime/20 transition',
              composer.length > MAX_CHARS ? 'border-danger/60' : 'border-line focus:border-lime/60',
            )}
          />
          <Button variant="primary" onClick={() => void handleSend(composer)} disabled={sending || !composer.trim() || composer.length > MAX_CHARS}>
            {sending ? <Spinner className="h-4 w-4" /> : <Send size={16} />}
          </Button>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
          <button type="button" onClick={() => void onWithdraw()} className="flex items-center gap-1 hover:text-ink" title="Withdraw consent">
            <LogOut size={12} /> Withdraw consent
          </button>
          <span>{composer.length} / {MAX_CHARS}</span>
        </div>
      </div>
    </PanelShell>
  );
}

/* --------------------------------- Bubble -------------------------------- */
function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-lime/15 px-3 py-2 text-sm text-ink">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }
  const tone = message.status === 'ok' ? 'lime'
    : message.status === 'refused' || message.status === 'error' ? 'coral' : 'muted';
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-line bg-lowest/60 px-3 py-2 text-sm">
        <div className="mb-1 flex items-center gap-2">
          <Bot size={14} className="text-violet" />
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
          <span>{formatTime(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
