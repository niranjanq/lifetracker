import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatStatus, ChatSettings, ChatMessage } from '../../api/chat';
import { AssistantWidget } from './AssistantWidget';

const { chatApi } = vi.hoisted(() => ({ chatApi: {
  status: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  createThread: vi.fn(),
  postMessage: vi.fn(),
  listMessages: vi.fn(),
  retry: vi.fn(),
} }));

vi.mock('../../api/chat', async (orig) => {
  const actual = await orig<typeof import('../../api/chat')>();
  return { ...actual, chatApi };
});
vi.mock('../../state/store', () => ({ useApp: () => ({ pushToast: vi.fn() }) }));

const NOT_CONFIGURED: ChatStatus = { configured: false, provider: null, providerLabel: null, model: null };
const CONFIGURED: ChatStatus = { configured: true, provider: 'gemini', providerLabel: 'Google Gemini', model: 'gemini-2.0-flash' };
const NO_CONSENT: ChatSettings = { consentGiven: false, consentProvider: null, retentionDays: 90 };
const WITH_CONSENT: ChatSettings = { consentGiven: true, consentProvider: 'gemini', retentionDays: 90 };

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'content'>): ChatMessage {
  return {
    threadId: 't1', status: 'ok', intent: null, guardrail: null, factRefs: [],
    model: null, inputTokens: null, outputTokens: null, createdAt: new Date().toISOString(),
    ...partial,
  } as ChatMessage;
}

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: /open assistant/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssistantWidget', () => {
  it('renders a floating toggle with no panel until opened', () => {
    render(<AssistantWidget />);
    expect(screen.getByRole('button', { name: /open assistant/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains the not-configured state instead of faking answers', async () => {
    chatApi.status.mockResolvedValue(NOT_CONFIGURED);
    chatApi.settings.mockResolvedValue(NO_CONSENT);
    render(<AssistantWidget />);
    await openPanel();
    expect(await screen.findByText(/isn.t set up yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('requires consent before enabling the composer', async () => {
    chatApi.status.mockResolvedValue(CONFIGURED);
    chatApi.settings.mockResolvedValue(NO_CONSENT);
    chatApi.saveSettings.mockResolvedValue(WITH_CONSENT);
    render(<AssistantWidget />);
    await openPanel();
    expect(await screen.findByText(/before we begin/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /enable/i }));
    await waitFor(() => expect(chatApi.saveSettings).toHaveBeenCalledWith({ consentGiven: true }));
  });

  it('routes a starter question through the pipeline and renders the answer', async () => {
    chatApi.status.mockResolvedValue(CONFIGURED);
    chatApi.settings.mockResolvedValue(WITH_CONSENT);
    chatApi.createThread.mockResolvedValue({ id: 't1', title: 'Chat', createdAt: null, updatedAt: null, lastMessageAt: null });
    chatApi.postMessage.mockResolvedValue(msg({ id: 'a1', role: 'assistant', content: 'You spent ₹4,000.' }));
    chatApi.listMessages.mockResolvedValue([
      msg({ id: 'u1', role: 'user', content: 'How much of my budget have I used?' }),
      msg({ id: 'a1', role: 'assistant', content: 'You spent ₹4,000.' }),
    ]);
    render(<AssistantWidget />);
    await openPanel();
    const starter = await screen.findByRole('button', { name: /how much of my budget/i });
    await userEvent.click(starter);
    await waitFor(() => expect(chatApi.postMessage).toHaveBeenCalledWith('t1', 'How much of my budget have I used?'));
    expect(await screen.findByText('You spent ₹4,000.')).toBeInTheDocument();
  });
});
