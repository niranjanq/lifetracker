import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  newId,
  type Snapshot,
  type CollectionName,
  DEFAULT_PREFERENCES,
} from '../repo/local';
import { remoteRepository as localRepository } from '../repo/remote';
import type {
  Allocation,
  Budget,
  Category,
  HealthLog,
  MedicationLog,
  MeasurementEntry,
  MeasurementType,
  RoastEvent,
  RoastSettings,
  SalaryReceipt,
  SymptomEntry,
  Transaction,
  UserPreferences,
  YearMonth,
  ReminderSettings,
} from '../domain/types';
import type { PlanRecord, FinanceData } from '../domain/finance';
import { computeFinanceSummary } from '../domain/finance';
import {
  computeUsagePct,
  eventKey,
  isRoastEligible,
  roastMessage,
} from '../domain/roast';
import { currentYearMonth } from '../domain/date';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info' | 'roast';
  title?: string;
  message: string;
}

type Status = 'loading' | 'ready' | 'error';

/** A single write operation applied to an in-memory collection + persisted. */
interface Op {
  collection: CollectionName;
  record?: { id: string };
  removeId?: string;
}

function cloneSnapshot(s: Snapshot): Snapshot {
  return {
    ...s,
    categories: [...s.categories],
    salaryReceipts: [...s.salaryReceipts],
    allocations: [...s.allocations],
    transactions: [...s.transactions],
    budgets: [...s.budgets],
    plans: [...s.plans],
    roastEvents: [...s.roastEvents],
    healthLogs: [...s.healthLogs],
    symptoms: [...s.symptoms],
    medicationLogs: [...s.medicationLogs],
    measurementTypes: [...s.measurementTypes],
    measurementEntries: [...s.measurementEntries],
  };
}

export interface AppContextValue {
  status: Status;
  error: string | null;
  data: Snapshot | null;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;

  // Finance
  financeData: (month: YearMonth) => FinanceData | null;
  upsertTransaction: (t: Partial<Transaction> & { id?: string }) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  upsertSalaryReceipt: (s: Partial<SalaryReceipt> & { id?: string }) => Promise<void>;
  deleteSalaryReceipt: (id: string) => Promise<void>;
  upsertAllocation: (a: Partial<Allocation> & { id?: string }) => Promise<void>;
  deleteAllocation: (id: string) => Promise<void>;
  upsertBudget: (b: Partial<Budget> & { id?: string }) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  setPlan: (p: PlanRecord) => Promise<void>;

  // Categories
  upsertCategory: (c: Partial<Category> & { id?: string }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  // Settings
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  updateRoastSettings: (s: RoastSettings) => Promise<void>;
  updateReminders: (r: ReminderSettings) => Promise<void>;

  // Health
  saveHealthLog: (log: Partial<HealthLog> & { id?: string }, symptoms: Omit<SymptomEntry, 'id' | 'logId'>[]) => Promise<void>;
  deleteHealthLog: (id: string) => Promise<void>;
  upsertMedication: (m: Partial<MedicationLog> & { id?: string }) => Promise<void>;
  deleteMedication: (id: string) => Promise<void>;
  upsertMeasurement: (m: Partial<MeasurementEntry> & { id?: string }) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;
  addMeasurementType: (t: Omit<MeasurementType, 'id'>) => Promise<void>;

  // Privacy
  deleteAllData: () => Promise<void>;

  reload: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Live handle to the latest snapshot, kept in sync at EVERY setData call site.
  // Write helpers build from this instead of the `data` value captured in their
  // useCallback closure, so a batch of writes in one handler (Onboarding.finish)
  // can no longer clobber a change applied moments earlier (previously it reverted
  // preferences.onboarded). No sync-effect: an effect could momentarily write a
  // committed-but-older snapshot back over a newer reference, so we never rely on one.
  const dataRef = useRef<Snapshot | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = newId('toast');
      setToasts((prev) => [...prev, { ...t, id }]);
      timers.current[id] = setTimeout(() => dismissToast(id), t.kind === 'error' ? 6000 : 4200);
    },
    [dismissToast],
  );

  const reload = useCallback(async () => {
    const snap = await localRepository.loadAll();
    dataRef.current = snap;
    setData(snap);
  }, []);

  // ---- Boot ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await localRepository.init();
        const snap = await localRepository.loadAll();
        if (!alive) return;
        dataRef.current = snap;
        setData(snap);
        setStatus('ready');
        // Reflect reduced-motion preference on <html>.
        document.documentElement.classList.toggle('reduce-motion', snap.preferences.reducedMotion);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to initialise local storage.');
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', !!data?.preferences.reducedMotion);
  }, [data?.preferences.reducedMotion]);

  // ---- Roast evaluation ----
  // Recompute crossings for the affected month and persist NEW events only.
  const evaluateRoast = useCallback(
    async (snap: Snapshot, month: YearMonth) => {
      const settings = snap.roastSettings;
      if (!settings.enabled) return;
      const summary = computeFinanceSummary(month, toFinanceData(snap, month));
      const catById = new Map(snap.categories.map((c) => [c.id, c]));
      const events: RoastEvent[] = [];

      const consider = (scope: 'overall' | 'category', limitMinor: number, usedMinor: number, categoryId?: string) => {
        if (limitMinor <= 0) return;
        if (scope === 'category' && categoryId) {
          const cat = catById.get(categoryId);
          if (!isRoastEligible(cat, settings)) return;
        }
        const usagePct = computeUsagePct(usedMinor, limitMinor);
        for (const threshold of settings.thresholds) {
          if (usagePct >= threshold) {
            const input = {
              scope,
              categoryId,
              categoryName: categoryId ? catById.get(categoryId)?.name ?? 'category' : 'Monthly budget',
              limitMinor,
              usedMinor,
            };
            events.push({
              id: newId('re'),
              eventKey: eventKey(month, input, threshold),
              month,
              categoryId: scope === 'category' ? categoryId ?? null : null,
              threshold,
              usagePct,
              message: roastMessage(input, usagePct, settings.intensity),
              createdAt: new Date().toISOString(),
            });
          }
        }
      };

      consider('overall', summary.overallBudgetMinor, summary.netSpendingMinor);
      for (const cs of summary.categorySpend) {
        const limit = snap.budgets.find((b) => b.month === month && b.categoryId === cs.categoryId)?.limitMinor ?? 0;
        consider('category', limit, cs.netMinor, cs.categoryId);
      }

      const existingKeys = new Set(snap.roastEvents.map((e) => e.eventKey));
      const fresh = events.filter((e) => !existingKeys.has(e.eventKey));
      if (fresh.length === 0) return;

      // Keep only the highest newly-crossed threshold per scope to avoid spam
      // when several thresholds are crossed in a single jump.
      const byScope = new Map<string, RoastEvent>();
      for (const e of fresh) {
        const key = `${e.month}:${e.categoryId ?? 'overall'}`;
        const cur = byScope.get(key);
        if (!cur || e.threshold > cur.threshold) byScope.set(key, e);
      }
      const toStore = [...byScope.values()];

      await localRepository.bulkPut('roastEvents', toStore);
      const prevSnap = dataRef.current;
      if (prevSnap) {
        const merged = { ...prevSnap, roastEvents: [...prevSnap.roastEvents, ...toStore] };
        dataRef.current = merged;
        setData(merged);
      }
      if (settings.notifyOnCross) {
        for (const e of toStore) pushToast({ kind: 'roast', title: 'Wallet Roast Mode', message: e.message });
      }
    },
    [pushToast],
  );

  // ---- generic write helper ----
  const mutate = useCallback(
    async (
      build: (snap: Snapshot) => Op | Op[],
      roastMonth?: YearMonth,
    ) => {
      const base = dataRef.current;
      if (!base) return;
      const next: Snapshot = cloneSnapshot(base);
      const raw = build(next);
      const ops: Op[] = Array.isArray(raw) ? raw : [raw];
      for (const op of ops) {
        const list = next[op.collection] as unknown as Array<{ id: string }>;
        if (op.removeId) {
          const idx = list.findIndex((x) => x.id === op.removeId);
          if (idx >= 0) list.splice(idx, 1);
        }
        if (op.record) {
          const idx = list.findIndex((x) => x.id === op.record!.id);
          if (idx >= 0) list[idx] = op.record;
          else list.push(op.record);
        }
      }
      dataRef.current = next;
      setData(next);
      try {
        for (const op of ops) {
          if (op.removeId) await localRepository.remove(op.collection, op.removeId);
          if (op.record) await localRepository.putCollection(op.collection, op.record as never);
        }
        if (roastMonth) await evaluateRoast(next, roastMonth);
      } catch (e) {
        pushToast({ kind: 'error', message: 'Could not save. Your input is preserved; retry when ready.' });
        setError(e instanceof Error ? e.message : 'Save failed');
      }
    },
    [evaluateRoast, pushToast],
  );

  // ---- Finance actions ----
  const upsertTransaction = useCallback(
    async (t: Partial<Transaction> & { id?: string }) => {
      const now = new Date().toISOString();
      const record: Transaction = {
        id: t.id ?? newId('tx'),
        month: t.month ?? (t.date ? t.date.slice(0, 7) : currentYearMonth()),
        date: t.date ?? now.slice(0, 10),
        kind: t.kind ?? 'expense',
        categoryId: t.categoryId ?? '',
        amountMinor: Math.abs(Math.trunc(t.amountMinor ?? 0)),
        description: t.description,
        merchant: t.merchant,
        method: t.method,
        note: t.note,
        tags: t.tags ?? [],
        refundOf: t.refundOf,
        demo: false, // user-entered records are never flagged demo
        createdAt: t.createdAt ?? now,
      };
      await mutate((snap) => ({ collection: 'transactions', record }), record.month);
      pushToast({ kind: 'success', message: t.id ? 'Transaction updated' : 'Transaction saved' });
    },
    [mutate, pushToast],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      const tx = data?.transactions.find((t) => t.id === id);
      await mutate(() => ({ collection: 'transactions', removeId: id }), tx?.month);
      pushToast({ kind: 'success', message: 'Transaction deleted' });
    },
    [mutate, data, pushToast],
  );

  const upsertSalaryReceipt = useCallback(
    async (s: Partial<SalaryReceipt> & { id?: string }) => {
      const now = new Date().toISOString();
      const record: SalaryReceipt = {
        id: s.id ?? newId('sal'),
        month: s.month ?? (s.date ? s.date.slice(0, 7) : currentYearMonth()),
        amountMinor: Math.abs(Math.trunc(s.amountMinor ?? 0)),
        date: s.date ?? now.slice(0, 10),
        source: s.source,
        note: s.note,
        createdAt: s.createdAt ?? now,
      };
      await mutate((snap) => ({ collection: 'salaryReceipts', record }));
      pushToast({ kind: 'success', message: 'Salary receipt saved' });
    },
    [mutate, pushToast],
  );

  const deleteSalaryReceipt = useCallback(
    async (id: string) => {
      await mutate(() => ({ collection: 'salaryReceipts', removeId: id }));
      pushToast({ kind: 'success', message: 'Salary receipt deleted' });
    },
    [mutate, pushToast],
  );

  const upsertAllocation = useCallback(
    async (a: Partial<Allocation> & { id?: string }) => {
      const now = new Date().toISOString();
      const record: Allocation = {
        id: a.id ?? newId('alloc'),
        month: a.month ?? currentYearMonth(),
        categoryId: a.categoryId ?? '',
        label: a.label ?? '',
        plannedMinor: Math.abs(Math.trunc(a.plannedMinor ?? 0)),
        createdAt: a.createdAt ?? now,
      };
      await mutate((snap) => ({ collection: 'allocations', record }));
    },
    [mutate],
  );

  const deleteAllocation = useCallback(
    async (id: string) => {
      await mutate(() => ({ collection: 'allocations', removeId: id }));
    },
    [mutate],
  );

  const upsertBudget = useCallback(
    async (b: Partial<Budget> & { id?: string }) => {
      const now = new Date().toISOString();
      const record: Budget = {
        id: b.id ?? newId('bud'),
        month: b.month ?? currentYearMonth(),
        categoryId: b.categoryId ?? null,
        limitMinor: Math.abs(Math.trunc(b.limitMinor ?? 0)),
        createdAt: b.createdAt ?? now,
      };
      await mutate((snap) => ({ collection: 'budgets', record }), record.month);
      pushToast({ kind: 'success', message: 'Budget saved' });
    },
    [mutate, pushToast],
  );

  const deleteBudget = useCallback(
    async (id: string) => {
      await mutate(() => ({ collection: 'budgets', removeId: id }));
    },
    [mutate],
  );

  const setPlan = useCallback(
    async (p: PlanRecord) => {
      const base = dataRef.current;
      if (base) {
        const plans = base.plans.filter((x) => x.month !== p.month);
        const next = { ...base, plans: [...plans, p] };
        dataRef.current = next;
        setData(next);
      }
      await persistPlan(p);
    },
    [],
  );

  // ---- Categories ----
  const upsertCategory = useCallback(
    async (c: Partial<Category> & { id?: string }) => {
      const record: Category = {
        id: c.id ?? newId('cat'),
        name: c.name ?? 'New category',
        icon: c.icon ?? 'Shape',
        essential: c.essential ?? false,
        defaultKind: c.defaultKind ?? 'expense',
        builtin: false,
      };
      await mutate((snap) => ({ collection: 'categories', record }));
    },
    [mutate],
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const cat = data?.categories.find((c) => c.id === id);
      if (!cat || cat.builtin) {
        pushToast({ kind: 'error', message: 'Built-in categories cannot be deleted.' });
        return;
      }
      await mutate(() => ({ collection: 'categories', removeId: id }));
    },
    [mutate, data, pushToast],
  );

  // ---- Settings ----
  const updatePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const base = dataRef.current;
      const next = { ...(base?.preferences ?? DEFAULT_PREFERENCES), ...patch };
      if (base) {
        const merged = { ...base, preferences: next };
        dataRef.current = merged;
        setData(merged);
      }
      await localRepository.setKV('preferences', next);
    },
    [],
  );

  const updateRoastSettings = useCallback(
    async (s: RoastSettings) => {
      const base = dataRef.current;
      if (base) {
        const next = { ...base, roastSettings: s };
        dataRef.current = next;
        setData(next);
      }
      await localRepository.setKV('roastSettings', s);
    },
    [],
  );

  const updateReminders = useCallback(
    async (r: ReminderSettings) => {
      const base = dataRef.current;
      if (base) {
        const next = { ...base, reminders: r };
        dataRef.current = next;
        setData(next);
      }
      await localRepository.setKV('reminders', r);
    },
    [],
  );

  // ---- Health ----
  const saveHealthLog = useCallback(
    async (log: Partial<HealthLog> & { id?: string }, symptoms: Omit<SymptomEntry, 'id' | 'logId'>[]) => {
      const now = new Date().toISOString();
      const id = log.id ?? newId('hl');
      const record: HealthLog = {
        id,
        date: log.date ?? now.slice(0, 10),
        time: log.time,
        wellbeing: log.wellbeing ?? 3,
        note: log.note,
        activityImpact: log.activityImpact,
        demo: false,
        createdAt: log.createdAt ?? now,
      };
      // Rebuild symptoms for this log: remove old, add new.
      const oldSymptoms = (data?.symptoms ?? []).filter((s) => s.logId === id);
      const newSymptoms: SymptomEntry[] = symptoms.map((s) => ({ ...s, id: newId('sym'), logId: id }));
      const ops: Array<{ collection: Parameters<typeof localRepository.putCollection>[0]; record?: { id: string }; removeId?: string }> = [
        { collection: 'healthLogs', record },
        ...oldSymptoms.map((s) => ({ collection: 'symptoms' as const, removeId: s.id })),
        ...newSymptoms.map((s) => ({ collection: 'symptoms' as const, record: s })),
      ];
      await mutate(() => ops);
      pushToast({ kind: 'success', message: 'Health log saved' });
    },
    [mutate, data, pushToast],
  );

  const deleteHealthLog = useCallback(
    async (id: string) => {
      const linked = (data?.symptoms ?? []).filter((s) => s.logId === id);
      await mutate(() => [
        { collection: 'healthLogs', removeId: id },
        ...linked.map((s) => ({ collection: 'symptoms' as const, removeId: s.id })),
      ]);
      pushToast({ kind: 'success', message: 'Health log deleted' });
    },
    [mutate, data, pushToast],
  );

  const upsertMedication = useCallback(
    async (m: Partial<MedicationLog> & { id?: string }) => {
      const now = new Date().toISOString();
      const record: MedicationLog = {
        id: m.id ?? newId('med'),
        date: m.date ?? now.slice(0, 10),
        time: m.time,
        name: m.name ?? '',
        dose: m.dose ?? '',
        note: m.note,
        demo: false,
        createdAt: m.createdAt ?? now,
      };
      await mutate((snap) => ({ collection: 'medicationLogs', record }));
      pushToast({ kind: 'success', message: 'Medication log saved' });
    },
    [mutate, pushToast],
  );

  const deleteMedication = useCallback(
    async (id: string) => {
      await mutate(() => ({ collection: 'medicationLogs', removeId: id }));
    },
    [mutate],
  );

  const upsertMeasurement = useCallback(
    async (m: Partial<MeasurementEntry> & { id?: string }) => {
      const now = new Date().toISOString();
      const record: MeasurementEntry = {
        id: m.id ?? newId('me'),
        typeId: m.typeId ?? '',
        date: m.date ?? now.slice(0, 10),
        value: m.value ?? null,
        note: m.note,
        demo: false,
        createdAt: m.createdAt ?? now,
      };
      await mutate((snap) => ({ collection: 'measurementEntries', record }));
      pushToast({ kind: 'success', message: 'Measurement saved' });
    },
    [mutate, pushToast],
  );

  const deleteMeasurement = useCallback(
    async (id: string) => {
      await mutate(() => ({ collection: 'measurementEntries', removeId: id }));
    },
    [mutate],
  );

  const addMeasurementType = useCallback(
    async (t: Omit<MeasurementType, 'id'>) => {
      const record: MeasurementType = { ...t, id: newId('mt') };
      await mutate((snap) => ({ collection: 'measurementTypes', record }));
    },
    [mutate],
  );

  // ---- Privacy ----
  const deleteAllData = useCallback(async () => {
    await localRepository.clearData({ keepPreferences: false });
    await localRepository.init();
    await reload();
    pushToast({ kind: 'success', message: 'All data deleted.' });
  }, [reload, pushToast]);

  const financeData = useCallback(
    (month: YearMonth): FinanceData | null => (data ? toFinanceData(data, month) : null),
    [data],
  );

  const value: AppContextValue = {
    status,
    error,
    data,
    toasts,
    pushToast,
    dismissToast,
    financeData,
    upsertTransaction,
    deleteTransaction,
    upsertSalaryReceipt,
    deleteSalaryReceipt,
    upsertAllocation,
    deleteAllocation,
    upsertBudget,
    deleteBudget,
    setPlan,
    upsertCategory,
    deleteCategory,
    updatePreferences,
    updateRoastSettings,
    updateReminders,
    saveHealthLog,
    deleteHealthLog,
    upsertMedication,
    deleteMedication,
    upsertMeasurement,
    deleteMeasurement,
    addMeasurementType,
    deleteAllData,
    reload,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

/** Compute summary for a month using full datasets (month filtering happens inside). */
export function toFinanceData(snap: Snapshot, _month: YearMonth): FinanceData {
  return {
    plans: snap.plans,
    salaryReceipts: snap.salaryReceipts,
    allocations: snap.allocations,
    transactions: snap.transactions,
    budgets: snap.budgets,
    categories: snap.categories,
  };
}

// The `plans` collection is keyed by month, not id — persist via a dedicated path.
async function persistPlan(p: PlanRecord): Promise<void> {
  await localRepository.putPlan(p);
}

export { computeFinanceSummary };
