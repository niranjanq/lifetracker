import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import {
  signInWithEmail, signInWithGoogle, signUpWithEmail, endFirebaseSession,
} from '../lib/firebaseAuth';
import type { User } from '../domain/types';

type AuthStatus = 'checking' | 'authed' | 'anon' | 'unreachable';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Network / backend-down message distinct from "logged out". */
  error: string | null;
  /** Firebase email/password sign-in → own session. Throws VerificationRequiredError. */
  login: (email: string, password: string) => Promise<void>;
  /** Google popup sign-in → own session. */
  loginWithGoogle: () => Promise<void>;
  /** Firebase email/password sign-up + verification email. No session until verified. */
  register: (email: string, password: string, displayName: string) => Promise<string>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setStatus('checking');
    setError(null);
    try {
      const me = await authApi.me();
      setUser(me);
      setStatus('authed');
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) {
        setError('Cannot reach the server. It may be offline — this is not a sign-out.');
        setStatus('unreachable');
      } else {
        setUser(null);
        setStatus('anon');
      }
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const login = useCallback(async (email: string, password: string) => {
    const me = await signInWithEmail(email, password);
    setUser(me);
    setStatus('authed');
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const me = await signInWithGoogle();
    setUser(me);
    setStatus('authed');
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    // Creates the Firebase user and sends the verification email. There is no
    // app session yet — the user must verify, then sign in (which the gate
    // requires). Returns the address we sent the link to.
    return await signUpWithEmail(email, password, displayName);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      await endFirebaseSession();
      setUser(null);
      setStatus('anon');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, error, login, loginWithGoogle, register, logout, refresh: probe }),
    [status, user, error, login, loginWithGoogle, register, logout, probe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
