/**
 * Firebase browser SDK bootstrap.
 *
 * These config values are PUBLIC by design — Firebase requires the web app to
 * ship them in the bundle. The secret that VERifies tokens (the service-account
 * JSON) never appears here; it lives only on the backend.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

/** True only when every required web-config field is present. */
export const firebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

/** Lazily initialises (and never double-initialises) the Firebase app + auth. */
export function getFirebaseAuth(): Auth {
  if (!firebaseConfigured) {
    throw new Error('Firebase is not configured. Set the VITE_FIREBASE_* variables in .env.');
  }
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(config);
    authInstance = getAuth(app);
  }
  if (!authInstance) authInstance = getAuth(app);
  return authInstance;
}

export const googleProvider = new GoogleAuthProvider();
// Ask Google for a verified email; the backend trusts only Firebase's
// server-verified email_verified claim regardless of what the client requests.
googleProvider.setCustomParameters({ prompt: 'select_account' });
