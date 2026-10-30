import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardTitle, Button, Chip, Field, Input, Select, Toggle, ConfirmDialog, Modal, Spinner } from '../components/ui/primitives';
import { useApp } from '../state/store';
import { useAuth } from '../state/auth';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import { resendVerificationEmail } from '../lib/firebaseAuth';
import { previewBrowserData, importBrowserData, type ImportPreview } from '../lib/importLocal';
import type { CurrencyCode } from '../domain/types';
import { toCSV, downloadText } from '../lib/csv';

const CURRENCIES: CurrencyCode[] = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'JPY'];

export function Settings() {
  const { data, updatePreferences, updateReminders, upsertCategory, deleteCategory, deleteAllData, pushToast, reload } = useApp();
  const { user, logout } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newCat, setNewCat] = useState('');
  // Account: change password (re-authenticated server-side).
  const [cpOpen, setCpOpen] = useState(false);
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpBusy, setCpBusy] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  // Explicit, consent-gated import of this browser's IndexedDB data.
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  if (!data) return null;
  const prefs = data.preferences;
  const snap = data;
  const serverMode = data.meta.storageMode === 'server';

  function exportEverything() {
    const rows: Array<Array<string | number>> = [];
    rows.push(['# Personal Life Tracker export', 'storage=local', 'date=' + new Date().toISOString()]);
    rows.push(['# Transactions']);
    rows.push(['date', 'kind', 'category', 'amountMinor', 'description', 'source']);
    for (const t of snap.transactions) {
      rows.push([t.date, t.kind, snap.categories.find((c) => c.id === t.categoryId)?.name ?? '', t.amountMinor, t.description ?? '', t.demo ? 'demo' : 'user']);
    }
    rows.push(['# Salary receipts']);
    for (const s of snap.salaryReceipts) rows.push([s.date, 'salary', '', s.amountMinor, s.source ?? '', 'user']);
    rows.push(['# Health logs']);
    for (const h of snap.healthLogs) rows.push([h.date, 'health', 'wellbeing', h.wellbeing, h.note ?? '', h.demo ? 'demo' : 'user']);
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\r\n');
    downloadText(`life-tracker-export-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    pushToast({ kind: 'success', message: 'Exported all data as CSV.' });
  }

  function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    void upsertCategory({ name, icon: 'Shape', essential: false, defaultKind: 'expense' });
    setNewCat('');
    pushToast({ kind: 'success', message: `Added category “${name}”.` });
  }

  async function submitChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setCpError(null);
    if (cpNew.length < 10) {
      setCpError('New password must be at least 10 characters.');
      return;
    }
    setCpBusy(true);
    try {
      await authApi.changePassword(cpCurrent, cpNew);
      setCpOpen(false);
      setCpCurrent('');
      setCpNew('');
      pushToast({ kind: 'success', message: 'Password changed. Please sign in again.' });
      // The server revokes every session on a password change — force a fresh login.
      await logout();
    } catch (err) {
      setCpError(err instanceof ApiError ? err.message : 'Could not change password.');
    } finally {
      setCpBusy(false);
    }
  }

  async function resendVerification() {
    if (!user) return;
    try {
      const sent = await resendVerificationEmail();
      pushToast({
        kind: 'info',
        message: sent
          ? 'A fresh verification link has been sent to your email.'
          : 'Your email is already verified.',
      });
    } catch (err) {
      pushToast({ kind: 'error', message: err instanceof Error ? err.message : 'Could not send verification email.' });
    }
  }

  // Firebase-only accounts have no in-app password; the reset link is emailed
  // (the backend dispatches it through Firebase). Legacy DB-password accounts
  // still change their password in-app, which re-authenticates server-side.
  async function emailPasswordReset() {
    if (!user) return;
    try {
      await authApi.forgotPassword(user.email);
      pushToast({ kind: 'success', message: 'A password-reset link has been emailed to you.' });
    } catch {
      pushToast({ kind: 'error', message: 'Could not send the reset email. Please try again.' });
    }
  }

  async function openImport() {
    setImportOpen(true);
    setPreview(null);
    try {
      setPreview(await previewBrowserData());
    } catch {
      pushToast({ kind: 'error', message: 'Could not read this browser’s stored data.' });
      setImportOpen(false);
    }
  }

  async function runImport() {
    setImportBusy(true);
    try {
      const res = await importBrowserData(false);
      setImportOpen(false);
      await reload();
      pushToast({
        kind: 'success',
        message: `Imported ${res.imported} records into your account${res.skippedDemo ? ` (skipped ${res.skippedDemo} demo)` : ''}.`,
      });
    } catch (err) {
      pushToast({ kind: 'error', message: err instanceof ApiError ? err.message : 'Import failed.' });
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">Preferences, categories, health trackers and full privacy controls.</p>
      </div>

      {/* General */}
      <Card>
        <CardTitle>General</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="st-name">
            <Input id="st-name" value={prefs.displayName} onChange={(e) => void updatePreferences({ displayName: e.target.value })} placeholder="Optional" />
          </Field>
          <Field label="Currency" htmlFor="st-cur">
            <Select id="st-cur" value={prefs.currency} onChange={(e) => void updatePreferences({ currency: e.target.value as CurrencyCode })}>
              {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </Select>
          </Field>
          <Field label="Time zone" htmlFor="st-tz">
            <Input id="st-tz" value={prefs.timeZone} onChange={(e) => void updatePreferences({ timeZone: e.target.value })} />
          </Field>
          <Field label="Budget period" htmlFor="st-bp">
            <Select id="st-bp" value={prefs.budgetPeriod} onChange={() => {}} disabled>
              <option value="calendar">Calendar month</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-6">
          <Toggle checked={prefs.reducedMotion} onChange={(v) => void updatePreferences({ reducedMotion: v })} label="Reduce motion" />
          <Toggle checked={prefs.remindersEnabled} onChange={(v) => void updatePreferences({ remindersEnabled: v })} label="Reminders enabled" />
        </div>
        {prefs.remindersEnabled && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <RemindersEditor />
          </div>
        )}
      </Card>

      {/* Money */}
      <Card>
        <CardTitle action={<Link to="/money" className="text-[12px] font-semibold text-lime hover:underline">Money hub →</Link>}>Categories & budgets</CardTitle>
        <div className="mb-3 flex gap-2">
          <Input placeholder="New custom category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New category" />
          <Button variant="primary" onClick={addCategory}>Add</Button>
        </div>
        <ul className="flex flex-wrap gap-2">
          {data.categories.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5 rounded-full border border-line bg-lowest/40 py-1 pl-3 pr-1 text-[13px]">
              <span className="text-ink">{c.name}</span>
              {c.essential && <Chip tone="lime">essential</Chip>}
              {!c.builtin && (
                <button onClick={() => void deleteCategory(c.id)} aria-label={`Delete ${c.name}`} className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-danger/20 hover:text-danger">✕</button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted">
          Set default budgets and roast thresholds from their own pages:{' '}
          <Link to="/money" className="text-lime hover:underline">Budgets</Link> ·{' '}
          <Link to="/roast" className="text-coral hover:underline">Wallet Roast Mode</Link>.
        </p>
      </Card>

      {/* Health preferences */}
      <Card>
        <CardTitle>Health</CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[13px] font-medium text-muted">Measurement types</p>
            <ul className="flex flex-wrap gap-2">
              {data.measurementTypes.map((t) => (<li key={t.id} className="rounded-full border border-line bg-lowest/40 px-3 py-1 text-[13px] text-ink">{t.name} <span className="text-muted">({t.unit})</span></li>))}
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-medium text-muted">Medication reminders are opt-in and only ever based on schedules you enter yourself.</p>
          </div>
        </div>
      </Card>

      {/* Account (authenticated server storage) */}
      {serverMode && user && (
        <Card>
          <CardTitle>Account</CardTitle>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-lowest/40 p-3">
              <div>
                <p className="text-sm font-semibold text-ink">{user.email}</p>
                <p className="text-[12px] text-muted">{user.emailVerified ? 'Email verified.' : 'Email not verified yet.'}</p>
              </div>
              {!user.emailVerified && (
                <Button variant="secondary" size="sm" onClick={() => void resendVerification()}>Resend verification</Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {user.hasPassword ? (
                <Button variant="secondary" onClick={() => setCpOpen(true)}>Change password</Button>
              ) : (
                <Button variant="secondary" onClick={() => void emailPasswordReset()}>Email password-reset link</Button>
              )}
              <Button variant="ghost" onClick={() => void openImport()}>Import data from this browser</Button>
            </div>
            <p className="text-[12px] text-muted">
              {user.hasPassword
                ? 'Changing your password signs you out of every device. '
                : 'Your sign-in is managed by Firebase, so password changes are emailed as a secure reset link. '}
              Importing copies this browser’s locally-stored records into your account and never touches another user’s data.
            </p>
          </div>
        </Card>
      )}

      {/* Privacy center */}
      <Card className="border-coral/20">
        <CardTitle>Privacy center</CardTitle>
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-lowest/40 p-3">
          <span className="h-2.5 w-2.5 rounded-full bg-lime" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-ink">
              Storage mode: {serverMode ? 'Authenticated account' : 'Local only'}
            </p>
            <p className="text-[12px] text-muted">
              {serverMode
                ? 'Your records are stored in the server database under your account and are only reachable with your authenticated session. There is no bank connection, device sync or third-party analytics.'
                : 'Data lives in this browser via IndexedDB. There is no cloud sync, encrypted-backup, bank connection or device sync — none are claimed because none exist.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportEverything}>Export all data (CSV)</Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete all data</Button>
        </div>
        <p className="mt-3 text-[12px] text-muted">
          Your records: {data.transactions.length} transactions, {data.healthLogs.length} health logs.
        </p>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete ALL data?"
        tone="danger"
        confirmLabel="Delete everything"
        message={
          <span>
            This permanently removes <strong className="text-ink">every transaction, salary, budget, allocation, health log,
            measurement and setting</strong> from this browser, including preferences. This cannot be undone. Export first if
            you want a copy.
          </span>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { void deleteAllData(); setConfirmDelete(false); }}
      />

      <Modal open={cpOpen} onClose={() => setCpOpen(false)} title="Change password">
        <form className="flex flex-col gap-4" onSubmit={submitChangePassword}>
          {cpError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">{cpError}</div>
          )}
          <Field label="Current password" htmlFor="cp-current">
            <Input id="cp-current" type="password" required value={cpCurrent} onChange={(e) => setCpCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password" htmlFor="cp-new" hint="At least 10 characters.">
            <Input id="cp-new" type="password" required value={cpNew} onChange={(e) => setCpNew(e.target.value)} autoComplete="new-password" />
          </Field>
          <p className="text-[12px] text-muted">For security, this signs you out of all devices.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCpOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={cpBusy}>{cpBusy ? <Spinner /> : 'Change password'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import data from this browser">
        <div className="flex flex-col gap-4">
          {!preview ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Reading this browser’s stored data…</div>
          ) : (
            <>
              <p className="text-[13px] text-ink">
                Found <strong>{preview.total}</strong> local records
                {preview.demoCount > 0 ? <> (including <strong>{preview.demoCount}</strong> demo records)</> : null}.
                These will be copied into your account. Your browser data is left untouched.
              </p>
              {preview.demoCount > 0 && (
                <p className="text-[12px] text-muted">
                  {preview.demoCount} synthetic demo records were found and will be skipped — only your real data is imported.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button variant="primary" disabled={importBusy || preview.total === 0} onClick={() => void runImport()}>
                  {importBusy ? <Spinner /> : 'Import into my account'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function RemindersEditor() {
  const { data, updateReminders } = useApp();
  if (!data) return null;
  const r = data.reminders;
  return (
    <div className="flex flex-col gap-3">
      <Toggle checked={r.healthDailyLog} onChange={(v) => void updateReminders({ ...r, healthDailyLog: v })} label="Daily health-log nudge" />
      <Toggle checked={r.medication} onChange={(v) => void updateReminders({ ...r, medication: v })} label="Medication (only for schedules you set)" />
      <Toggle checked={r.budgetReview} onChange={(v) => void updateReminders({ ...r, budgetReview: v })} label="Monthly budget review" />
      <Field label="Reminder time" htmlFor="st-rt">
        <Input id="st-rt" type="time" value={r.timeOfDay} onChange={(e) => void updateReminders({ ...r, timeOfDay: e.target.value })} />
      </Field>
      <p className="text-[12px] text-muted">Reminders are shown in-app while the page is open. Background push is not implemented.</p>
    </div>
  );
}
