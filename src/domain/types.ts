/**
 * Domain model types for Personal Life Tracker.
 *
 * Money convention
 * ----------------
 * All monetary amounts are stored as INTEGER MINOR UNITS to guarantee
 * deterministic arithmetic (no floats). For INR one minor unit = 1 paisa,
 * i.e. ₹1 = 100. The `currency` field on preferences records the display code;
 * minor-unit scaling is handled by the money helpers.
 */

export type ISODate = string; // 'YYYY-MM-DD'
export type ISODateTime = string; // full ISO timestamp
export type YearMonth = string; // 'YYYY-MM'

/** Stable string ID produced by the repository layer. */
export type ID = string;

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'SGD' | 'JPY';

export type TransactionKind =
  | 'income' // salary / other income (increases available money)
  | 'expense' // consumption spending (reduces spending budget)
  | 'transfer' // internal movement: savings transfer, family transfer (NOT consumption)
  | 'investment' // SIP / investment contribution (NOT consumption)
  | 'refund'; // offsets a prior expense category

/** A category groups transactions and may be flagged essential (roast-exempt). */
export interface Category {
  id: ID;
  name: string;
  /** Emoji or icon key rendered in the UI. */
  icon: string;
  /** Essential categories are never roasted (rent, basic food, medical, etc.). */
  essential: boolean;
  /** Which kinds of transactions normally use this category. */
  defaultKind: TransactionKind;
  /** Built-in categories cannot be deleted, only custom ones. */
  builtin: boolean;
}

/** A recorded salary / income receipt. */
export interface SalaryReceipt {
  id: ID;
  month: YearMonth;
  amountMinor: number; // actual received
  date: ISODate;
  source?: string;
  note?: string;
  createdAt: ISODateTime;
}

/** A planned monthly allocation (a PLAN, not an actual payment). */
export interface Allocation {
  id: ID;
  month: YearMonth;
  categoryId: ID;
  label: string;
  plannedMinor: number;
  createdAt: ISODateTime;
}

/** A single financial transaction record. */
export interface Transaction {
  id: ID;
  month: YearMonth;
  date: ISODate;
  kind: TransactionKind;
  categoryId: ID;
  amountMinor: number; // always >= 0; direction is given by `kind`
  description?: string;
  merchant?: string;
  method?: string;
  note?: string;
  tags: string[];
  /** For refunds: the id of the transaction being refunded (optional linkage). */
  refundOf?: ID;
  /** Marks records that belong to the seeded demo dataset. */
  demo: boolean;
  createdAt: ISODateTime;
}

/** A monthly budget (overall variable-spending or category-specific). */
export interface Budget {
  id: ID;
  month: YearMonth;
  /** null categoryId => overall variable-spending budget. */
  categoryId: ID | null;
  limitMinor: number;
  createdAt: ISODateTime;
}

export type RoastIntensity = 'mild' | 'balanced' | 'savage';

export interface RoastSettings {
  enabled: boolean;
  intensity: RoastIntensity;
  /** Ascending percentage thresholds, e.g. [75, 90, 100, 120]. */
  thresholds: number[];
  notifyOnCross: boolean;
  /** Category ids that are exempt from roasting (in addition to essential ones). */
  excludedCategoryIds: ID[];
  quietHoursEnabled: boolean;
  quietHoursStart: string; // 'HH:MM'
  quietHoursEnd: string; // 'HH:MM'
}

/** A recorded threshold-crossing event (idempotent by eventKey). */
export interface RoastEvent {
  id: ID;
  eventKey: string; // `${scope}:${month}:${categoryId}:${threshold}`
  month: YearMonth;
  categoryId: ID | null;
  threshold: number;
  usagePct: number;
  message: string;
  createdAt: ISODateTime;
}

export interface UserPreferences {
  displayName: string;
  currency: CurrencyCode;
  timeZone: string;
  budgetPeriod: 'calendar';
  theme: 'dark' | 'light';
  reducedMotion: boolean;
  remindersEnabled: boolean;
  onboarded: boolean;
}

/* ------------------------------ Health ------------------------------ */

export type WellbeingRating = 1 | 2 | 3 | 4 | 5; // 1 poor .. 5 great

export interface SymptomEntry {
  id: ID;
  logId: ID;
  name: string;
  /** 1 (mild) .. 10 (severe) — user-reported, clearly labeled. */
  severity: number;
  durationHours?: number;
  trigger?: string; // user-suspected, never auto-attributed
  note?: string;
}

export interface HealthLog {
  id: ID;
  date: ISODate;
  time?: string; // 'HH:MM'
  wellbeing: WellbeingRating;
  note?: string;
  activityImpact?: string;
  demo: boolean;
  createdAt: ISODateTime;
}

export interface MedicationLog {
  id: ID;
  date: ISODate;
  time?: string;
  name: string;
  dose: string; // free text exactly as entered by the user
  note?: string;
  demo: boolean;
  createdAt: ISODateTime;
}

export interface MeasurementType {
  id: ID;
  name: string;
  unit: string;
  builtin: boolean;
}

export interface MeasurementEntry {
  id: ID;
  typeId: ID;
  date: ISODate;
  /** Value is intentionally NOT coerced to 0 when missing. */
  value: number | null;
  note?: string;
  demo: boolean;
  createdAt: ISODateTime;
}

export interface ReminderSettings {
  healthDailyLog: boolean;
  medication: boolean;
  budgetReview: boolean;
  timeOfDay: string; // 'HH:MM'
}

/** Top-level persisted document describing data mode / provenance. */
export interface AppMeta {
  /** 'local' = browser IndexedDB; 'server' = authenticated PostgreSQL backend. */
  storageMode: 'local' | 'server';
  demoActive: boolean;
  createdAt: ISODateTime;
  schemaVersion: number;
}

/** The authenticated account (returned by the backend, never stores secrets). */
export interface User {
  email: string;
  emailVerified: boolean;
  onboarded: boolean;
  /** False for Firebase-only accounts: password managed by Firebase, so the
   *  in-app password change is replaced by the emailed reset link. */
  hasPassword: boolean;
}
