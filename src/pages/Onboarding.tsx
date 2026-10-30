import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { Button, Field, Input, Select, Toggle, Card } from '../components/ui/primitives';
import { parseToMinor } from '../domain/money';
import { CAT } from '../domain/categories';
import { currentISODate, currentYearMonth } from '../domain/date';
import { newId } from '../repo/local';
import type { CurrencyCode } from '../domain/types';

const CURRENCIES: CurrencyCode[] = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'JPY'];
const STEPS = ['Welcome', 'Preferences', 'Money setup', 'Health setup', 'Review'];

interface FinState {
  expectedSalary: string;
  actualReceived: string;
  receiptDate: string;
  rent: string;
  sip: string;
  family: string;
  savings: string;
  variable: string;
}

export function Onboarding() {
  const { updatePreferences, data, setPlan, upsertAllocation, upsertBudget, upsertSalaryReceipt } = useApp();
  const currency = data?.preferences.currency ?? 'INR';
  const serverMode = data?.meta.storageMode === 'server';
  const [step, setStep] = useState(0);

  const [prefs, setPrefs] = useState({
    displayName: '',
    currency: 'INR' as CurrencyCode,
    timeZone: 'Asia/Kolkata',
    theme: 'dark' as 'dark' | 'light',
    reducedMotion: false,
    remindersEnabled: false,
  });
  const [fin, setFin] = useState<FinState>({
    expectedSalary: '',
    actualReceived: '',
    receiptDate: currentISODate(),
    rent: '',
    sip: '',
    family: '',
    savings: '',
    variable: '',
  });
  const [health, setHealth] = useState({ symptoms: true, medication: false, measurements: false, notes: true });

  const review = useMemo(() => {
    const parsed = (v: string) => parseToMinor(v || '0', prefs.currency);
    return {
      totalPlanned:
        parsed(fin.rent) + parsed(fin.sip) + parsed(fin.family) + parsed(fin.savings) + parsed(fin.variable),
      expected: parsed(fin.expectedSalary),
    };
  }, [fin, prefs.currency]);

  function set<K extends keyof FinState>(k: K, v: string) {
    setFin((p) => ({ ...p, [k]: v }));
  }

  async function finish() {
    await updatePreferences({ ...prefs, onboarded: true });
    const month = currentYearMonth();
    // Financial plan + allocations + budget derived from setup (only if provided).
    if (review.expected > 0) {
      await setPlan({ month, expectedSalaryMinor: review.expected });
    }
    const allocMap: Array<[string, string, string]> = [
      [CAT.rent, 'Room rent', fin.rent],
      [CAT.sip, 'SIP / investments', fin.sip],
      [CAT.family, 'Money sent home', fin.family],
      [CAT.savings, 'Savings', fin.savings],
      [CAT.food, 'Variable spending', fin.variable],
    ];
    for (const [categoryId, label, raw] of allocMap) {
      const amountMinor = parseToMinor(raw || '0', prefs.currency);
      if (amountMinor > 0) {
        await upsertAllocation({ id: newId('alloc'), month, categoryId, label, plannedMinor: amountMinor });
      }
    }
    const variableMinor = parseToMinor(fin.variable || '0', prefs.currency);
    if (variableMinor > 0) {
      await upsertBudget({ id: newId('bud'), month, categoryId: null, limitMinor: variableMinor });
    }
    const receivedMinor = parseToMinor(fin.actualReceived || '0', prefs.currency);
    if (receivedMinor > 0) {
      await upsertSalaryReceipt({
        id: newId('sal'),
        month,
        amountMinor: receivedMinor,
        date: fin.receiptDate,
        source: 'Salary',
      });
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <header className="mb-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-lime/15 text-lime shadow-lime">
          <span className="font-display text-2xl font-extrabold">P</span>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Personal Life Tracker</h1>
        <p className="mt-1 text-sm text-muted">Private, manual-first tracking for money and health.</p>
      </header>

      {/* Stepper */}
      <ol className="mb-6 flex items-center justify-between gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={
                'grid h-7 w-7 place-items-center rounded-full text-xs font-bold ' +
                (i <= step ? 'bg-lime text-lime-on' : 'bg-raised text-muted')
              }
            >
              {i + 1}
            </span>
            <span className={'text-[10px] font-semibold uppercase tracking-wide ' + (i === step ? 'text-ink' : 'text-muted')}>
              {s}
            </span>
          </li>
        ))}
      </ol>

      <Card className="flex-1">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-semibold">Welcome</h2>
            <p className="text-sm text-muted">
              This app is <strong className="text-ink">manual-first</strong>. You type in your salary, planned
              allocations, actual spending, and health notes. There is <strong className="text-ink">no bank, card, UPI,
              or wearable connection</strong> — ever.{' '}
              {serverMode
                ? 'Your data is stored securely in your own account on the server.'
                : 'Your data is stored only on this device in your browser.'}
            </p>
            <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
              <li className="rounded-lg border border-line bg-lowest/40 p-3">💸 Track salary, budgets and spending</li>
              <li className="rounded-lg border border-line bg-lowest/40 p-3">🩺 Log symptoms, medication & measurements</li>
              <li className="rounded-lg border border-line bg-lowest/40 p-3">🔥 Get accountable with Wallet Roast Mode</li>
              <li className="rounded-lg border border-line bg-lowest/40 p-3">🔒 Export or delete everything anytime</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name (optional)" htmlFor="ob-name">
              <Input id="ob-name" value={prefs.displayName} onChange={(e) => setPrefs((p) => ({ ...p, displayName: e.target.value }))} placeholder="What should we call you?" />
            </Field>
            <Field label="Currency" htmlFor="ob-cur">
              <Select id="ob-cur" value={prefs.currency} onChange={(e) => setPrefs((p) => ({ ...p, currency: e.target.value as CurrencyCode }))}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Time zone" htmlFor="ob-tz">
              <Input id="ob-tz" value={prefs.timeZone} onChange={(e) => setPrefs((p) => ({ ...p, timeZone: e.target.value }))} />
            </Field>
            <Field label="Budget period" htmlFor="ob-bp">
              <Select id="ob-bp" value="calendar" disabled>
                <option value="calendar">Calendar month</option>
              </Select>
            </Field>
            <div className="flex items-center gap-6 pt-1 sm:col-span-2">
              <Toggle checked={prefs.reducedMotion} onChange={(v) => setPrefs((p) => ({ ...p, reducedMotion: v }))} label="Reduce motion" />
              <Toggle checked={prefs.remindersEnabled} onChange={(v) => setPrefs((p) => ({ ...p, remindersEnabled: v }))} label="Optional reminders" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-muted sm:col-span-2">
              Enter what you know — every field is optional and editable later in Money.
            </p>
            <Field label="Expected monthly salary" htmlFor="ob-exp">
              <Input id="ob-exp" inputMode="decimal" value={fin.expectedSalary} onChange={(e) => set('expectedSalary', e.target.value)} placeholder="40000" />
            </Field>
            <Field label="Actual salary received (if already)" htmlFor="ob-act">
              <Input id="ob-act" inputMode="decimal" value={fin.actualReceived} onChange={(e) => set('actualReceived', e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Salary receipt date" htmlFor="ob-date">
              <Input id="ob-date" type="date" value={fin.receiptDate} onChange={(e) => set('receiptDate', e.target.value)} />
            </Field>
            <Field label="Planned room rent" htmlFor="ob-rent">
              <Input id="ob-rent" inputMode="decimal" value={fin.rent} onChange={(e) => set('rent', e.target.value)} placeholder="8000" />
            </Field>
            <Field label="Planned SIP / investments" htmlFor="ob-sip">
              <Input id="ob-sip" inputMode="decimal" value={fin.sip} onChange={(e) => set('sip', e.target.value)} placeholder="5000" />
            </Field>
            <Field label="Planned money sent home" htmlFor="ob-fam">
              <Input id="ob-fam" inputMode="decimal" value={fin.family} onChange={(e) => set('family', e.target.value)} placeholder="7000" />
            </Field>
            <Field label="Planned savings" htmlFor="ob-sav">
              <Input id="ob-sav" inputMode="decimal" value={fin.savings} onChange={(e) => set('savings', e.target.value)} placeholder="5000" />
            </Field>
            <Field label="Planned monthly variable spending" htmlFor="ob-var">
              <Input id="ob-var" inputMode="decimal" value={fin.variable} onChange={(e) => set('variable', e.target.value)} placeholder="15000" />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">Choose which health trackers to enable. You can skip this and change it anytime. No medical information is required.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle checked={health.symptoms} onChange={(v) => setHealth((h) => ({ ...h, symptoms: v }))} label="Symptom tracking" />
              <Toggle checked={health.medication} onChange={(v) => setHealth((h) => ({ ...h, medication: v }))} label="Medication log" />
              <Toggle checked={health.measurements} onChange={(v) => setHealth((h) => ({ ...h, measurements: v }))} label="Measurements" />
              <Toggle checked={health.notes} onChange={(v) => setHealth((h) => ({ ...h, notes: v }))} label="Daily wellbeing notes" />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-semibold">Review</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Name</dt>
              <dd className="text-right text-ink">{prefs.displayName || '—'}</dd>
              <dt className="text-muted">Currency</dt>
              <dd className="text-right text-ink">{prefs.currency}</dd>
              <dt className="text-muted">Expected salary</dt>
              <dd className="text-right nums text-ink">{currencySymbol(prefs.currency)}{review.expected / 100 || '—'}</dd>
              <dt className="text-muted">Total planned</dt>
              <dd className="text-right nums text-ink">{currencySymbol(prefs.currency)}{review.totalPlanned / 100 || '—'}</dd>
              <dt className="text-muted">Unallocated</dt>
              <dd className={'text-right nums font-semibold ' + (review.expected - review.totalPlanned < 0 ? 'text-coral' : 'text-lime')}>
                {currencySymbol(prefs.currency)}{(review.expected - review.totalPlanned) / 100}
              </dd>
            </dl>
            {review.totalPlanned > review.expected && review.expected > 0 && (
              <p className="rounded-lg border border-coral/30 bg-coral/10 p-3 text-sm text-coral">
                Your planned allocations exceed your expected salary. That's fine — you can adjust in Money.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void finish()}>
              Start tracking
            </Button>
          )}
        </div>
      </Card>
      <p className="mt-3 text-center text-[11px] text-muted">
        {serverMode
          ? 'Storage mode: your account · Manual entry only · You own your data'
          : 'Storage mode: local only · No cloud sync · You own your data'}
      </p>
    </div>
  );
}

function currencySymbol(c: CurrencyCode): string {
  return { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', JPY: '¥' }[c];
}
