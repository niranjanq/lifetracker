import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { transactionSchema, type TransactionForm } from '../../domain/schemas';
import { useApp } from '../../state/store';
import { parseToMinor } from '../../domain/money';
import { currentISODate } from '../../domain/date';
import { Button, Field, Input, Select } from '../ui/primitives';
import type { Transaction, TransactionKind } from '../../domain/types';

const KINDS: Array<{ value: TransactionKind; label: string; hint: string }> = [
  { value: 'expense', label: 'Expense', hint: 'Consumption — counts against your spending budget' },
  { value: 'transfer', label: 'Transfer', hint: 'Money moved (savings, family, rent) — not spending' },
  { value: 'investment', label: 'Investment', hint: 'SIP / investment contribution — not spending' },
  { value: 'income', label: 'Income', hint: 'Money in (salary, other income)' },
  { value: 'refund', label: 'Refund', hint: 'Offsets spending in the same category' },
];

export function TransactionForm({
  initial,
  onDone,
  compact,
}: {
  initial?: Transaction;
  onDone?: () => void;
  compact?: boolean;
}) {
  const { data, upsertTransaction } = useApp();
  const categories = data?.categories ?? [];
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransactionForm>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      amount: '',
      date: currentISODate(),
      kind: 'expense',
      categoryId: '',
      description: '',
      merchant: '',
      method: '',
      note: '',
      tags: '',
    },
  });

  useEffect(() => {
    if (initial) {
      reset({
        amount: (initial.amountMinor / 100).toString(),
        date: initial.date,
        kind: initial.kind,
        categoryId: initial.categoryId,
        description: initial.description ?? '',
        merchant: initial.merchant ?? '',
        method: initial.method ?? '',
        note: initial.note ?? '',
        tags: initial.tags.join(', '),
      });
    }
  }, [initial, reset]);

  const kind = watch('kind');
  const categoryId = watch('categoryId');
  const kindHint = KINDS.find((k) => k.value === kind)?.hint;

  // When kind changes, preselect a matching category if the current one is incompatible.
  useEffect(() => {
    if (!categories.length) return;
    const current = categories.find((c) => c.id === categoryId);
    if (!current) {
      const match = categories.find((c) => c.defaultKind === kind);
      if (match && !categoryId) reset((prev) => ({ ...prev, categoryId: match.id }));
    }
  }, [kind, categoryId, categories, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const amountMinor = parseToMinor(values.amount, data?.preferences.currency ?? 'INR');
    if (Number.isNaN(amountMinor)) return;
    await upsertTransaction({
      id: initial?.id,
      createdAt: initial?.createdAt,
      amountMinor,
      date: values.date,
      kind: values.kind,
      categoryId: values.categoryId,
      description: values.description || undefined,
      merchant: values.merchant || undefined,
      method: values.method || undefined,
      note: values.note || undefined,
      tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    });
    if (!initial) {
      reset({ amount: '', date: values.date, kind: values.kind, categoryId: values.categoryId, description: '', merchant: '', method: '', note: '', tags: '' });
    }
    onDone?.();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" error={errors.amount?.message} htmlFor="tx-amount">
          <Input id="tx-amount" inputMode="decimal" placeholder="0.00" autoComplete="off" {...register('amount')} />
        </Field>
        <Field label="Date" error={errors.date?.message} htmlFor="tx-date">
          <Input id="tx-date" type="date" {...register('date')} />
        </Field>
      </div>

      <Field label="Type" hint={kindHint} htmlFor="tx-kind">
        <Select id="tx-kind" {...register('kind')}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Category" error={errors.categoryId?.message} htmlFor="tx-cat">
        <Select id="tx-cat" {...register('categoryId')}>
          <option value="">Select a category…</option>
          {categories
            .filter((c) => c.defaultKind === kind || (kind === 'expense' && c.defaultKind === 'expense'))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.essential ? ' •' : ''}
              </option>
            ))}
        </Select>
      </Field>

      {!compact && (
        <>
          <Field label="Description" htmlFor="tx-desc">
            <Input id="tx-desc" placeholder="e.g. Weekly groceries" {...register('description')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Merchant" htmlFor="tx-merchant">
              <Input id="tx-merchant" {...register('merchant')} />
            </Field>
            <Field label="Payment method" htmlFor="tx-method">
              <Input id="tx-method" placeholder="UPI / card / cash" {...register('method')} />
            </Field>
          </div>
          <Field label="Tags" hint="Comma-separated" htmlFor="tx-tags">
            <Input id="tx-tags" placeholder="recurring, work" {...register('tags')} />
          </Field>
          <Field label="Notes" htmlFor="tx-note">
            <Input id="tx-note" {...register('note')} />
          </Field>
        </>
      )}

      <div className="mt-1 flex justify-end gap-2">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : initial ? 'Save changes' : 'Add transaction'}
        </Button>
      </div>
    </form>
  );
}
