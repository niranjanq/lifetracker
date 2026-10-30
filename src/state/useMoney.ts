import { useCallback } from 'react';
import { useApp } from './store';
import { formatMoney } from '../domain/money';
import type { CurrencyCode } from '../domain/types';

/** Returns currency-aware formatters bound to the active preference. */
export function useMoney() {
  const { data } = useApp();
  const currency: CurrencyCode = data?.preferences.currency ?? 'INR';
  const fmt = useCallback((minor: number, opts?: { sign?: boolean; decimals?: boolean }) => formatMoney(minor, currency, opts), [currency]);
  return { currency, fmt };
}
