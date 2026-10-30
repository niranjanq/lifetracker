import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthLayout } from './auth/AuthLayout';
import { Button, Spinner } from '../components/ui/primitives';
import { resendVerificationEmail } from '../lib/firebaseAuth';

interface CheckEmailState {
  email?: string;
  sent?: boolean;
  reason?: string;
}

/** Show a recognisable but masked address, e.g. "ni********@example.com". */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const user = email.slice(0, at);
  const domain = email.slice(at);
  const keep = Math.min(2, user.length);
  return `${user.slice(0, keep)}${'*'.repeat(Math.max(1, user.length - keep))}${domain}`;
}

export function CheckEmail() {
  const { state } = useLocation() as { state: CheckEmailState | null };
  const email = state?.email ?? '';
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sent = await resendVerificationEmail();
      if (sent) {
        setResent(true);
      } else {
        setError('Nothing to resend — this address is already verified, or you need to sign in first.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the verification email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle={email ? `We sent a verification link to ${maskEmail(email)}.` : 'Verify your email address to continue.'}
      footer={<Link to="/login" className="font-semibold text-lime hover:underline">Back to sign in</Link>}
    >
      <div className="flex flex-col gap-4">
        {state?.reason === 'unverified' && (
          <div className="rounded-lg border border-coral/30 bg-coral/10 p-3 text-[13px] text-ink">
            Your email isn&rsquo;t verified yet, so signing in is blocked. Use the link we emailed you, or resend it
            below.
          </div>
        )}

        <p className="text-[13px] text-muted">
          Open the verification email and follow its link to confirm your address. Once verified, return here and sign
          in to reach your dashboard. Protected features stay locked until then.
        </p>

        {resent ? (
          <div className="rounded-lg border border-lime/30 bg-lime/10 p-3 text-[13px] text-ink">
            A fresh verification link has been sent to your inbox.
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={resend}>
            {error && <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">{error}</div>}
            <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : 'Resend verification email'}
            </Button>
          </form>
        )}

        <Link
          to="/login"
          className="w-full rounded-lg border border-line bg-raised px-4 py-2 text-center text-[13px] font-semibold text-ink hover:border-lime/40"
        >
          I&rsquo;ve verified — go to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
