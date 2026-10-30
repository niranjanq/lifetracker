import { describe, it, expect } from 'vitest';
import {
  transactionSchema,
  salarySchema,
  healthLogSchema,
  measurementSchema,
  allocationSchema,
} from './schemas';

describe('transactionSchema', () => {
  const valid = {
    amount: '250.50',
    date: '2026-10-05',
    kind: 'expense',
    categoryId: 'cat-food',
  };

  it('accepts a well-formed transaction', () => {
    expect(transactionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a zero or negative amount', () => {
    expect(transactionSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...valid, amount: '-5' }).success).toBe(false);
  });

  it('rejects more than two decimals', () => {
    expect(transactionSchema.safeParse({ ...valid, amount: '10.123' }).success).toBe(false);
  });

  it('requires a valid ISO date and a category', () => {
    expect(transactionSchema.safeParse({ ...valid, date: '2026-10' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...valid, categoryId: '' }).success).toBe(false);
  });

  it('accepts thousands-separated amounts', () => {
    expect(transactionSchema.safeParse({ ...valid, amount: '1,250.00' }).success).toBe(true);
  });
});

describe('salary & allocation schemas', () => {
  it('require a YYYY-MM month', () => {
    expect(salarySchema.safeParse({ amount: '50000', date: '2026-10-01', month: '2026-10' }).success).toBe(true);
    expect(salarySchema.safeParse({ amount: '50000', date: '2026-10-01', month: 'Oct-26' }).success).toBe(false);
    expect(allocationSchema.safeParse({ label: 'Rent', amount: '12000', categoryId: 'cat-rent', month: '2026-10' }).success).toBe(true);
    expect(allocationSchema.safeParse({ label: '', amount: '12000', categoryId: 'cat-rent', month: '2026-10' }).success).toBe(false);
  });
});

describe('health & measurement schemas', () => {
  it('coerces wellbeing into the 1..5 range', () => {
    expect(healthLogSchema.safeParse({ date: '2026-10-05', wellbeing: '3' }).success).toBe(true);
    expect(healthLogSchema.safeParse({ date: '2026-10-05', wellbeing: '6' }).success).toBe(false);
    expect(healthLogSchema.safeParse({ date: '2026-10-05', wellbeing: '0' }).success).toBe(false);
  });

  it('allows a blank measurement value (never coerced to zero)', () => {
    expect(measurementSchema.safeParse({ typeId: 'mt-weight', date: '2026-10-05', value: '' }).success).toBe(true);
    expect(measurementSchema.safeParse({ typeId: 'mt-weight', date: '2026-10-05', value: '72.5' }).success).toBe(true);
    expect(measurementSchema.safeParse({ typeId: 'mt-weight', date: '2026-10-05', value: '-1' }).success).toBe(false);
  });
});
