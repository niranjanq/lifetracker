import { useMemo, useState } from 'react';
import { Card, CardTitle, Button, Chip, EmptyState, Field, Input, Select, Textarea, ConfirmDialog } from '../components/ui/primitives';
import { useApp } from '../state/store';
import { useMoney } from '../state/useMoney';
import { currentISODate, formatDay } from '../domain/date';
import type { HealthLog, MedicationLog, MeasurementEntry, WellbeingRating } from '../domain/types';

type Tab = 'log' | 'symptoms' | 'medication' | 'measurements';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'log', label: 'Daily log' },
  { id: 'symptoms', label: 'Symptoms' },
  { id: 'medication', label: 'Medication' },
  { id: 'measurements', label: 'Measurements' },
];

const WELLBEING: Array<{ v: WellbeingRating; label: string }> = [
  { v: 1, label: '1 · Poor' },
  { v: 2, label: '2 · Low' },
  { v: 3, label: '3 · Okay' },
  { v: 4, label: '4 · Good' },
  { v: 5, label: '5 · Great' },
];

export function Health() {
  const { data } = useApp();
  const [tab, setTab] = useState<Tab>('log');
  if (!data) return null;
  const today = currentISODate();
  const loggedToday = data.healthLogs.some((h) => h.date === today);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Health</h1>
          <p className="text-sm text-muted">Private, manual tracking. No wearables, no automatic telemetry, no diagnoses.</p>
        </div>
        <Chip tone={loggedToday ? 'lime' : 'muted'}>{loggedToday ? 'Logged today ✓' : 'Not logged today'}</Chip>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ' + (tab === t.id ? 'bg-coral text-coral-on' : 'border border-line bg-raised/50 text-muted hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' && <LogTab />}
      {tab === 'symptoms' && <SymptomsTab />}
      {tab === 'medication' && <MedicationTab />}
      {tab === 'measurements' && <MeasurementsTab />}
    </div>
  );
}

/* ------------------------------ Daily log ------------------------------ */
interface SymptomDraft { name: string; severity: number; durationHours: string; trigger: string; note: string }

function LogTab() {
  const { data, saveHealthLog, deleteHealthLog } = useApp();
  const [editing, setEditing] = useState<HealthLog | null>(null);
  const [form, setForm] = useState<{ date: string; time: string; wellbeing: WellbeingRating; note: string; activityImpact: string }>({
    date: currentISODate(), time: '', wellbeing: 3, note: '', activityImpact: '',
  });
  const [symptoms, setSymptoms] = useState<SymptomDraft[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!data) return null;
  const logs = [...data.healthLogs].sort((a, b) => (a.date < b.date ? 1 : -1));

  function resetForm() {
    setEditing(null);
    setForm({ date: currentISODate(), time: '', wellbeing: 3, note: '', activityImpact: '' });
    setSymptoms([]);
  }

  function startEdit(log: HealthLog) {
    setEditing(log);
    setForm({ date: log.date, time: log.time ?? '', wellbeing: log.wellbeing, note: log.note ?? '', activityImpact: log.activityImpact ?? '' });
    setSymptoms(data!.symptoms.filter((s) => s.logId === log.id).map((s) => ({ name: s.name, severity: s.severity, durationHours: s.durationHours?.toString() ?? '', trigger: s.trigger ?? '', note: s.note ?? '' })));
  }

  function addSymptom() {
    setSymptoms((s) => [...s, { name: '', severity: 5, durationHours: '', trigger: '', note: '' }]);
  }

  function save() {
    if (!form.date) return;
    void saveHealthLog(
      { id: editing?.id, createdAt: editing?.createdAt, ...form },
      symptoms.filter((s) => s.name.trim()).map((s) => ({
        name: s.name.trim(),
        severity: Math.min(10, Math.max(1, s.severity)),
        durationHours: s.durationHours ? Number(s.durationHours) : undefined,
        trigger: s.trigger.trim() || undefined,
        note: s.note.trim() || undefined,
      })),
    );
    resetForm();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Card>
        <CardTitle>{editing ? 'Edit health log' : 'New daily health log'}</CardTitle>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="hl-date"><Input id="hl-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Time (optional)" htmlFor="hl-time"><Input id="hl-time" type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></Field>
          </div>
          <Field label="Overall wellbeing">
            <div className="flex flex-wrap gap-1.5">
              {WELLBEING.map((w) => (
                <button key={w.v} type="button" onClick={() => setForm((f) => ({ ...f, wellbeing: w.v }))}
                  aria-pressed={form.wellbeing === w.v}
                  className={'rounded-full border px-3 py-1.5 text-[13px] font-medium transition ' + (form.wellbeing === w.v ? 'border-coral bg-coral/15 text-coral' : 'border-line text-muted hover:text-ink')}>
                  {w.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notes" htmlFor="hl-note"><Textarea id="hl-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="How are you feeling? Anything worth remembering?" /></Field>
          <Field label="Impact on daily activities (optional)" htmlFor="hl-impact"><Input id="hl-impact" value={form.activityImpact} onChange={(e) => setForm((f) => ({ ...f, activityImpact: e.target.value }))} /></Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-muted">Symptoms</span>
              <Button size="sm" variant="ghost" onClick={addSymptom}>Add symptom</Button>
            </div>
            <div className="flex flex-col gap-2">
              {symptoms.length === 0 && <p className="text-[12px] text-muted/70">No symptoms added. Suspected triggers are your own notes — the app never infers causes.</p>}
              {symptoms.map((s, i) => (
                <div key={i} className="rounded-lg border border-line bg-lowest/40 p-2">
                  <div className="flex gap-2">
                    <Input placeholder="Symptom name" value={s.name} onChange={(e) => setSymptoms((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Symptom name" />
                    <Input placeholder="Hrs" inputMode="numeric" value={s.durationHours} onChange={(e) => setSymptoms((arr) => arr.map((x, j) => (j === i ? { ...x, durationHours: e.target.value } : x)))} className="max-w-[70px]" aria-label="Duration hours" />
                    <Button size="sm" variant="ghost" onClick={() => setSymptoms((arr) => arr.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-muted">Severity {s.severity}/10</span>
                    <input type="range" min={1} max={10} value={s.severity} onChange={(e) => setSymptoms((arr) => arr.map((x, j) => (j === i ? { ...x, severity: Number(e.target.value) } : x)))} className="flex-1 accent-coral" aria-label="Severity" />
                  </div>
                  <Input placeholder="Suspected trigger (optional)" value={s.trigger} onChange={(e) => setSymptoms((arr) => arr.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)))} className="mt-2" aria-label="Suspected trigger" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {editing && <Button variant="ghost" onClick={resetForm}>Cancel</Button>}
            <Button variant="health" onClick={save}>{editing ? 'Save changes' : 'Save log'}</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>History</CardTitle>
        {logs.length ? (
          <ul className="divide-y divide-line">
            {logs.map((h) => {
              const syms = data!.symptoms.filter((s) => s.logId === h.id);
              return (
                <li key={h.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{formatDay(h.date)}</span>
                      <WellbeingPips level={h.wellbeing} />
                      {h.demo && <Chip tone="violet">demo</Chip>}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(h)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(h.id)}>Delete</Button>
                    </div>
                  </div>
                  {h.note && <p className="mt-1 text-[13px] text-muted">{h.note}</p>}
                  {syms.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {syms.map((s) => <Chip key={s.id} tone="coral">{s.name} · {s.severity}/10</Chip>)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No health logs yet" description="Record how you're feeling — it stays on this device." />
        )}
      </Card>

      <ConfirmDialog open={!!confirmId} title="Delete health log?" message="Symptoms attached to this log will also be removed." confirmLabel="Delete" onCancel={() => setConfirmId(null)} onConfirm={() => { if (confirmId) void deleteHealthLog(confirmId); setConfirmId(null); }} />
    </div>
  );
}

function WellbeingPips({ level }: { level: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Wellbeing ${level} of 5`}>
      {Array.from({ length: 5 }, (_, i) => <span key={i} className={'h-1.5 w-1.5 rounded-full ' + (i < level ? 'bg-coral' : 'bg-raised')} />)}
    </span>
  );
}

/* ------------------------------- Symptoms ------------------------------ */
function SymptomsTab() {
  const { data } = useApp();
  const [q, setQ] = useState('');
  if (!data) return null;
  const logById = new Map(data.healthLogs.map((h) => [h.id, h]));
  const rows = data.symptoms
    .map((s) => ({ s, log: logById.get(s.logId) }))
    .filter((r) => r.log)
    .filter((r) => !q || r.s.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.log!.date < b.log!.date ? 1 : -1));

  const freq = useMemo(() => {
    const map = new Map<string, { count: number; maxSev: number }>();
    for (const r of rows) {
      const cur = map.get(r.s.name) ?? { count: 0, maxSev: 0 };
      cur.count++;
      cur.maxSev = Math.max(cur.maxSev, r.s.severity);
      map.set(r.s.name, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [rows]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Symptom frequency</CardTitle>
        <p className="mb-3 text-[12px] text-muted">Counted from your own logs. The app does not claim any trigger caused a symptom.</p>
        {freq.length ? (
          <ul className="flex flex-col gap-2">
            {freq.map(([name, v]) => (
              <li key={name} className="flex items-center justify-between rounded-lg border border-line bg-lowest/40 px-3 py-2">
                <span className="text-sm text-ink">{name}</span>
                <span className="text-[12px] text-muted nums">{v.count}× · max severity {v.maxSev}/10</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No symptoms recorded" description="Add symptoms while logging your day." />
        )}
      </Card>
      <Card>
        <CardTitle>All symptom entries</CardTitle>
        <Input placeholder="Search symptoms…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" aria-label="Search symptoms" />
        {rows.length ? (
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {rows.map(({ s, log }) => (
              <li key={s.id} className="py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">{s.name}</span>
                  <span className="text-[12px] text-muted">{formatDay(log!.date)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Chip tone="coral">severity {s.severity}/10</Chip>
                  {s.durationHours != null && <span>{s.durationHours}h</span>}
                  {s.trigger && <span>trigger noted: {s.trigger}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing here" description="No symptom entries match." />
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Medication ----------------------------- */
function MedicationTab() {
  const { data, upsertMedication, deleteMedication } = useApp();
  const [form, setForm] = useState<{ name: string; dose: string; date: string; time: string; note: string }>({ name: '', dose: '', date: currentISODate(), time: '', note: '' });
  if (!data) return null;
  const rows = [...data.medicationLogs].sort((a, b) => (a.date < b.date ? 1 : -1));
  function submit() {
    if (!form.name.trim() || !form.dose.trim() || !form.date) return;
    void upsertMedication({ name: form.name.trim(), dose: form.dose.trim(), date: form.date, time: form.time || undefined, note: form.note || undefined });
    setForm({ name: '', dose: '', date: currentISODate(), time: '', note: '' });
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardTitle>Log a medication</CardTitle>
        <p className="mb-3 text-[12px] text-muted">Record exactly what was prescribed. This app never advises dosage or changes.</p>
        <div className="flex flex-col gap-3">
          <Field label="Medication name" htmlFor="md-name"><Input id="md-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Dose (as prescribed)" htmlFor="md-dose"><Input id="md-dose" value={form.dose} onChange={(e) => setForm((f) => ({ ...f, dose: e.target.value }))} placeholder="e.g. 500 mg" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date taken" htmlFor="md-date"><Input id="md-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Time (optional)" htmlFor="md-time"><Input id="md-time" type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></Field>
          </div>
          <Field label="Note (optional)" htmlFor="md-note"><Input id="md-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
          <div className="flex justify-end"><Button variant="health" onClick={submit}>Add log</Button></div>
        </div>
      </Card>
      <Card>
        <CardTitle>Medication history</CardTitle>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((m: MedicationLog) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm text-ink">{m.name} <span className="text-muted">· {m.dose}</span></p>
                  <p className="text-[12px] text-muted">{formatDay(m.date)}{m.time ? ` ${m.time}` : ''}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void deleteMedication(m.id)}>Delete</Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No medication logs" />
        )}
      </Card>
    </div>
  );
}

/* ---------------------------- Measurements ---------------------------- */
function MeasurementsTab() {
  const { data, upsertMeasurement, deleteMeasurement } = useApp();
  const [form, setForm] = useState<{ typeId: string; date: string; value: string; note: string }>({ typeId: '', date: currentISODate(), value: '', note: '' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!data) return null;
  const types = data.measurementTypes;
  const initialTypeId = form.typeId || types[0]?.id || '';
  const selected = types.find((t) => t.id === (form.typeId || types[0]?.id));
  const entries = [...data.measurementEntries].filter((m) => m.typeId === (form.typeId || types[0]?.id)).sort((a, b) => (a.date < b.date ? 1 : -1));

  function submit() {
    if (!selected) return;
    const num = form.value === '' ? null : Number(form.value);
    if (num !== null && (!Number.isFinite(num) || num < 0)) return;
    void upsertMeasurement({ typeId: selected.id, date: form.date, value: num, note: form.note || undefined });
    setForm((f) => ({ ...f, value: '', note: '' }));
  }

  const latest = entries.find((e) => e.value !== null);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardTitle>Add measurement</CardTitle>
        <div className="flex flex-col gap-3">
          <Field label="Measurement" htmlFor="ms-type">
            <Select id="ms-type" value={initialTypeId} onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}>
              {types.map((t) => (<option key={t.id} value={t.id}>{t.name} ({t.unit})</option>))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="ms-date"><Input id="ms-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label={`Value ${selected ? '(' + selected.unit + ')' : ''}`} htmlFor="ms-val"><Input id="ms-val" inputMode="decimal" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} /></Field>
          </div>
          <Field label="Note (optional)" htmlFor="ms-note"><Input id="ms-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
          <div className="flex justify-end"><Button variant="health" onClick={submit}>Save</Button></div>
        </div>
      </Card>
      <Card>
        <CardTitle>{selected ? `${selected.name} history` : 'History'}</CardTitle>
        {selected && latest && (
          <p className="mb-3 text-sm text-muted">Latest: <span className="nums font-bold text-ink">{latest.value} {selected.unit}</span> ({formatDay(latest.date)})</p>
        )}
        {entries.length ? (
          <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
            {entries.map((m: MeasurementEntry) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-ink">{formatDay(m.date)}</span>
                <span className="flex items-center gap-2">
                  <span className={'nums text-sm font-semibold ' + (m.value === null ? 'text-muted' : 'text-coral')}>
                    {m.value === null ? 'No value recorded' : `${m.value} ${selected?.unit}`}
                  </span>
                  {m.demo && <Chip tone="violet">demo</Chip>}
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(m.id)}>Delete</Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No measurements yet" description="Missing values are never treated as zero." />
        )}
      </Card>
      <ConfirmDialog open={!!confirmId} title="Delete measurement?" confirmLabel="Delete" message="This entry will be removed from local storage." onCancel={() => setConfirmId(null)} onConfirm={() => { if (confirmId) void deleteMeasurement(confirmId); setConfirmId(null); }} />
    </div>
  );
}
