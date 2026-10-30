import { z } from 'zod';

/** A user-facing rupee amount string -> validated positive decimal. */
const amountStr = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '')), 'Enter a valid amount (up to 2 decimals)')
  .refine((v) => Number(v.replace(/,/g, '')) > 0, 'Amount must be greater than zero');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date');

export const transactionSchema = z.object({
  amount: amountStr,
  date: isoDate,
  kind: z.enum(['income', 'expense', 'transfer', 'investment', 'refund']),
  categoryId: z.string().min(1, 'Choose a category'),
  description: z.string().max(120).optional(),
  merchant: z.string().max(60).optional(),
  method: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
  tags: z.string().max(120).optional(),
});
export type TransactionForm = z.infer<typeof transactionSchema>;

export const salarySchema = z.object({
  amount: amountStr,
  date: isoDate,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  source: z.string().max(60).optional(),
  note: z.string().max(500).optional(),
});
export type SalaryForm = z.infer<typeof salarySchema>;

export const allocationSchema = z.object({
  label: z.string().min(1, 'Name this allocation').max(60),
  amount: amountStr,
  categoryId: z.string().min(1, 'Choose a category'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});
export type AllocationForm = z.infer<typeof allocationSchema>;

export const budgetSchema = z.object({
  amount: amountStr,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  categoryId: z.string(), // '' means overall
});

export const healthLogSchema = z.object({
  date: isoDate,
  time: z.string().optional(),
  wellbeing: z.coerce.number().int().min(1).max(5),
  note: z.string().max(1000).optional(),
  activityImpact: z.string().max(200).optional(),
});
export type HealthLogForm = z.infer<typeof healthLogSchema>;

export const medicationSchema = z.object({
  name: z.string().min(1, 'Medication name is required').max(60),
  dose: z.string().min(1, 'Enter the dose exactly as prescribed').max(60),
  date: isoDate,
  time: z.string().optional(),
  note: z.string().max(500).optional(),
});
export type MedicationForm = z.infer<typeof medicationSchema>;

export const measurementSchema = z.object({
  typeId: z.string().min(1, 'Choose a measurement'),
  date: isoDate,
  value: z
    .string()
    .trim()
    .refine((v) => v === '' || (Number(v) >= 0 && Number.isFinite(Number(v))), 'Enter a non-negative number or leave blank'),
  note: z.string().max(200).optional(),
});
export type MeasurementForm = z.infer<typeof measurementSchema>;
