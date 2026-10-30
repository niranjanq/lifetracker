import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from './auth/AuthLayout';
import { Button, Field, Input, Spinner } from '../components/ui/primitives';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.length < 10) {
      setError('Please choose a password of at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      // Reset revokes all sessions server-side; send the user to sign in fresh.
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invalid reset link" footer={<Link to="/forgot-password" className="font-semibold text-lime hover:underline">Request a new link</Link>}>
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">
          This reset link is missing its token. Please request a new password-reset email.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="For your security, this signs you out of all devices."
      footer={<Link to="/login" className="font-semibold text-lime hover:underline">Back to sign in</Link>}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">
            {error}{' '}
            {/expired|invalid|used/i.test(error) && (
              <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>
            )}
          </div>
        )}
        <Field label="New password" htmlFor="rp-pass" hint="At least 10 characters.">
          <Input id="rp-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" htmlFor="rp-confirm">
          <Input id="rp-confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? <Spinner /> : 'Set new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
