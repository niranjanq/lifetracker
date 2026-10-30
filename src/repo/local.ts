import { getDB, type KVKeys } from './db';
import type {
  Allocation,
  AppMeta,
  Budget,
  Category,
  HealthLog,
  MedicationLog,
  MeasurementEntry,
  MeasurementType,
  ReminderSettings,
  RoastEvent,
  RoastSettings,
  SalaryReceipt,
  SymptomEntry,
  Transaction,
  UserPreferences,
} from '../domain/types';
import type { PlanRecord } from '../domain/finance';
import { DEFAULT_CATEGORIES } from '../domain/categories';
import { DEFAULT_ROAST_SETTINGS } from '../domain/roast';

/** Collections that hold many records keyed by id. */
export type CollectionName =
  | 'categories'
  | 'salaryReceipts'
  | 'allocations'
  | 'transactions'
  | 'budgets'
  | 'roastEvents'
  | 'healthLogs'
  | 'symptoms'
  | 'medicationLogs'
  | 'measurementTypes'
  | 'measurementEntries';

export interface Snapshot {
  meta: AppMeta;
  preferences: UserPreferences;
  roastSettings: RoastSettings;
  reminders: ReminderSettings;
  categories: Category[];
  salaryReceipts: SalaryReceipt[];
  allocations: Allocation[];
  transactions: Transaction[];
  budgets: Budget[];
  plans: PlanRecord[];
  roastEvents: RoastEvent[];
  healthLogs: HealthLog[];
  symptoms: SymptomEntry[];
  medicationLogs: MedicationLog[];
  measurementTypes: MeasurementType[];
  measurementEntries: MeasurementEntry[];
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  displayName: '',
  currency: 'INR',
  timeZone: 'Asia/Kolkata',
  budgetPeriod: 'calendar',
  theme: 'dark',
  reducedMotion: false,
  remindersEnabled: false,
  onboarded: false,
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  healthDailyLog: false,
  medication: false,
  budgetReview: false,
  timeOfDay: '20:00',
};

export const DEFAULT_MEASUREMENT_TYPES: MeasurementType[] = [
  { id: 'mt-weight', name: 'Weight', unit: 'kg', builtin: true },
  { id: 'mt-bp-systolic', name: 'Blood pressure (systolic)', unit: 'mmHg', builtin: true },
  { id: 'mt-bp-diastolic', name: 'Blood pressure (diastolic)', unit: 'mmHg', builtin: true },
  { id: 'mt-resting-hr', name: 'Resting heart rate', unit: 'bpm', builtin: true },
  { id: 'mt-glucose', name: 'Blood glucose', unit: 'mg/dL', builtin: true },
];

export function newId(prefix = 'id'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${rnd}`;
}

/**
 * Local persistence via IndexedDB. The whole dataset is small enough to load
 * into memory once; all mutations write through and the caller refreshes state.
 */
export interface Repository {
  readonly mode: 'local';
  init(): Promise<void>;
  loadAll(): Promise<Snapshot>;
  putCollection<T extends { id: string }>(name: CollectionName, record: T): Promise<T>;
  bulkPut<T extends { id: string }>(name: CollectionName, records: T[]): Promise<void>;
  remove(name: CollectionName, id: string): Promise<void>;
  removeMany(name: CollectionName, ids: string[]): Promise<void>;
  setKV<K extends keyof KVKeys>(key: K, value: KVKeys[K]): Promise<void>;
  /** Wipe user + demo data (optionally keep preferences) then re-seed defaults. */
  clearData(opts: { keepPreferences: boolean }): Promise<void>;
}

async function getKV<K extends keyof KVKeys>(key: K): Promise<KVKeys[K] | undefined> {
  const db = await getDB();
  const row = await db.get('kv', key);
  return row?.value as KVKeys[K] | undefined;
}

async function putMany<K extends CollectionName>(name: K, records: Array<Snapshot[K][number]>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(name, 'readwrite');
  await Promise.all([...records.map((r) => tx.store.put(r as never)), tx.done]);
}

export const localRepository: Repository = {
  mode: 'local',

  async init() {
    const db = await getDB();
    // Seed default singletons + categories only when absent (idempotent).
    if (!(await getKV('meta'))) {
      const meta: AppMeta = {
        storageMode: 'local',
        demoActive: false,
        createdAt: new Date().toISOString(),
        schemaVersion: 1,
      };
      await db.put('kv', { key: 'meta', value: meta });
    }
    if (!(await getKV('preferences'))) {
      await db.put('kv', { key: 'preferences', value: DEFAULT_PREFERENCES });
    }
    if (!(await getKV('roastSettings'))) {
      await db.put('kv', { key: 'roastSettings', value: DEFAULT_ROAST_SETTINGS });
    }
    if (!(await getKV('reminders'))) {
      await db.put('kv', { key: 'reminders', value: DEFAULT_REMINDERS });
    }
    const existing = await db.getAll('categories');
    if (existing.length === 0) {
      await putMany('categories', DEFAULT_CATEGORIES);
    }
    const mt = await db.getAll('measurementTypes');
    if (mt.length === 0) {
      await putMany('measurementTypes', DEFAULT_MEASUREMENT_TYPES);
    }
  },

  async loadAll() {
    const db = await getDB();
    const [
      meta, preferences, roastSettings, reminders,
      categories, salaryReceipts, allocations, transactions, budgets, plans,
      roastEvents, healthLogs, symptoms, medicationLogs, measurementTypes, measurementEntries,
    ] = await Promise.all([
      getKV('meta'),
      getKV('preferences'),
      getKV('roastSettings'),
      getKV('reminders'),
      db.getAll('categories'),
      db.getAll('salaryReceipts'),
      db.getAll('allocations'),
      db.getAll('transactions'),
      db.getAll('budgets'),
      db.getAll('plans'),
      db.getAll('roastEvents'),
      db.getAll('healthLogs'),
      db.getAll('symptoms'),
      db.getAll('medicationLogs'),
      db.getAll('measurementTypes'),
      db.getAll('measurementEntries'),
    ]);
    return {
      meta: meta ?? { storageMode: 'local', demoActive: false, createdAt: new Date().toISOString(), schemaVersion: 1 },
      preferences: preferences ?? DEFAULT_PREFERENCES,
      roastSettings: roastSettings ?? DEFAULT_ROAST_SETTINGS,
      reminders: reminders ?? DEFAULT_REMINDERS,
      categories,
      salaryReceipts,
      allocations,
      transactions,
      budgets,
      plans,
      roastEvents,
      healthLogs,
      symptoms,
      medicationLogs,
      measurementTypes,
      measurementEntries,
    };
  },

  async putCollection(name, record) {
    const db = await getDB();
    await db.put(name, record as never);
    return record;
  },

  async bulkPut(name, records) {
    const db = await getDB();
    const tx = db.transaction(name, 'readwrite');
    await Promise.all([...records.map((r) => tx.store.put(r as never)), tx.done]);
  },

  async remove(name, id) {
    const db = await getDB();
    await db.delete(name, id);
  },

  async removeMany(name, ids) {
    const db = await getDB();
    const tx = db.transaction(name, 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  },

  async setKV(key, value) {
    const db = await getDB();
    await db.put('kv', { key, value });
  },

  async clearData({ keepPreferences }) {
    const db = await getDB();
    const collections: CollectionName[] = [
      'salaryReceipts', 'allocations', 'transactions', 'budgets', 'roastEvents',
      'healthLogs', 'symptoms', 'medicationLogs', 'measurementEntries',
    ];
    const txs = collections.map((c) => db.transaction(c, 'readwrite').store.clear());
    await Promise.all(txs);
    await db.clear('plans');
    if (!keepPreferences) {
      await db.put('kv', { key: 'preferences', value: DEFAULT_PREFERENCES });
      await db.put('kv', { key: 'roastSettings', value: DEFAULT_ROAST_SETTINGS });
      await db.put('kv', { key: 'reminders', value: DEFAULT_REMINDERS });
      // Reset categories + measurement types to defaults.
      await db.clear('categories');
      await putMany('categories', DEFAULT_CATEGORIES);
      await db.clear('measurementTypes');
      await putMany('measurementTypes', DEFAULT_MEASUREMENT_TYPES);
    }
    const meta = await getKV('meta');
    await db.put('kv', {
      key: 'meta',
      value: { ...(meta as AppMeta), demoActive: false },
    });
  },
};
