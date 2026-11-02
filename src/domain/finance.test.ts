import { describe, it, expect } from 'vitest';
import { computeFinanceSummary, categoryNetSpend, categoryBudgetLimit, monthlyTrend, allocationActualMinor } from './finance';
import type { FinanceData } from './finance';
import { CAT, GROUP } from './categories';
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

describe('monthly pocket money', () => {
  it('sums net spend across member categories only', () => {
    const data = baseData({
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 200000, categoryId: CAT.food }),
        tx({ id: 't2', kind: 'expense', amountMinor: 100000, categoryId: CAT.shopping }),
        tx({ id: 't3', kind: 'expense', amountMinor: 50000, categoryId: CAT.transport }),
      ],
      budgets: [{ id: 'bg1', month: M, categoryId: GROUP.pocketMoney, limitMinor: 500000, createdAt: '' }],
    });
    const s = computeFinanceSummary(M, data);
    expect(s.pocketMoneySpentMinor).toBe(300000); // transport is not a member
    expect(s.pocketMoneyLimitMinor).toBe(500000);
  });

  it('nets refunds inside member categories', () => {
    const data = baseData({
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 200000, categoryId: CAT.health }),
        tx({ id: 't2', kind: 'refund', amountMinor: 50000, categoryId: CAT.health }),
      ],
    });
    expect(computeFinanceSummary(M, data).pocketMoneySpentMinor).toBe(150000);
  });

  it('reports a zero limit when no pocket-money budget is set', () => {
    expect(computeFinanceSummary(M, baseData()).pocketMoneyLimitMinor).toBe(0);
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

describe('pocket money parent allocation', () => {
  const parent = (over: Partial<Allocation> = {}): Allocation => ({
    id: 'alloc-pm', month: M, categoryId: GROUP.pocketMoney, label: 'Pocket money', plannedMinor: 1000000, createdAt: '', ...over,
  });
  const legacyBudget: Budget = { id: 'bg-pm', month: M, categoryId: GROUP.pocketMoney, limitMinor: 500000, createdAt: '' };

  it('uses the parent allocation amount when present', () => {
    const s = computeFinanceSummary(M, baseData({ allocations: [parent()] }));
    expect(s.pocketMoneyHasParentAllocation).toBe(true);
    expect(s.pocketMoneyLimitMinor).toBe(1000000);
  });

  it('a ₹0 parent beats a legacy budget (existence, not amount)', () => {
    const s = computeFinanceSummary(M, baseData({ allocations: [parent({ plannedMinor: 0 })], budgets: [legacyBudget] }));
    expect(s.pocketMoneyHasParentAllocation).toBe(true);
    expect(s.pocketMoneyLimitMinor).toBe(0);
  });

  it('falls back to the legacy budget only when no parent exists', () => {
    const s = computeFinanceSummary(M, baseData({ budgets: [legacyBudget] }));
    expect(s.pocketMoneyHasParentAllocation).toBe(false);
    expect(s.pocketMoneyLimitMinor).toBe(500000);
  });

  it('neither parent nor budget means zero', () => {
    const s = computeFinanceSummary(M, baseData());
    expect(s.pocketMoneyLimitMinor).toBe(0);
    expect(s.pocketMoneyUsagePct).toBe(0);
    expect(s.pocketMoneyRemainingMinor).toBe(0);
  });

  it('duplicate parents resolve consistently: first record wins, extras are legacy', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent({ id: 'p1', plannedMinor: 600000 }), parent({ id: 'p2', plannedMinor: 400000 })],
    }));
    expect(s.pocketMoneyLimitMinor).toBe(600000); // same record the UI edits
    expect(s.legacyChildAllocationIds).toEqual(['p2']);
    expect(s.plannedAllocationMinor).toBe(600000); // no double planning
  });

  it('parent overrides the legacy budget when both exist', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent({ plannedMinor: 800000 })], budgets: [legacyBudget],
    }));
    expect(s.pocketMoneyLimitMinor).toBe(800000);
  });

  it('task example: 1000 shopping + 500 food - 300 refund = 1200 of 5000', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent({ plannedMinor: 500000 })],
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 100000, categoryId: CAT.shopping }),
        tx({ id: 't2', kind: 'expense', amountMinor: 50000, categoryId: CAT.food }),
        tx({ id: 't3', kind: 'refund', amountMinor: 30000, categoryId: CAT.shopping }),
      ],
    }));
    expect(s.pocketMoneySpentMinor).toBe(120000);
    expect(s.pocketMoneyRemainingMinor).toBe(380000);
    expect(s.pocketMoneyUsagePct).toBe(24);
    expect(s.pocketMoneyBreakdown.map((c) => c.categoryId).sort()).toEqual([CAT.food, CAT.shopping].sort());
  });

  it('aggregates all five child categories', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent()],
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 150000, categoryId: CAT.food }),
        tx({ id: 't2', kind: 'expense', amountMinor: 200000, categoryId: CAT.shopping }),
        tx({ id: 't3', kind: 'expense', amountMinor: 50000, categoryId: CAT.health }),
        tx({ id: 't4', kind: 'expense', amountMinor: 100000, categoryId: CAT.bills }),
        tx({ id: 't5', kind: 'expense', amountMinor: 50000, categoryId: CAT.entertainment }),
      ],
    }));
    expect(s.pocketMoneySpentMinor).toBe(550000);
    expect(s.pocketMoneyRemainingMinor).toBe(450000);
    expect(s.pocketMoneyBreakdown).toHaveLength(5);
  });

  it('non-member categories never reduce pocket money', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent()],
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 40000, categoryId: CAT.transport }),
        tx({ id: 't2', kind: 'expense', amountMinor: 40000, categoryId: CAT.education }),
        tx({ id: 't3', kind: 'expense', amountMinor: 40000, categoryId: CAT.subscriptions }),
        tx({ id: 't4', kind: 'expense', amountMinor: 40000, categoryId: CAT.other }),
      ],
    }));
    expect(s.pocketMoneySpentMinor).toBe(0);
  });

  it('multiple refunds net; refunds never cross categories', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent()],
      transactions: [
        tx({ id: 't1', kind: 'expense', amountMinor: 100000, categoryId: CAT.shopping }),
        tx({ id: 't2', kind: 'refund', amountMinor: 10000, categoryId: CAT.shopping }),
        tx({ id: 't3', kind: 'refund', amountMinor: 20000, categoryId: CAT.shopping }),
        tx({ id: 't4', kind: 'expense', amountMinor: 50000, categoryId: CAT.food }),
        tx({ id: 't5', kind: 'refund', amountMinor: 80000, categoryId: CAT.food }), // exceeds expense -> floors at 0
      ],
    }));
    expect(s.pocketMoneySpentMinor).toBe(70000); // 70000 + 0
  });

  it('overspending yields negative remaining and >100% usage', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent({ plannedMinor: 500000 })],
      transactions: [tx({ id: 't1', kind: 'expense', amountMinor: 700000, categoryId: CAT.food })],
    }));
    expect(s.pocketMoneyRemainingMinor).toBe(-200000);
    expect(s.pocketMoneyUsagePct).toBe(140);
  });

  it('month-wise isolation for parents and transactions', () => {
    const s = computeFinanceSummary(M, baseData({
      allocations: [parent({ month: '2026-09' })],
      transactions: [tx({ id: 't1', kind: 'expense', amountMinor: 100000, categoryId: CAT.food, month: '2026-09', date: '2026-09-10' })],
    }));
    expect(s.pocketMoneyLimitMinor).toBe(0);
    expect(s.pocketMoneySpentMinor).toBe(0);
  });

  it('editing/deleting transactions, refunds and the parent recomputes (nothing is stored)', () => {
    const spent = (allocs: Allocation[], txns: Transaction[]) =>
      computeFinanceSummary(M, baseData({ allocations: allocs, transactions: txns })).pocketMoneySpentMinor;
    const expense = tx({ id: 't1', kind: 'expense', amountMinor: 100000, categoryId: CAT.shopping });
    const refund = tx({ id: 't2', kind: 'refund', amountMinor: 30000, categoryId: CAT.shopping });
    expect(spent([parent()], [expense, refund])).toBe(70000);
    expect(spent([parent()], [{ ...expense, amountMinor: 150000 }, refund])).toBe(120000); // edit expense
    expect(spent([parent()], [expense, { ...refund, amountMinor: 60000 }])).toBe(40000); // edit refund
    expect(spent([parent()], [refund])).toBe(0); // delete expense
    expect(spent([parent()], [expense])).toBe(100000); // delete refund
    expect(spent([parent()], [{ ...expense, categoryId: CAT.rent }, refund])).toBe(0); // category change
    expect(spent([], [expense, refund])).toBe(70000); // spend is derived from transactions, not allocations
    expect(computeFinanceSummary(M, baseData({ transactions: [expense, refund] })).pocketMoneyLimitMinor).toBe(0); // parent removed -> fallback gone
    const limitAfterEdit = computeFinanceSummary(M, baseData({ allocations: [parent({ plannedMinor: 1200000 })] })).pocketMoneyLimitMinor;
    expect(limitAfterEdit).toBe(1200000); // edit parent
  });

  it('historical child allocations are preserved, flagged and not double-counted', () => {
    const child: Allocation = { id: 'alloc-child', month: M, categoryId: CAT.shopping, label: 'Shopping plan', plannedMinor: 200000, createdAt: '' };
    const rent: Allocation = { id: 'alloc-rent', month: M, categoryId: CAT.rent, label: 'Rent', plannedMinor: 800000, createdAt: '' };
    const withParent = computeFinanceSummary(M, baseData({ allocations: [parent(), child, rent] }));
    expect(withParent.legacyChildAllocationIds).toEqual(['alloc-child']); // preserved, just flagged
    expect(withParent.plannedAllocationMinor).toBe(1800000); // parent + rent; child not double-planned
    const withoutParent = computeFinanceSummary(M, baseData({ allocations: [child, rent] }));
    expect(withoutParent.legacyChildAllocationIds).toEqual([]); // historical months unchanged
    expect(withoutParent.plannedAllocationMinor).toBe(1000000);
  });

  it('independent allocation actuals via the domain engine', () => {
    const data = baseData({
      transactions: [
        tx({ id: 't1', kind: 'transfer', amountMinor: 800000, categoryId: CAT.rent }),
        tx({ id: 't2', kind: 'transfer', amountMinor: 500000, categoryId: CAT.family }),
        tx({ id: 't3', kind: 'investment', amountMinor: 300000, categoryId: CAT.sip }),
        tx({ id: 't4', kind: 'transfer', amountMinor: 200000, categoryId: CAT.savings }),
        tx({ id: 't5', kind: 'expense', amountMinor: 100000, categoryId: CAT.food }),
        tx({ id: 't6', kind: 'refund', amountMinor: 40000, categoryId: CAT.food }),
        tx({ id: 't7', kind: 'income', amountMinor: 900000, categoryId: CAT.rent }), // must be ignored
      ],
    });
    expect(allocationActualMinor(M, CAT.rent, data)).toBe(800000);
    expect(allocationActualMinor(M, CAT.family, data)).toBe(500000);
    expect(allocationActualMinor(M, CAT.sip, data)).toBe(300000);
    expect(allocationActualMinor(M, CAT.savings, data)).toBe(200000);
    expect(allocationActualMinor(M, CAT.food, data)).toBe(60000); // refund netted
    expect(allocationActualMinor(M, GROUP.pocketMoney, data)).toBe(60000); // parent = sum of member nets
  });
});
