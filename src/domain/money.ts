/**
 * Money helpers — all authoritative financial arithmetic happens here using
 * INTEGER minor units (e.g. paise for INR). Never use floating point for
 * sums of currency. Minor-unit scale is 100 for every supported currency
 * except JPY (0 decimals), which we still store as integer yen.
 */
import type { CurrencyCode } from './types';

export const MINOR_DIVISORS: Record<CurrencyCode, number> = {
  INR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
  AUD: 100,
  CAD: 100,
  SGD: 100,
  JPY: 1,
};

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  JPY: '¥',
};

/** Parse a user-entered decimal string ("1,250.50") into integer minor units. */
export function parseToMinor(input: string | number, currency: CurrencyCode = 'INR'): number {
  const cleaned =
    typeof input === 'number'
      ? input.toFixed(2)
      : String(input).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return NaN;
  const divisor = MINOR_DIVISORS[currency];
  // Round half away from zero to avoid float drift at the boundary.
  return Math.sign(value) * Math.round(Math.abs(value) * divisor);
}

/** Convert integer minor units to a plain JS number (display/chart use only). */
export function minorToMajor(minor: number, currency: CurrencyCode = 'INR'): number {
  return minor / MINOR_DIVISORS[currency];
}

/**
 * Format minor units for display with thousands separators.
 * group='en-IN' gives the lakh/comma style for INR, otherwise standard grouping.
 */
export function formatMoney(
  minor: number,
  currency: CurrencyCode = 'INR',
  opts: { sign?: boolean; decimals?: boolean } = {},
): string {
  const divisor = MINOR_DIVISORS[currency];
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / divisor);
  const frac = abs % divisor;
  const useDecimals = opts.decimals ?? divisor > 1;

  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  let body = whole.toLocaleString(locale);
  if (useDecimals && divisor > 1) {
    body += '.' + String(frac).padStart(2, '0');
  }

  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  const signPrefix = negative ? '-' : opts.sign ? '+' : '';
  return `${signPrefix}${symbol}${body}`;
}

/** Sum an array of minor amounts with no float accumulation. */
export function sumMinor(values: number[]): number {
  let total = 0;
  for (const v of values) total += Math.trunc(v);
  return total;
}

/** Safely add with integer guarantees. */
export function addMinor(a: number, b: number): number {
  return Math.trunc(a) + Math.trunc(b);
}

/** Percentage of `part` relative to `whole`, rounded to nearest integer. */
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
