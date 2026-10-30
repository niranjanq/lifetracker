import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Allocation,
  Budget,
  Category,
  HealthLog,
  MeasurementEntry,
  MeasurementType,
  MedicationLog,
  RoastEvent,
  RoastSettings,
  SalaryReceipt,
  SymptomEntry,
  Transaction,
  UserPreferences,
  ReminderSettings,
  AppMeta,
} from '../domain/types';
import type { PlanRecord } from '../domain/finance';

/**
 * IndexedDB schema. Every record is keyed by string `id`; roastEvents are also
 * indexed by their idempotent `eventKey`. Singleton documents (preferences,
 * roastSettings, reminders, meta) live in the `kv` store keyed by name.
 */
export interface TrackerDBSchema extends DBSchema {
  kv: { key: string; value: { key: string; value: unknown } };
  categories: { key: string; value: Category };
  salaryReceipts: { key: string; value: SalaryReceipt };
  allocations: { key: string; value: Allocation };
  transactions: { key: string; value: Transaction; indexes: { by_month: string } };
  budgets: { key: string; value: Budget };
  plans: { key: string; value: PlanRecord };
  roastEvents: { key: string; value: RoastEvent; indexes: { by_key: string } };
  healthLogs: { key: string; value: HealthLog };
  symptoms: { key: string; value: SymptomEntry; indexes: { by_log: string } };
  medicationLogs: { key: string; value: MedicationLog };
  measurementTypes: { key: string; value: MeasurementType };
  measurementEntries: { key: string; value: MeasurementEntry };
}

export const DB_NAME = 'personal-life-tracker';
export const DB_VERSION = 1;

export type KVKeys = {
  preferences: UserPreferences;
  roastSettings: RoastSettings;
  reminders: ReminderSettings;
  meta: AppMeta;
};

let dbPromise: Promise<IDBPDatabase<TrackerDBSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<TrackerDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<TrackerDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('salaryReceipts')) db.createObjectStore('salaryReceipts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('allocations')) db.createObjectStore('allocations', { keyPath: 'id' });
        const tx = !db.objectStoreNames.contains('transactions')
          ? db.createObjectStore('transactions', { keyPath: 'id' })
          : db.createObjectStore('transactions');
        if (!tx.indexNames.contains('by_month')) tx.createIndex('by_month', 'month');
        if (!db.objectStoreNames.contains('budgets')) db.createObjectStore('budgets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'month' });
        const re = !db.objectStoreNames.contains('roastEvents')
          ? db.createObjectStore('roastEvents', { keyPath: 'id' })
          : db.createObjectStore('roastEvents');
        if (!re.indexNames.contains('by_key')) re.createIndex('by_key', 'eventKey', { unique: true });
        if (!db.objectStoreNames.contains('healthLogs')) db.createObjectStore('healthLogs', { keyPath: 'id' });
        const sy = !db.objectStoreNames.contains('symptoms')
          ? db.createObjectStore('symptoms', { keyPath: 'id' })
          : db.createObjectStore('symptoms');
        if (!sy.indexNames.contains('by_log')) sy.createIndex('by_log', 'logId');
        if (!db.objectStoreNames.contains('medicationLogs')) db.createObjectStore('medicationLogs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('measurementTypes')) db.createObjectStore('measurementTypes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('measurementEntries')) db.createObjectStore('measurementEntries', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}
