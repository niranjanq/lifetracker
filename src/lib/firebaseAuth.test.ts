/**
 * Unit tests for the browser Firebase flows: token exchange with the backend,
 * the verification gate (403 email_not_verified → VerificationRequiredError),
 * Google sign-in and its cancel handling, and resend-verification.
 * The Firebase SDK is mocked, so nothing touches a live project.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: { currentUser: null as unknown } }));

vi.mock('./firebase', () => ({
  firebaseConfigured: true,
  googleProvider: {},
  getFirebaseAuth: () => mockAuth,
}));

vi.mock('../api/auth', () => ({ authApi: { firebaseLogin: vi.fn() } }));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  sendEmailVerification: vi.fn(),
  updateProfile: vi.fn(),
  signOut: vi.fn(),
}));

import * as fb from 'firebase/auth';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import {
  signInWithEmail, signInWithGoogle, signUpWithEmail, resendVerificationEmail,
  friendlyFirebaseMessage, VerificationRequiredError,
} from './firebaseAuth';

function fakeUser(email = 'a@b.com', token = 'id-token-xyz', verified = false) {
  return { email, getIdToken: vi.fn(async () => token), emailVerified: verified };
}

const APP_USER = { email: 'a@b.com', emailVerified: true, onboarded: false, hasPassword: true };

describe('firebaseAuth flows', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.currentUser = null;
  });

  it('signInWithEmail exchanges the ID token for a session', async () => {
    const u = fakeUser('a@b.com', 'tok-1');
    vi.mocked(fb.signInWithEmailAndPassword).mockResolvedValue({ user: u } as never);
    vi.mocked(authApi.firebaseLogin).mockResolvedValue(APP_USER);

    const res = await signInWithEmail('a@b.com', 'pw');
    expect(res).toEqual(APP_USER);
    expect(authApi.firebaseLogin).toHaveBeenCalledWith('tok-1');
  });

  it('maps a 403 email_not_verified to VerificationRequiredError', async () => {
    const u = fakeUser('pending@b.com', 'tok-2');
    vi.mocked(fb.signInWithEmailAndPassword).mockResolvedValue({ user: u } as never);
    vi.mocked(authApi.firebaseLogin).mockRejectedValue(
      new ApiError(403, 'http', 'verify', { code: 'email_not_verified' }),
    );

    await expect(signInWithEmail('pending@b.com', 'pw')).rejects.toBeInstanceOf(VerificationRequiredError);
  });

  it('signInWithGoogle pops the provider and exchanges the token', async () => {
    const u = fakeUser('g@gmail.com', 'gtok');
    vi.mocked(fb.signInWithPopup).mockResolvedValue({ user: u } as never);
    vi.mocked(authApi.firebaseLogin).mockResolvedValue(APP_USER);

    await signInWithGoogle();
    expect(fb.signInWithPopup).toHaveBeenCalled();
    expect(authApi.firebaseLogin).toHaveBeenCalledWith('gtok');
  });

  it('surfaces a cancelled Google popup as a friendly error', async () => {
    vi.mocked(fb.signInWithPopup).mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    await expect(signInWithGoogle()).rejects.toThrow('Google sign-in was cancelled.');
  });

  it('signUpWithEmail creates, sets display name and sends verification', async () => {
    const u = fakeUser('new@b.com');
    vi.mocked(fb.createUserWithEmailAndPassword).mockResolvedValue({ user: u } as never);
    vi.mocked(fb.updateProfile).mockResolvedValue(undefined);
    vi.mocked(fb.sendEmailVerification).mockResolvedValue();

    const email = await signUpWithEmail('new@b.com', 'pw', 'New B');
    expect(email).toBe('new@b.com');
    expect(fb.updateProfile).toHaveBeenCalledWith(u, { displayName: 'New B' });
    expect(fb.sendEmailVerification).toHaveBeenCalled();
  });

  it('resendVerificationEmail sends only for an unverified current user', async () => {
    mockAuth.currentUser = fakeUser('a@b.com', 't', false);
    vi.mocked(fb.sendEmailVerification).mockResolvedValue();
    await expect(resendVerificationEmail()).resolves.toBe(true);

    mockAuth.currentUser = null;
    await expect(resendVerificationEmail()).resolves.toBe(false);
  });
});

describe('friendlyFirebaseMessage', () => {
  it('turns invalid-credential into a generic message', () => {
    expect(friendlyFirebaseMessage({ code: 'auth/invalid-credential' })).toBe('Incorrect email or password.');
  });
  it('detects email-already-in-use', () => {
    expect(friendlyFirebaseMessage({ code: 'auth/email-already-in-use' })).toMatch(/already exists/);
  });
});
