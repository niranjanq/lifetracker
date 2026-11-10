import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state/store';
import { MonthProvider } from './state/month';
import { AuthProvider, useAuth } from './state/auth';
import { AppShell } from './components/layout/AppShell';
import { ToastHost } from './components/ToastHost';
import { Spinner, Button } from './components/ui/primitives';
import { Seo } from './components/Seo';
import { NotFound } from './components/NotFound';

const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })));
const Overview = lazy(() => import('./pages/Overview').then((m) => ({ default: m.Overview })));
const Money = lazy(() => import('./pages/Money').then((m) => ({ default: m.Money })));
const Health = lazy(() => import('./pages/Health').then((m) => ({ default: m.Health })));
const Roast = lazy(() => import('./pages/Roast').then((m) => ({ default: m.Roast })));
const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })));
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const CheckEmail = lazy(() => import('./pages/CheckEmail').then((m) => ({ default: m.CheckEmail })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword })));

const KNOWN_PATHS = new Set([
  '/', '/money', '/health', '/roast', '/insights', '/assistant', '/settings',
  '/login', '/check-email', '/forgot-password', '/reset-password',
]);

function Splash({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <Spinner className="h-6 w-6" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}

/** Shown when the backend can't be reached — deliberately NOT the login screen. */
function Unreachable({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="glass max-w-md rounded-card p-6 text-center">
        <h1 className="mb-2 font-display text-lg font-bold">Can't reach the server</h1>
        <p className="mb-4 text-sm text-muted">
          {error ?? 'The backend appears to be offline. Your session has not been ended.'}
        </p>
        <Button variant="primary" onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}

function Boot() {
  const { status, error, data, reload } = useApp();

  if (status === 'loading') return <Splash label="Loading your data…" />;
  if (status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="glass max-w-md rounded-card p-6 text-center">
          <h1 className="mb-2 font-display text-lg font-bold">Couldn't load your data</h1>
          <p className="mb-4 text-sm text-muted">
            {error ?? 'The request to the server failed. Check your connection and try again.'}
          </p>
          <Button variant="primary" onClick={() => void reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!data?.preferences.onboarded) return <Onboarding />;

  return (
    <MonthProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="money" element={<Money />} />
          <Route path="health" element={<Health />} />
          <Route path="roast" element={<Roast />} />
          <Route path="insights" element={<Insights />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </MonthProvider>
  );
}

/** Auth-aware top-level gate: login / email flows, then the authenticated app. */
function Gate() {
  const { status, error, refresh } = useAuth();
  const { pathname } = useLocation();

  return (
    <>
      <Seo />
      <Routes>
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={status === 'authed' ? <Navigate to="/" replace /> : <Login />} />
        <Route
          path="/*"
          element={
            status === 'checking' ? (
              <Splash label="Checking your session…" />
            ) : status === 'unreachable' ? (
              <Unreachable error={error} onRetry={() => void refresh()} />
            ) : status === 'anon' ? (
              KNOWN_PATHS.has(pathname) ? <Login /> : <NotFound />
            ) : (
              <AppProvider>
                <Boot />
                <ToastHost />
              </AppProvider>
            )
          }
        />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Splash label="Loading Life Tracker…" />}>
        <Gate />
      </Suspense>
    </AuthProvider>
  );
}
