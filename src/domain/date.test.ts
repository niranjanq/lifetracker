import { describe, it, expect } from 'vitest';
import {
  toYearMonth,
  currentISODate,
  currentYearMonth,
  formatYearMonth,
  formatShortMonth,
  formatDay,
  prevMonth,
  addMonths,
  monthRange,
  daysInMonth,
  greetingForNow,
  firstNameForGreeting,
} from './date';

describe('year-month derivation', () => {
  it('slices the month from a date string without timezone coercion', () => {
    expect(toYearMonth('2026-10-25')).toBe('2026-10');
    expect(toYearMonth('2026-01-01')).toBe('2026-01');
  });

  it('uses a supplied clock for "current" helpers', () => {
    const now = new Date(2026, 9, 25, 12, 0, 0); // Oct is month index 9
    expect(currentISODate(now)).toBe('2026-10-25');
    expect(currentYearMonth(now)).toBe('2026-10');
  });

  it('greets based on the hour in Asia/Kolkata (IST)', () => {
    // IST is UTC+5:30; use absolute instants so the result is TZ-independent.
    expect(greetingForNow(new Date('2026-10-25T02:30:00Z'))).toBe('Good morning');   // 08:00 IST
    expect(greetingForNow(new Date('2026-10-25T08:30:00Z'))).toBe('Good afternoon');  // 14:00 IST
    expect(greetingForNow(new Date('2026-10-25T14:30:00Z'))).toBe('Good evening');    // 20:00 IST
  });
});

describe('firstNameForGreeting', () => {
  it('uses the first token of the display name when present', () => {
    expect(firstNameForGreeting('Ada Lovelace', 'ada@example.com')).toBe('Ada');
    expect(firstNameForGreeting('  Grace  H ",', null)).toBe('Grace');
  });

  it('falls back to a capitalised email local-part word when no display name', () => {
    expect(firstNameForGreeting('', 'john.doe@example.com')).toBe('John');
    expect(firstNameForGreeting(null, 'mary_007@x.io')).toBe('Mary');
    expect(firstNameForGreeting(undefined, 'BOB@EXAMPLE.COM')).toBe('Bob');
  });

  it('falls back to a neutral greeting when nothing usable exists', () => {
    expect(firstNameForGreeting('', '')).toBe('there');
    expect(firstNameForGreeting(null, null)).toBe('there');
    expect(firstNameForGreeting('', '123@x.io')).toBe('there');
  });
});

describe('month arithmetic', () => {
  it('rolls backward across a year boundary', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-10')).toBe('2026-09');
  });

  it('adds and subtracts months across boundaries', () => {
    expect(addMonths('2026-10', -5)).toBe('2026-05');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('produces an inclusive range', () => {
    expect(monthRange('2026-08', '2026-10')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(monthRange('2026-10', '2026-10')).toEqual(['2026-10']);
  });

  it('reports correct days per month including leap years', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
  });
});

describe('formatting', () => {
  it('formats long and short month labels', () => {
    expect(formatYearMonth('2026-10')).toBe('October 2026');
    expect(formatShortMonth('2026-10')).toBe('Oct');
    expect(formatYearMonth('2026-01')).toBe('January 2026');
  });

  it('formats a full day deterministically in UTC', () => {
    expect(formatDay('2026-10-05')).toBe('05 Oct 2026');
  });
});
