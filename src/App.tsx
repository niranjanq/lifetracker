import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './state/store';
import { MonthProvider } from './state/month';
import { AuthProvider, useAuth } from './state/auth';
import { AppShell } from './components/layout/AppShell';
import { ToastHost } from './components/ToastHost';
import { Spinner, Button } from './components/ui/primitives';
import { Onboarding } from './pages/Onboarding';
import { Overview } from './pages/Overview';
import { Money } from './pages/Money';
import { Health } from './pages/Health';
import { Roast } from './pages/Roast';
import { Insights } from './pages/Insights';
import { Assistant } from './pages/Assistant';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { CheckEmail } from './pages/CheckEmail';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';

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

  if (!data?.preferences.onboarded) {
    return <Onboarding />;
  }

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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MonthProvider>
  );
}

/** Auth-aware top-level gate: login / email flows, then the authenticated app. */
function Gate() {
  const { status, error, refresh } = useAuth();

  return (
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
            <Login />
          ) : (
            <AppProvider>
              <Boot />
              <ToastHost />
            </AppProvider>
          )
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
