import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from './auth/AuthLayout';
import { Button, Field, Input, Segmented, Spinner } from '../components/ui/primitives';
import { useAuth } from '../state/auth';
import { VerificationRequiredError } from '../lib/firebaseAuth';

type Mode = 'signin' | 'create';

export function Login() {
  const { login, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'create') {
      if (password.length < 10) {
        setError('Password must be at least 10 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await login(email, password);
        // On success the auth Gate swaps to the app; nothing else to do.
      } else {
        const sentTo = await register(email, password, displayName);
        navigate('/check-email', { state: { email: sentTo, sent: true } });
      }
    } catch (err) {
      // Signed in via Firebase but the email isn't verified yet → pending screen.
      if (err instanceof VerificationRequiredError) {
        navigate('/check-email', { state: { email: err.email || email, reason: 'unverified' } });
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      if (err instanceof VerificationRequiredError) {
        navigate('/check-email', { state: { email: err.email || email, reason: 'unverified' } });
        return;
      }
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={mode === 'signin' ? 'Welcome back' : 'Create your account'}
      subtitle="Your finances and health data, secured behind a real login."
      footer={
        mode === 'signin' ? (
          <span>
            New here?{' '}
            <button className="font-semibold text-lime hover:underline" onClick={() => { setMode('create'); setError(null); }}>
              Create an account
            </button>
          </span>
        ) : (
          <span>
            Already registered?{' '}
            <button className="font-semibold text-lime hover:underline" onClick={() => { setMode('signin'); setError(null); }}>
              Sign in
            </button>
          </span>
        )
      }
    >
      <div className="mb-5 flex justify-center">
        <Segmented
          ariaLabel="Auth mode"
          value={mode}
          onChange={(v) => { setMode(v); setError(null); setNotice(null); }}
          options={[{ value: 'signin', label: 'Sign in' }, { value: 'create', label: 'Create account' }]}
        />
      </div>

      {notice && <div className="mb-4 rounded-lg border border-lime/30 bg-lime/10 p-3 text-[13px] text-ink">{notice}</div>}
      {error && <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">{error}</div>}

      <form className="flex flex-col gap-4" onSubmit={submit}>
        {mode === 'create' && (
          <Field label="Display name" htmlFor="au-name" hint="Optional — shown in the app header.">
            <Input id="au-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" maxLength={80} />
          </Field>
        )}
        <Field label="Email" htmlFor="au-email">
          <Input id="au-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field
          label="Password"
          htmlFor="au-pass"
          hint={mode === 'create' ? 'At least 10 characters.' : undefined}
        >
          <Input
            id="au-pass"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </Field>
        {mode === 'create' && (
          <Field label="Confirm password" htmlFor="au-confirm">
            <Input id="au-confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        )}

        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={busy}>
          {busy ? <Spinner /> : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>

        {mode === 'signin' && (
          <div className="text-center">
            <Link to="/forgot-password" className="text-[13px] text-muted hover:text-ink hover:underline">
              Forgot password?
            </Link>
          </div>
        )}
      </form>

      <div className="my-5 flex items-center gap-3 text-[12px] text-muted">
        <span className="h-px flex-1 bg-line" />
        <span>or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button variant="secondary" className="w-full" onClick={google} disabled={busy}>
        {busy ? <Spinner /> : (
          <span className="inline-flex items-center justify-center gap-2">
            <GoogleGlyph />
            Continue with Google
          </span>
        )}
      </Button>
    </AuthLayout>
  );
}

/** Minimal inline Google "G" mark (no external asset / icon dependency). */
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.4h11.82c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.58-9.46 6.58-16.06z"/>
      <path fill="#4CAF50" d="M24 46c5.94 0 10.93-1.97 14.58-5.33l-7.11-5.52c-1.98 1.33-4.51 2.11-7.47 2.11-5.74 0-10.61-3.87-12.34-9.07H4.34v5.7C7.97 41.07 15.4 46 24 46z"/>
      <path fill="#1976D2" d="M11.66 28.19c-.44-1.32-.69-2.73-.69-4.19s.25-2.87.69-4.19v-5.7H4.34C2.85 17.16 2 20.5 2 24s.85 6.84 2.34 9.9l9.32-5.71z"/>
      <path fill="#DD4C3D" d="M24 10.5c3.25 0 6.16 1.12 8.45 3.31l6.33-6.33C34.91 4.18 29.93 2 24 2 15.4 2 7.97 6.93 4.34 14.1l9.32 5.7c1.73-5.2 6.6-9.3 10.34-9.3z"/>
    </svg>
  );
}
