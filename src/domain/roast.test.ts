import { describe, it, expect } from 'vitest';
import {
  validateThresholds,
  isRoastEligible,
  highestCrossed,
  eventKey,
  computeUsagePct,
  roastMessage,
  DEFAULT_ROAST_SETTINGS,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
} from './roast';
import { CAT } from './categories';
import type { Category } from './types';

const cat = (over: Partial<Category>): Category => ({
  id: CAT.shopping,
  name: 'Shopping',
  icon: 'ShoppingBag',
  essential: false,
  defaultKind: 'expense',
  builtin: true,
  ...over,
});

describe('validateThresholds', () => {
  it('accepts the default ascending set', () => {
    expect(validateThresholds([75, 90, 100, 120])).toEqual([]);
    expect(validateThresholds(DEFAULT_ROAST_SETTINGS.thresholds)).toEqual([]);
  });

  it('rejects an empty list', () => {
    expect(validateThresholds([]).length).toBeGreaterThan(0);
  });

  it('rejects non-whole numbers', () => {
    expect(validateThresholds([75.5, 90])).toContain('Thresholds must be whole numbers.');
  });

  it('rejects values outside the allowed range', () => {
    expect(validateThresholds([THRESHOLD_MIN - 10])).toContain(`Thresholds must be between ${THRESHOLD_MIN}% and ${THRESHOLD_MAX}%.`);
    expect(validateThresholds([THRESHOLD_MAX + 10])).toContain(`Thresholds must be between ${THRESHOLD_MIN}% and ${THRESHOLD_MAX}%.`);
  });

  it('rejects duplicates', () => {
    expect(validateThresholds([75, 75, 90])).toContain('Thresholds must be unique.');
  });

  it('rejects non-ascending order', () => {
    expect(validateThresholds([100, 90])).toContain('Thresholds must be in strictly ascending order.');
  });
});

describe('isRoastEligible', () => {
  it('never roasts essential categories', () => {
    expect(isRoastEligible(cat({ essential: true }), DEFAULT_ROAST_SETTINGS)).toBe(false);
  });

  it('never roasts rent, food or health even if not flagged essential', () => {
    expect(isRoastEligible(cat({ id: CAT.rent, essential: false }), DEFAULT_ROAST_SETTINGS)).toBe(false);
    expect(isRoastEligible(cat({ id: CAT.food, essential: false }), DEFAULT_ROAST_SETTINGS)).toBe(false);
    expect(isRoastEligible(cat({ id: CAT.health, essential: false }), DEFAULT_ROAST_SETTINGS)).toBe(false);
  });

  it('respects explicit exclusions', () => {
    const settings = { ...DEFAULT_ROAST_SETTINGS, excludedCategoryIds: [CAT.shopping] };
    expect(isRoastEligible(cat({ id: CAT.shopping }), settings)).toBe(false);
  });

  it('allows ordinary discretionary categories', () => {
    expect(isRoastEligible(cat({ id: CAT.shopping }), DEFAULT_ROAST_SETTINGS)).toBe(true);
    expect(isRoastEligible(undefined, DEFAULT_ROAST_SETTINGS)).toBe(false);
  });
});

describe('threshold math', () => {
  it('returns the highest crossed threshold', () => {
    const t = [75, 90, 100, 120];
    expect(highestCrossed(95, t)).toBe(90);
    expect(highestCrossed(100, t)).toBe(100);
    expect(highestCrossed(74, t)).toBeNull();
  });

  it('builds stable, scope-aware event keys', () => {
    const overall = { scope: 'overall' as const, categoryName: 'x', limitMinor: 1, usedMinor: 1 };
    const catInput = { scope: 'category' as const, categoryId: CAT.shopping, categoryName: 'Shopping', limitMinor: 1, usedMinor: 1 };
    expect(eventKey('2026-10', overall, 75)).toBe('overall:2026-10:overall:75');
    expect(eventKey('2026-10', catInput, 90)).toBe('category:2026-10:cat-shopping:90');
  });

  it('computes usage percent and guards zero/negative limits', () => {
    expect(computeUsagePct(50000, 100000)).toBe(50);
    expect(computeUsagePct(1, 3)).toBe(33);
    expect(computeUsagePct(100, 0)).toBe(0);
  });
});

describe('roastMessage', () => {
  const input = { scope: 'category' as const, categoryId: CAT.shopping, categoryName: 'Shopping', limitMinor: 100000, usedMinor: 120000 };

  it('is deterministic for the same inputs', () => {
    const a = roastMessage(input, 120, 'balanced');
    const b = roastMessage(input, 120, 'balanced');
    expect(a).toBe(b);
  });

  it('produces non-empty copy for every intensity', () => {
    for (const level of ['mild', 'balanced', 'savage'] as const) {
      expect(roastMessage(input, 120, level).length).toBeGreaterThan(5);
    }
  });

  it('uses the scope noun for overall spend', () => {
    const overall = { scope: 'overall' as const, categoryName: 'Monthly', limitMinor: 100000, usedMinor: 90000 };
    expect(roastMessage(overall, 90, 'mild').toLowerCase()).toContain('monthly spending');
  });
});
