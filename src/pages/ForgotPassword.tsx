import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from './auth/AuthLayout';
import { Button, Field, Input, Spinner } from '../components/ui/primitives';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword(email);
      // The server returns the same response whether or not the account exists.
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new password."
      footer={<Link to="/login" className="font-semibold text-lime hover:underline">Back to sign in</Link>}
    >
      {sent ? (
        <div className="rounded-lg border border-lime/30 bg-lime/10 p-3 text-[13px] text-ink">
          If an account exists for that address, a password-reset link is on its way. The link expires and can be used
          only once. Check your inbox (and spam) —{' '}
          <Link to="/login" className="font-semibold text-lime hover:underline">return to sign in</Link>.
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error && <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">{error}</div>}
          <Field label="Email" htmlFor="fp-email">
            <Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? <Spinner /> : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
