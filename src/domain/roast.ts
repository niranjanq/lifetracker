/**
 * Wallet Roast Mode — deterministic threshold logic + message templates.
 *
 * Design constraints from the brief:
 * - Only VERIFIED numbers are passed to the generator (never invent amounts).
 * - Essential categories (rent, basic food, medical, family) are NEVER roasted.
 * - Thresholds must be numeric, ascending, unique, within an allowed range.
 * - Crossings are idempotent via a stable event key.
 */
import type { Category, RoastIntensity, RoastSettings, YearMonth } from './types';
import { CAT } from './categories';

export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 300;

export const DEFAULT_ROAST_SETTINGS: RoastSettings = {
  enabled: true,
  intensity: 'balanced',
  thresholds: [75, 90, 100, 120],
  notifyOnCross: true,
  excludedCategoryIds: [],
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

/** Returns a list of validation error strings; empty array means valid. */
export function validateThresholds(thresholds: number[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    return ['Add at least one threshold.'];
  }
  if (thresholds.some((t) => !Number.isFinite(t) || !Number.isInteger(t))) {
    errors.push('Thresholds must be whole numbers.');
  }
  if (thresholds.some((t) => t < THRESHOLD_MIN || t > THRESHOLD_MAX)) {
    errors.push(`Thresholds must be between ${THRESHOLD_MIN}% and ${THRESHOLD_MAX}%.`);
  }
  const sorted = [...thresholds].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length) {
    errors.push('Thresholds must be unique.');
  }
  // Must be strictly ascending as provided (order matters for messaging).
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i] <= thresholds[i - 1]) {
      errors.push('Thresholds must be in strictly ascending order.');
      break;
    }
  }
  return errors;
}

/** A category is eligible for roasting unless essential or explicitly excluded. */
export function isRoastEligible(category: Category | undefined, settings: RoastSettings): boolean {
  if (!category) return false;
  if (category.essential) return false;
  if (category.id === CAT.rent || category.id === CAT.food || category.id === CAT.health) return false;
  return !settings.excludedCategoryIds.includes(category.id);
}

export interface UsageInput {
  scope: 'overall' | 'category';
  categoryId?: string;
  categoryName: string;
  limitMinor: number;
  usedMinor: number;
}

export interface CrossedThreshold {
  threshold: number;
  usagePct: number;
}

/** Highest threshold currently exceeded, or null. */
export function highestCrossed(usagePct: number, thresholds: number[]): number | null {
  let crossed: number | null = null;
  for (const t of thresholds) if (usagePct >= t) crossed = Math.max(crossed ?? 0, t);
  return crossed;
}

/** Build the stable idempotent event key for a crossing. */
export function eventKey(month: YearMonth, input: UsageInput, threshold: number): string {
  const scopeId = input.scope === 'overall' ? 'overall' : input.categoryId ?? 'cat';
  return `${input.scope}:${month}:${scopeId}:${threshold}`;
}

export function computeUsagePct(usedMinor: number, limitMinor: number): number {
  if (limitMinor <= 0) return 0;
  return Math.round((usedMinor / limitMinor) * 100);
}

/* ------------------------- Message templates ------------------------- */

const CATEGORY_WORDS: Record<string, string> = {
  shopping: 'shopping',
  entertainment: 'entertainment',
  subscriptions: 'subscriptions',
  transport: 'transport',
  food: 'food',
};

function nounFor(input: UsageInput): string {
  if (input.scope === 'overall') return 'monthly spending';
  const lower = input.categoryName.toLowerCase();
  for (const [key, word] of Object.entries(CATEGORY_WORDS)) {
    if (lower.includes(key)) return word;
  }
  return input.categoryName.toLowerCase();
}

const TEMPLATES: Record<RoastIntensity, Array<(n: string, pct: number) => string>> = {
  mild: [
    (n, p) => `Heads up — you've used ${p}% of your ${n} budget. Your wallet would like a breather.`,
    (n) => `${n} is getting close to its limit. Maybe ease off a touch.`,
    (n, p) => `You're at ${p}% on ${n}. Still fine, just keeping you honest.`,
  ],
  balanced: [
    (n, p) => `${p}% of your ${n} budget is gone. Give that cart some space.`,
    (n) => `${n} budget is waving a little red flag. The impulse can wait till next month.`,
    (n, p) => `${p}% on ${n}. Your future self is quietly asking for a pause.`,
  ],
  savage: [
    (n, p) => `${p}% of ${n}? Bold strategy. Your wallet did not consent to this.`,
    (n) => `You spent into the ${n} budget like it owed you money. It does not.`,
    (n, p) => `${p}% on ${n}. The 'one more' habit is doing the heavy lifting here.`,
  ],
};

/**
 * Produce a deterministic roast message for a crossing. Never cruel, never
 * attacks identity, never mocks essential spending (those are filtered out
 * before this is called).
 */
export function roastMessage(
  input: UsageInput,
  usagePct: number,
  intensity: RoastIntensity,
): string {
  const pool = TEMPLATES[intensity];
  const n = nounFor(input);
  // Deterministic pick: hash by scope + rounded usage so previews are stable.
  const seed = (n.length + Math.round(usagePct)) % pool.length;
  return pool[seed](n, usagePct);
}
