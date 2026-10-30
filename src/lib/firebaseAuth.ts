/**
 * Firebase auth flows for the browser, each followed by a backend exchange.
 *
 * Firebase issues the identity (email/password or Google); we then send the
 * ID token to `/api/auth/firebase`, where the server VERIFIES it with the Admin
 * SDK and mints the app's own secure session. The browser never asserts its own
 * verified/identity status — the backend derives it solely from the token.
 */
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  sendEmailVerification, signOut, updateProfile, type User as FirebaseUser,
} from 'firebase/auth';
import { getFirebaseAuth, googleProvider, firebaseConfigured } from './firebase';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import type { User } from '../domain/types';

/** Raised when a Firebase identity is valid but its email is not yet verified. */
export class VerificationRequiredError extends Error {
  readonly email: string;
  constructor(email: string) {
    super('Please verify your email before continuing.');
    this.name = 'VerificationRequiredError';
    this.email = email;
  }
}

/** Maps Firebase's error codes to user-facing copy (raw codes leak internals). */
export function friendlyFirebaseMessage(err: unknown): string {
  const code = String((err as { code?: string })?.code ?? '');
  if (/invalid-credential|user-not-found|wrong-password|invalid-password/.test(code)) {
    return 'Incorrect email or password.';
  }
  if (/invalid-email/.test(code)) return 'That email address doesn\u2019t look right.';
  if (/email-already-in-use/.test(code)) return 'An account with this email already exists. Try signing in.';
  if (/weak-password/.test(code)) return 'Please choose a stronger password.';
  if (/popup-closed|operation-cancelled|cancelled-popup|provider-already-linked/.test(code)) {
    return 'Google sign-in was cancelled.';
  }
  if (/network-request-failed/.test(code)) return 'Cannot reach Firebase. Check your connection.';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Please try again shortly.';
  const msg = (err as Error)?.message;
  return msg ? msg.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '') : 'Something went wrong. Please try again.';
}

function assertConfigured(): void {
  if (!firebaseConfigured) {
    throw new Error('Sign-in isn\u2019t available yet: Firebase isn\u2019t configured on this build.');
  }
}

/** Trades a Firebase ID token for the app's own session; surfaces the verify gate. */
async function exchange(idToken: string, email: string): Promise<User> {
  try {
    return await authApi.firebaseLogin(idToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      const code = (err.detail as { code?: string } | undefined)?.code;
      if (code === 'email_not_verified') throw new VerificationRequiredError(email);
    }
    throw err;
  }
}

async function tokenFor(fbu: FirebaseUser): Promise<string> {
  return fbu.getIdToken();
}

/** New email/password account: create it, then send Firebase's verification email. */
export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<string> {
  assertConfigured();
  try {
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    const name = displayName.trim();
    if (name) await updateProfile(cred.user, { displayName: name });
    await sendEmailVerification(cred.user, { url: `${window.location.origin}/login` });
    return cred.user.email ?? email;
  } catch (err) {
    throw new Error(friendlyFirebaseMessage(err));
  }
}

/** Email/password sign-in, gated on Firebase email verification. */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  assertConfigured();
  let cred;
  try {
    cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  } catch (err) {
    throw new Error(friendlyFirebaseMessage(err));
  }
  const idToken = await tokenFor(cred.user);
  return exchange(idToken, cred.user.email ?? email);
}

/** Google sign-in via popup, then the same verified-token exchange. */
export async function signInWithGoogle(): Promise<User> {
  assertConfigured();
  let cred;
  try {
    cred = await signInWithPopup(getFirebaseAuth(), googleProvider);
  } catch (err) {
    throw new Error(friendlyFirebaseMessage(err));
  }
  const idToken = await tokenFor(cred.user);
  return exchange(idToken, cred.user.email ?? '');
}

/** Resends the verification email to the currently-signed-in (unverified) user. */
export async function resendVerificationEmail(): Promise<boolean> {
  assertConfigured();
  const fbu = getFirebaseAuth().currentUser;
  if (!fbu || fbu.emailVerified) return false;
  await sendEmailVerification(fbu, { url: `${window.location.origin}/login` });
  return true;
}

/** Clears the local Firebase session (the backend session is revoked separately). */
export async function endFirebaseSession(): Promise<void> {
  if (!firebaseConfigured) return;
  try {
    await signOut(getFirebaseAuth());
  } catch {
    /* local-only; ignore */
  }
}
