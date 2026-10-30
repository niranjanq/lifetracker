import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Assistant } from './Assistant';
import { chatApi } from '../api/chat';
import type { ChatStatus, ChatSettings, ChatThread } from '../api/chat';

// Partial mock: keep the real helpers/types, stub only the network client.
vi.mock('../api/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/chat')>();
  return {
    ...actual,
    chatApi: {
      status: vi.fn(),
      settings: vi.fn(),
      saveSettings: vi.fn(),
      listThreads: vi.fn(),
      createThread: vi.fn(),
      renameThread: vi.fn(),
      deleteThread: vi.fn(),
      listMessages: vi.fn(),
      postMessage: vi.fn(),
      retry: vi.fn(),
      exportThread: vi.fn(),
      exportAll: vi.fn(),
      deleteHistory: vi.fn(),
    },
  };
});

// The Assistant only needs pushToast from the app store.
vi.mock('../state/store', () => ({
  useApp: () => ({ pushToast: vi.fn() }),
}));

const CONFIGURED: ChatStatus = {
  configured: true, provider: 'gemini', providerLabel: 'Google Gemini', model: 'gemini-test',
};
const NO_CONSENT: ChatSettings = { consentGiven: false, consentProvider: null, retentionDays: 90 };
const WITH_CONSENT: ChatSettings = { consentGiven: true, consentProvider: 'gemini', retentionDays: 90 };

function renderAssistant() {
  return render(
    <MemoryRouter><Assistant /></MemoryRouter>,
  );
}

describe('Assistant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(chatApi.listThreads).mockResolvedValue([]);
    vi.mocked(chatApi.listMessages).mockResolvedValue([]);
  });

  it('explains that the assistant is not configured instead of faking answers', async () => {
    vi.mocked(chatApi.status).mockResolvedValue({ configured: false, provider: null, providerLabel: null, model: null });
    vi.mocked(chatApi.settings).mockResolvedValue(NO_CONSENT);
    renderAssistant();
    expect(await screen.findByText(/isn.t set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('requires explicit, informed consent before enabling the composer', async () => {
    vi.mocked(chatApi.status).mockResolvedValue(CONFIGURED);
    vi.mocked(chatApi.settings).mockResolvedValue(NO_CONSENT);
    vi.mocked(chatApi.saveSettings).mockResolvedValue(WITH_CONSENT);
    renderAssistant();

    expect(await screen.findByText(/Before we begin/)).toBeInTheDocument();
    expect(screen.getByText(/Deleting your chats here does not delete records held by the provider/i)).toBeInTheDocument();

    // Enable button stays disabled until the acknowledgement is ticked.
    expect(screen.getByRole('button', { name: /Enable assistant/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /Enable assistant/i }));

    await waitFor(() => expect(chatApi.saveSettings).toHaveBeenCalledWith({ consentGiven: true }));
  });

  it('shows starter questions once consent is given and no thread exists', async () => {
    vi.mocked(chatApi.status).mockResolvedValue(CONFIGURED);
    vi.mocked(chatApi.settings).mockResolvedValue(WITH_CONSENT);
    renderAssistant();

    expect(await screen.findByRole('button', { name: /Where did my money go last month\?/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Did I log my medication last week\?/i })).toBeInTheDocument();
  });

  it('routes a submitted question through the pipeline and renders the grounded answer', async () => {
    vi.mocked(chatApi.status).mockResolvedValue(CONFIGURED);
    vi.mocked(chatApi.settings).mockResolvedValue(WITH_CONSENT);
    const thread: ChatThread = { id: 't1', title: 'New conversation', createdAt: null, updatedAt: null, lastMessageAt: null };
    vi.mocked(chatApi.createThread).mockResolvedValue(thread);
    vi.mocked(chatApi.postMessage).mockResolvedValue({
      id: 'm2', threadId: 't1', role: 'assistant', content: 'You spent ₹1,234.00. This is informational only, not financial advice.',
      status: 'ok', intent: 'finance.monthly_summary', guardrail: 'allow', factRefs: ['fin:2026-01:net_spending'],
      model: 'gemini-test', inputTokens: 10, outputTokens: 20, createdAt: new Date().toISOString(),
    });
    vi.mocked(chatApi.listMessages).mockResolvedValue([
      { id: 'm1', threadId: 't1', role: 'user', content: 'where did my money go in 2026-01', status: 'ok', intent: null, guardrail: null, factRefs: [], model: null, inputTokens: null, outputTokens: null, createdAt: new Date().toISOString() },
      { id: 'm2', threadId: 't1', role: 'assistant', content: 'You spent ₹1,234.00. This is informational only, not financial advice.', status: 'ok', intent: 'finance.monthly_summary', guardrail: 'allow', factRefs: ['fin:2026-01:net_spending'], model: 'gemini-test', inputTokens: 10, outputTokens: 20, createdAt: new Date().toISOString() },
    ]);

    renderAssistant();
    const box = await screen.findByRole('textbox');
    await userEvent.type(box, 'where did my money go in 2026-01');
    await userEvent.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => expect(chatApi.postMessage).toHaveBeenCalledWith('t1', 'where did my money go in 2026-01'));
    expect(await screen.findByText(/not financial advice/)).toBeInTheDocument();
  });
});
