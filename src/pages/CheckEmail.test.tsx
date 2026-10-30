import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CheckEmail } from './CheckEmail';
import { resendVerificationEmail } from '../lib/firebaseAuth';

vi.mock('../lib/firebaseAuth', () => ({ resendVerificationEmail: vi.fn() }));

function renderCheck(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/check-email', state }]}>
      <Routes>
        <Route path="/check-email" element={<CheckEmail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CheckEmail (Firebase verify gate)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows a masked address', () => {
    renderCheck({ email: 'nick@example.com', sent: true });
    // "nick" keeps its first two chars, remaining two masked, domain intact.
    expect(screen.getByText(/ni\*\*@example\.com/)).toBeInTheDocument();
  });

  it('explains the unverified sign-in block', () => {
    renderCheck({ email: 'nick@example.com', reason: 'unverified' });
    expect(screen.getByText(/email isn.t verified yet/)).toBeInTheDocument();
  });

  it('offers a way back to sign in', () => {
    renderCheck({ email: 'nick@example.com' });
    expect(screen.getByRole('link', { name: /go to sign in/i })).toBeInTheDocument();
  });

  it('resends via Firebase and confirms', async () => {
    vi.mocked(resendVerificationEmail).mockResolvedValue(true);
    renderCheck({ email: 'nick@example.com', sent: true });
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() => expect(resendVerificationEmail).toHaveBeenCalled());
    expect(await screen.findByText(/A fresh verification link has been sent/)).toBeInTheDocument();
  });

  it('surfaces a message when there is nothing to resend', async () => {
    vi.mocked(resendVerificationEmail).mockResolvedValue(false);
    renderCheck({ email: 'nick@example.com' });
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByText(/Nothing to resend/)).toBeInTheDocument();
  });
});
