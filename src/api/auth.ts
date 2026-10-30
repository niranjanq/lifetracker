import { http } from './http';
import type { User } from '../domain/types';

export interface RegisterResult {
  email: string;
  message: string;
}

export const authApi = {
  // Legacy DB-password registration (kept for backward compatibility / tests).
  // New sign-ups go through Firebase on the client, then exchange a token below.
  register: (email: string, password: string, displayName: string) =>
    http.post<RegisterResult>('/auth/register', { email, password, displayName }),

  // Trades a Firebase ID token for the app's own cookie session. The backend
  // verifies the token with the Admin SDK — the browser asserts nothing.
  firebaseLogin: (idToken: string) => http.post<User>('/auth/firebase', { idToken }),

  login: (email: string, password: string) => http.post<User>('/auth/login', { email, password }),

  logout: () => http.post<{ ok: boolean }>('/auth/logout'),

  me: () => http.get<User>('/auth/me'),

  forgotPassword: (email: string) => http.post<{ message: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    http.post<{ ok: boolean }>('/auth/reset-password', { token, password }),

  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<{ ok: boolean }>('/auth/change-password', { currentPassword, newPassword }),
};
