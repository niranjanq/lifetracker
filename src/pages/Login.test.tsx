import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Login } from './Login';
import { useAuth } from '../state/auth';
import { VerificationRequiredError } from '../lib/firebaseAuth';

vi.mock('../state/auth', () => ({ useAuth: vi.fn() }));

function LocationProbe() {
  const { pathname, state } = useLocation();
  return <div data-testid="probe">{JSON.stringify({ pathname, state })}</div>;
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/check-email" element={<><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function switchToCreateMode() {
  await userEvent.click(screen.getByRole('radio', { name: 'Create account' }));
}

function baseAuth() {
  return {
    status: 'anon' as const,
    user: null,
    error: null,
    login: vi.fn(async () => {}),
    loginWithGoogle: vi.fn(async () => {}),
    register: vi.fn(async () => 'new@example.com'),
    logout: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  };
}

describe('Login / registration flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useAuth).mockReturnValue(baseAuth());
  });

  it('blocks submit when the confirmation password does not match', async () => {
    renderLogin();
    await switchToCreateMode();
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different-pass1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(useAuth().register).not.toHaveBeenCalled();
  });

  it('requires a password of at least 10 characters', async () => {
    renderLogin();
    await switchToCreateMode();
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument();
    expect(useAuth().register).not.toHaveBeenCalled();
  });

  it('navigates to /check-email after a successful registration', async () => {
    renderLogin();
    await switchToCreateMode();
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'supersecret123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument());
    const landed = JSON.parse(screen.getByTestId('probe').textContent || '{}');
    expect(landed.pathname).toBe('/check-email');
    expect(landed.state).toEqual({ email: 'new@example.com', sent: true });
    expect(useAuth().register).toHaveBeenCalledWith('new@example.com', 'supersecret123', '');
  });

  it('routes an unverified sign-in attempt to /check-email', async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...baseAuth(),
      login: vi.fn(async () => {
        throw new VerificationRequiredError('gate@example.com');
      }),
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'gate@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument());
    const landed = JSON.parse(screen.getByTestId('probe').textContent || '{}');
    expect(landed.pathname).toBe('/check-email');
    expect(landed.state).toEqual({ email: 'gate@example.com', reason: 'unverified' });
  });

  it('offers a Google sign-in button that uses the store action', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(useAuth().loginWithGoogle).toHaveBeenCalled());
  });
});
