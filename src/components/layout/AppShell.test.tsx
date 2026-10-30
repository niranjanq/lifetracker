import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('../../state/store', () => ({
  useApp: () => ({
    data: { meta: { storageMode: 'local' }, preferences: { displayName: 'You', currency: 'INR' } },
    pushToast: vi.fn(),
  }),
}));
vi.mock('../../state/auth', () => ({
  useAuth: () => ({ user: { email: 'you@example.com', emailVerified: true }, logout: vi.fn() }),
}));
vi.mock('../../state/month', () => ({
  useMonth: () => ({ month: '2026-01', setMonth: vi.fn() }),
}));
// The quick-add form lives in a closed modal; stub it to keep the unit focused.
vi.mock('../forms/TransactionForm', () => ({ TransactionForm: () => null }));

function renderShell(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>Overview screen</div>} />
          <Route path="/money" element={<div>Money screen</div>} />
          <Route path="/assistant" element={<div>Assistant screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell navigation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Assistant in the sidebar and a floating assistant toggle', () => {
    renderShell('/money');
    expect(screen.getByText('Money screen')).toBeInTheDocument();
    // Sidebar + mobile bottom nav both list "Assistant".
    expect(screen.getAllByRole('link', { name: /^assistant$/i }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /open assistant/i })).toBeInTheDocument();
  });

  it('navigates to /assistant from the sidebar link', async () => {
    renderShell('/money');
    await userEvent.click(screen.getAllByRole('link', { name: /^assistant$/i })[0]);
    expect(await screen.findByText('Assistant screen')).toBeInTheDocument();
  });

  it('keeps existing navigation working', async () => {
    renderShell('/money');
    await userEvent.click(screen.getAllByRole('link', { name: /^overview$/i })[0]);
    expect(await screen.findByText('Overview screen')).toBeInTheDocument();
  });
});
