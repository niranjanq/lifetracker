import { useMemo, useState } from 'react';
import { Card, CardTitle, Button, Chip, Field, Input, Select, Toggle, Segmented, EmptyState, ConfirmDialog } from '../components/ui/primitives';
import { useApp, computeFinanceSummary, toFinanceData } from '../state/store';
import { useMonth } from '../state/month';
import { useMoney } from '../state/useMoney';
import { DEFAULT_ROAST_SETTINGS, THRESHOLD_MAX, THRESHOLD_MIN, computeUsagePct, isRoastEligible, roastMessage, validateThresholds } from '../domain/roast';
import { formatYearMonth } from '../domain/date';
import type { RoastIntensity, RoastSettings } from '../domain/types';
import { Flame, Plus, Trash2 } from 'lucide-react';

export function Roast() {
  const { data, updateRoastSettings, pushToast } = useApp();
  const { month } = useMonth();
  const { fmt } = useMoney();
  const settings = data?.roastSettings ?? DEFAULT_ROAST_SETTINGS;

  const [draft, setDraft] = useState<RoastSettings>(settings);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);
  const [confirmTest, setConfirmTest] = useState(false);

  function patch(p: Partial<RoastSettings>) {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  }

  function setThreshold(i: number, value: number) {
    const t = [...draft.thresholds];
    t[i] = value;
    patch({ thresholds: t });
  }
  function addThreshold() {
    const last = draft.thresholds[draft.thresholds.length - 1] ?? 60;
    patch({ thresholds: [...draft.thresholds, Math.min(THRESHOLD_MAX, last + 10)] });
  }
  function removeThreshold(i: number) {
    patch({ thresholds: draft.thresholds.filter((_, j) => j !== i) });
  }

  async function save() {
    const errs = validateThresholds(draft.thresholds);
    setErrors(errs);
    if (errs.length) {
      pushToast({ kind: 'error', message: 'Fix threshold issues before saving.' });
      return;
    }
    await updateRoastSettings(draft);
    setSaved(true);
    pushToast({ kind: 'success', message: 'Roast settings saved.' });
  }

  // Live preview using verified current-month numbers.
  const preview = useMemo(() => {
    if (!data) return [];
    const s = computeFinanceSummary(month, toFinanceData(data, month));
    const catById = new Map(data.categories.map((c) => [c.id, c]));
    const rows: Array<{ scope: 'overall' | 'category'; categoryId?: string; name: string; limit: number; used: number }> = [
      { scope: 'overall', name: 'Monthly spending', limit: s.overallBudgetMinor, used: s.netSpendingMinor },
    ];
    for (const c of s.categorySpend) {
      const limit = data.budgets.find((b) => b.month === month && b.categoryId === c.categoryId)?.limitMinor ?? 0;
      if (limit > 0) rows.push({ scope: 'category', categoryId: c.categoryId, name: catById.get(c.categoryId)?.name ?? 'Category', limit, used: c.netMinor });
    }
    return rows.map((r) => {
      const pct = computeUsagePct(r.used, r.limit);
      const eligible = r.scope === 'overall' ? true : isRoastEligible(catById.get(r.categoryId ?? ''), draft);
      return { ...r, pct, eligible };
    });
  }, [data, month, draft]);

  const events = (data?.roastEvents ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-coral/15 text-coral shadow-coral"><Flame size={22} /></span>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Wallet Roast Mode</h1>
          <p className="text-sm text-muted">Witty accountability on real numbers. Essential spending is never roasted.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Settings */}
        <Card>
          <CardTitle action={!saved && <Chip tone="coral">unsaved</Chip>}>Settings</CardTitle>
          <div className="flex flex-col gap-4">
            <Toggle checked={draft.enabled} onChange={(v) => patch({ enabled: v })} label="Roast mode enabled" />

            <Field label="Intensity">
              <Segmented<RoastIntensity>
                ariaLabel="Roast intensity"
                value={draft.intensity}
                onChange={(v) => patch({ intensity: v })}
                options={[{ value: 'mild', label: 'Mild' }, { value: 'balanced', label: 'Balanced' }, { value: 'savage', label: 'Savage' }]}
              />
            </Field>

            <Field label="Thresholds (%)" hint={`Whole numbers, ${THRESHOLD_MIN}–${THRESHOLD_MAX}%, strictly ascending, unique.`}>
              <div className="flex flex-col gap-2">
                {draft.thresholds.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="number" min={THRESHOLD_MIN} max={THRESHOLD_MAX} value={Number.isFinite(t) ? t : ''} onChange={(e) => setThreshold(i, Number(e.target.value))} className="max-w-[120px]" aria-label={`Threshold ${i + 1}`} />
                    <span className="text-muted">%</span>
                    <Button size="sm" variant="ghost" onClick={() => removeThreshold(i)} aria-label="Remove threshold"><Trash2 size={14} /></Button>
                  </div>
                ))}
                <div><Button size="sm" variant="secondary" onClick={addThreshold}><Plus size={14} /> Add threshold</Button></div>
                {errors.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-[12px] text-danger">
                    {errors.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                )}
              </div>
            </Field>

            <Toggle checked={draft.notifyOnCross} onChange={(v) => patch({ notifyOnCross: v })} label="In-app alert on threshold crossing" />

            <Field label="Category exclusions" hint="Beyond essential categories, never roast these.">
              <div className="flex flex-wrap gap-1.5">
                {(data?.categories ?? []).filter((c) => !c.essential && c.defaultKind === 'expense').map((c) => {
                  const excluded = draft.excludedCategoryIds.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => patch({ excludedCategoryIds: excluded ? draft.excludedCategoryIds.filter((x) => x !== c.id) : [...draft.excludedCategoryIds, c.id] })}
                      className={'rounded-full border px-2.5 py-1 text-[12px] transition ' + (excluded ? 'border-coral/40 bg-coral/10 text-coral' : 'border-line text-muted hover:text-ink')}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="flex items-center justify-between">
              <Toggle checked={draft.quietHoursEnabled} onChange={(v) => patch({ quietHoursEnabled: v })} label="Quiet hours" />
            </div>
            {draft.quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="q-start"><Input id="q-start" type="time" value={draft.quietHoursStart} onChange={(e) => patch({ quietHoursStart: e.target.value })} /></Field>
                <Field label="To" htmlFor="q-end"><Input id="q-end" type="time" value={draft.quietHoursEnd} onChange={(e) => patch({ quietHoursEnd: e.target.value })} /></Field>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDraft(settings); setSaved(true); setErrors([]); }}>Reset</Button>
              <Button variant="primary" onClick={() => void save()}>Save settings</Button>
            </div>
          </div>
        </Card>

        {/* Live preview */}
        <Card>
          <CardTitle>Live preview · {formatYearMonth(month)}</CardTitle>
          {!draft.enabled ? (
            <p className="rounded-lg border border-line bg-lowest/40 p-3 text-sm text-muted">Roast mode is off. Enable it to see previews.</p>
          ) : preview.length ? (
            <ul className="flex flex-col gap-3">
              {preview.map((r, i) => (
                <li key={i} className="rounded-lg border border-line bg-lowest/40 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-ink">{r.name}</span>
                    <span className="nums text-muted">{fmt(r.used)} / {fmt(r.limit)} · {r.pct}%</span>
                  </div>
                  {!r.eligible ? (
                    <p className="mt-1 text-[12px] text-muted">Exempt — essential or excluded from roasting (totals unaffected).</p>
                  ) : r.pct >= (draft.thresholds[0] ?? 75) ? (
                    <p className="mt-1 flex items-start gap-1.5 text-[13px] text-coral"><Flame size={14} className="mt-0.5 shrink-0" />{roastMessage({ scope: r.scope, categoryName: r.name, limitMinor: r.limit, usedMinor: r.used }, r.pct, draft.intensity)}</p>
                  ) : (
                    <p className="mt-1 text-[12px] text-muted">Under {draft.thresholds[0] ?? 75}% — nothing to say yet.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing to roast" description="Set a budget and add spending to preview live messages." />
          )}
          <div className="mt-4 flex items-center justify-between rounded-lg border border-dashed border-line p-3">
            <div>
              <p className="text-sm font-semibold text-ink">Test alert</p>
              <p className="text-[12px] text-muted">Sends one sample roast using demo figures (not your data).</p>
            </div>
            <Button variant="secondary" onClick={() => setConfirmTest(true)}>Send test</Button>
          </div>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardTitle>Recent roast events</CardTitle>
        <p className="mb-3 text-[12px] text-muted">In-app events only — no external push/email is claimed. Duplicate crossings are prevented by stable event keys.</p>
        {events.length ? (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2">
                <Flame size={16} className="mt-0.5 shrink-0 text-coral" />
                <div className="flex-1">
                  <p className="text-sm text-ink">{e.message}</p>
                  <p className="text-[12px] text-muted">{formatYearMonth(e.month)} · crossed {e.threshold}% · {new Date(e.createdAt).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No crossings recorded yet" description="Events appear when you pass a threshold." />
        )}
      </Card>

      <ConfirmDialog
        open={confirmTest}
        tone="primary"
        title="Send a test roast?"
        message="This shows one example message using illustrative demo numbers. It does not touch your real records or create a real crossing event."
        confirmLabel="Send test"
        onCancel={() => setConfirmTest(false)}
        onConfirm={() => {
          const demo = { scope: 'category' as const, categoryName: 'Shopping (demo)', limitMinor: 500000, usedMinor: 465000 };
          const pct = computeUsagePct(demo.usedMinor, demo.limitMinor);
          pushToast({ kind: 'roast', title: 'Test roast', message: roastMessage(demo, pct, draft.intensity) });
          setConfirmTest(false);
        }}
      />
    </div>
  );
}
