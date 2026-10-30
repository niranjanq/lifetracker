import type { ISODate, YearMonth } from '../domain/types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Derive 'YYYY-MM' from a 'YYYY-MM-DD' date string (no timezone coercion). */
export function toYearMonth(date: ISODate): YearMonth {
  return date.slice(0, 7);
}

export function currentISODate(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentYearMonth(now: Date = new Date()): YearMonth {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Format a 'YYYY-MM' as 'October 2026'. */
export function formatYearMonth(ym: YearMonth): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

export function formatShortMonth(ym: YearMonth): string {
  const [, m] = ym.split('-').map(Number);
  return MONTH_NAMES[(m || 1) - 1].slice(0, 3);
}

/** Format a 'YYYY-MM-DD' as '12 Oct 2026'. */
export function formatDay(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Return the previous year-month, e.g. '2026-01' -> '2025-12'. */
export function prevMonth(ym: YearMonth): YearMonth {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Inclusive list of year-months from start to end (both 'YYYY-MM'). */
export function monthRange(start: YearMonth, end: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 240) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

/** The number of days in a given year-month. */
export function daysInMonth(ym: YearMonth): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const KOLKATA_HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  hour12: false,
});

/** Hour (0-23) in the reference time zone (India / Asia/Kolkata), TZ-independent. */
function hourInKolkata(now: Date): number {
  const raw = KOLKATA_HOUR_FORMAT.formatToParts(now).find((p) => p.type === 'hour')?.value ?? '0';
  // Some locales render midnight as "24" with hour12:false.
  return parseInt(raw, 10) % 24;
}

export function greetingForNow(now: Date = new Date()): string {
  const h = hourInKolkata(now);
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Best-effort first name for the greeting. Prefers the first token of the
 * user's display name; otherwise derives a capitalised word from the email
 * local-part; otherwise falls back to a neutral "there". Never fabricates a
 * specific identity.
 */
export function firstNameForGreeting(displayName?: string | null, email?: string | null): string {
  const dn = (displayName ?? '').trim();
  if (dn) return dn.split(/\s+/)[0];
  const local = (email ?? '').split('@')[0] ?? '';
  const first = local.split(/[._\-+\d]+/).filter(Boolean)[0] ?? '';
  if (!first) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
