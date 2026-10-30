import { describe, it, expect } from 'vitest';
import { computeFinanceSummary, categoryNetSpend, categoryBudgetLimit, monthlyTrend } from './finance';
import type { FinanceData } from './finance';
import { CAT } from './categories';
import type { Transaction, SalaryReceipt, Allocation, Budget } from './types';

const M = '2026-10';

function tx(partial: Partial<Transaction> & { id: string; kind: Transaction['kind']; amountMinor: number }): Transaction {
  return {
    month: M,
    date: `${M}-05`,
    categoryId: CAT.food,
    tags: [],
    demo: false,
    createdAt: `${M}-05T00:00:00.000Z`,
    ...partial,
  } as Transaction;
}

function baseData(over: Partial<FinanceData> = {}): FinanceData {
  return {
    plans: [],
    salaryReceipts: [],
    allocations: [],
    transactions: [],
    budgets: [],
    categories: [],
    ...over,
  };
}

describe('computeFinanceSummary', () => {
  it('separates salary income from other income', () => {
    const salary: SalaryReceipt = { id: 's1', month: M, date: `${M}-01`, amountMinor: 500000, createdAt: '' };
    const data = baseData({
      salaryReceipts: [salary],
      transactions: [tx({ id: 't1', kind: 'income', amountMinor: 80000, categoryId: CAT.otherIncome })],
    });
    const s = computeFinanceSummary(M, data);
    expect(s.salaryReceivedMinor).toBe(500000);
    expect(s.otherIncomeMinor).toBe(80000);
  });

  it('excludes salary-category income transactions from "other income"', () => {
    const data = baseData({
      transactions: [tx({ id: 't1', kind: 'income', amountMinor: 500000, categoryId: CAT.salary })],
    });
    expect(computeFinanceSummary(M, data).otherIncomeMinor).toBe(0);
  });

  it('nets refunds against the same category and floors the net at zero', () => {
    const data = baseData({
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 30000, categoryId: CAT.shopping }),
        tx({ id: 't2', kind: 'refund', amountMinor: 10000, categoryId: CAT.shopping }),
        tx({ id: 't3', kind: 'expense', amountMinor: 5000, categoryId: CAT.food }),
        tx({ id: 't4', kind: 'refund', amountMinor: 9000, categoryId: CAT.food }), // refund exceeds expense
      ],
    });
    const s = computeFinanceSummary(M, data);
    expect(s.grossSpendingMinor).toBe(35000);
    expect(s.refundMinor).toBe(19000);
    // net per category floored at 0: shopping 20000, food max(0, 5000-9000)=0
    expect(s.netSpendingMinor).toBe(20000);
  });

  it('does not count transfers or investments as consumption', () => {
    const data = baseData({
      transactions: [
        tx({ id: 't1', kind: 'transfer', amountMinor: 200000, categoryId: CAT.savings }),
        tx({ id: 't2', kind: 'transfer', amountMinor: 150000, categoryId: CAT.rent }),
        tx({ id: 't3', kind: 'investment', amountMinor: 50000, categoryId: CAT.sip }),
        tx({ id: 't4', kind: 'expense', amountMinor: 4000, categoryId: CAT.food }),
      ],
    });
    const s = computeFinanceSummary(M, data);
    expect(s.netSpendingMinor).toBe(4000); // only the expense
    expect(s.savingsMinor).toBe(200000);
    expect(s.otherTransfersMinor).toBe(150000); // rent transfer, non-savings
    expect(s.investmentMinor).toBe(50000);
    expect(s.savedOrInvestedMinor).toBe(250000);
  });

  it('computes unallocated and oversubscribed against planned allocations', () => {
    const salary: SalaryReceipt = { id: 's1', month: M, date: `${M}-01`, amountMinor: 100000, createdAt: '' };
    const alloc: Allocation = { id: 'a1', month: M, categoryId: CAT.food, label: 'Food', plannedMinor: 150000, createdAt: '' };
    const s = computeFinanceSummary(M, baseData({ salaryReceipts: [salary], allocations: [alloc] }));
    expect(s.plannedAllocationMinor).toBe(150000);
    expect(s.unallocatedMinor).toBe(-50000);
    expect(s.oversubscribedMinor).toBe(50000);
  });

  it('derives budget usage percentage and remaining from the overall budget', () => {
    const budget: Budget = { id: 'b1', month: M, categoryId: null, limitMinor: 100000, createdAt: '' };
    const data = baseData({
      budgets: [budget],
      transactions: [tx({ id: 't1', kind: 'expense', amountMinor: 25000, categoryId: CAT.food })],
    });
    const s = computeFinanceSummary(M, data);
    expect(s.overallBudgetMinor).toBe(100000);
    expect(s.remainingBudgetMinor).toBe(75000);
    expect(s.budgetUsagePct).toBe(25);
  });

  it('ignores records from other months', () => {
    const data = baseData({
      transactions: [tx({ id: 't1', kind: 'expense', amountMinor: 25000, month: '2026-09', date: '2026-09-05' })],
    });
    expect(computeFinanceSummary(M, data).netSpendingMinor).toBe(0);
  });
});

describe('helpers', () => {
  it('categoryNetSpend floors at zero', () => {
    const txns = [
      tx({ id: 't1', kind: 'expense', amountMinor: 10000, categoryId: CAT.food }),
      tx({ id: 't2', kind: 'refund', amountMinor: 15000, categoryId: CAT.food }),
    ];
    expect(categoryNetSpend(M, CAT.food, txns)).toBe(0);
  });

  it('categoryBudgetLimit returns null when unset', () => {
    const budgets: Budget[] = [{ id: 'b1', month: M, categoryId: CAT.food, limitMinor: 50000, createdAt: '' }];
    expect(categoryBudgetLimit(budgets, M, CAT.food)).toBe(50000);
    expect(categoryBudgetLimit(budgets, M, CAT.shopping)).toBeNull();
  });

  it('monthlyTrend maps each month through the summary', () => {
    const data = baseData({
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 1000, month: '2026-10', date: '2026-10-02' }),
        tx({ id: 't2', kind: 'expense', amountMinor: 2000, month: '2026-11', date: '2026-11-02' }),
      ],
    });
    const trend = monthlyTrend(['2026-10', '2026-11'], data);
    expect(trend.map((t) => t.netSpendingMinor)).toEqual([1000, 2000]);
  });
});
