import { describe, it, expect } from 'vitest';
import {
  parseToMinor,
  formatMoney,
  minorToMajor,
  sumMinor,
  addMinor,
  pct,
  MINOR_DIVISORS,
} from './money';

describe('parseToMinor', () => {
  it('parses grouped decimal strings into integer paise', () => {
    expect(parseToMinor('1,250.50', 'INR')).toBe(125050);
    expect(parseToMinor('10', 'INR')).toBe(1000);
    expect(parseToMinor('0.99', 'INR')).toBe(99);
  });

  it('handles numeric input and rounds half away from zero', () => {
    expect(parseToMinor(12.5, 'INR')).toBe(1250);
    expect(parseToMinor(12.345, 'INR')).toBe(1235);
  });

  it('uses a 1:1 scale for zero-decimal currencies (JPY)', () => {
    expect(MINOR_DIVISORS.JPY).toBe(1);
    expect(parseToMinor('1000', 'JPY')).toBe(1000);
  });

  it('returns NaN for empty / non-numeric input', () => {
    expect(Number.isNaN(parseToMinor('', 'INR'))).toBe(true);
    expect(Number.isNaN(parseToMinor('-', 'INR'))).toBe(true);
    expect(Number.isNaN(parseToMinor('.', 'INR'))).toBe(true);
    expect(Number.isNaN(parseToMinor('abc', 'INR'))).toBe(true);
  });

  it('preserves sign for negative values', () => {
    expect(parseToMinor('-50.25', 'INR')).toBe(-5025);
  });
});

describe('formatMoney', () => {
  it('formats INR with lakh grouping and two decimals', () => {
    expect(formatMoney(125050, 'INR')).toBe('₹1,250.50');
    expect(formatMoney(10000000, 'INR')).toBe('₹1,00,000.00');
  });

  it('omits decimals for JPY', () => {
    expect(formatMoney(1000, 'JPY')).toBe('¥1,000');
  });

  it('supports explicit sign and negative values', () => {
    expect(formatMoney(5000, 'INR', { sign: true })).toBe('+₹50.00');
    expect(formatMoney(-5000, 'INR')).toBe('-₹50.00');
  });

  it('round-trips with parseToMinor', () => {
    const minor = parseToMinor('875.40', 'INR');
    expect(minor).toBe(87540);
    expect(formatMoney(minor, 'INR')).toBe('₹875.40');
  });
});

describe('minorToMajor / sums / pct', () => {
  it('converts minor to major for chart use only', () => {
    expect(minorToMajor(125050, 'INR')).toBeCloseTo(1250.5);
  });

  it('sums with integer truncation, no float drift', () => {
    expect(sumMinor([100, 250, 3])).toBe(353);
    expect(sumMinor([100.9, 200.9])).toBe(300); // truncates each term
    expect(addMinor(99, 1)).toBe(100);
  });

  it('computes percentage and guards against non-positive whole', () => {
    expect(pct(50, 200)).toBe(25);
    expect(pct(1, 3)).toBe(33);
    expect(pct(10, 0)).toBe(0);
  });
});
