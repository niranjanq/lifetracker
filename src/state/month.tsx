import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { YearMonth } from '../domain/types';
import { currentYearMonth } from '../domain/date';

interface MonthCtx {
  month: YearMonth;
  setMonth: (m: YearMonth) => void;
}

const Ctx = createContext<MonthCtx | null>(null);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState<YearMonth>(currentYearMonth());
  const value = useMemo(() => ({ month, setMonth }), [month]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMonth(): MonthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMonth must be used within MonthProvider');
  return c;
}
