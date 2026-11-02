/**
 * Financial calculation engine.
 *
 * ACCOUNTING RULES (kept deliberately explicit)
 * ---------------------------------------------
 * 1. Salary / income are recorded separately from spending. `salaryReceived`
 *    is actual money in (from salary receipts); `otherIncome` is income-kind
 *    transactions that are not salary.
 * 2. A PLANNED allocation is not an actual payment. Planned totals come from
 *    `allocations`; actual commitments come from transactions.
 * 3. Consumption spending = transactions of kind 'expense'. Refunds ('refund')
 *    offset spending in the SAME category. Transfers and investments are NOT
 *    consumption, so a savings transfer or SIP contribution never inflates the
 *    spending budget.
 * 4. Savings & investments are tracked apart: savings-category transfers plus
 *    investment-category contributions.
 * 5. Everything sums in integer minor units.
 */
import type {
  Allocation,
  Budget,
  Category,
  SalaryReceipt,
  Transaction,
  YearMonth,
} from './types';
import { CAT, GROUP, MONTHLY_POCKET } from './categories';
import { sumMinor } from './money';

export interface PlanRecord {
  month: YearMonth;
  expectedSalaryMinor: number;
}

export interface FinanceData {
  plans: PlanRecord[];
  salaryReceipts: SalaryReceipt[];
  allocations: Allocation[];
  transactions: Transaction[];
  budgets: Budget[];
  categories: Category[];
}

export interface CategorySpend {
  categoryId: string;
  grossMinor: number; // total expense
  refundMinor: number; // total refunds offsetting this category
  netMinor: number; // gross - refund (floored at 0 for the net)
}

export interface FinanceSummary {
  month: YearMonth;
  expectedSalaryMinor: number;
  salaryReceivedMinor: number;
  otherIncomeMinor: number;
  plannedAllocationMinor: number;
  unallocatedMinor: number; // salaryReceived - planned (may be negative => oversubscribed)
  oversubscribedMinor: number; // positive amount by which planned exceeds received
  netSpendingMinor: number; // consumption after refunds
  grossSpendingMinor: number;
  refundMinor: number;
  savingsMinor: number; // savings-category transfers
  investmentMinor: number; // investment-kind contributions
  savedOrInvestedMinor: number;
  otherTransfersMinor: number; // rent + family + non-savings transfers
  overallBudgetMinor: number; // the overall (category-less) budget limit
  remainingBudgetMinor: number; // overall budget - net spending
  budgetUsagePct: number;
  pocketMoneySpentMinor: number; // net spend across the pocket-money group
  pocketMoneyLimitMinor: number; // parent allocation when present (even ₹0); else legacy budget
  pocketMoneyHasParentAllocation: boolean; // record existence, NOT amount comparison
  pocketMoneyRemainingMinor: number; // limit - spent (negative when overspent)
  pocketMoneyUsagePct: number; // spent/limit*100 (0 when limit unset)
  pocketMoneyBreakdown: CategorySpend[]; // member categories only
  legacyChildAllocationIds: string[]; // child/duplicate-parent allocations superseded this month
  categorySpend: CategorySpend[];
}

const byMonth = <T extends { month?: YearMonth; date?: string }>(rows: T[], month: YearMonth) =>
  rows.filter((r) => (r.month ?? (r.date ? r.date.slice(0, 7) : '')) === month);

export function computeFinanceSummary(month: YearMonth, data: FinanceData): FinanceSummary {
  const txns = byMonth(data.transactions, month);

  const salaryReceivedMinor = sumMinor(
    byMonth(data.salaryReceipts, month).map((s) => s.amountMinor),
  );

  // Other income = income-kind transactions that are not the salary category.
  const otherIncomeMinor = sumMinor(
    txns.filter((t) => t.kind === 'income' && t.categoryId !== CAT.salary).map((t) => t.amountMinor),
  );

  const monthAllocations = byMonth(data.allocations, month);
  const parentAllocations = monthAllocations.filter((a) => a.categoryId === GROUP.pocketMoney);
  const pocketMoneyHasParentAllocation = parentAllocations.length > 0;
  // One parent per month is the policy: the FIRST record is authoritative —
  // exactly the record the UI edits. Any extra parent records and child-category
  // allocations are superseded (their spend already flows into Pocket Money) and
  // excluded from the ACTIVE plan total. Records are never deleted or mutated;
  // months without a parent keep their historical meaning unchanged.
  const legacyChildAllocationIds = pocketMoneyHasParentAllocation
    ? monthAllocations
        .filter(
          (a) =>
            a !== parentAllocations[0] &&
            (MONTHLY_POCKET.memberCategoryIds.includes(a.categoryId) || a.categoryId === GROUP.pocketMoney),
        )
        .map((a) => a.id)
    : [];
  const plannedAllocationMinor = sumMinor(
    monthAllocations.filter((a) => !legacyChildAllocationIds.includes(a.id)).map((a) => a.plannedMinor),
  );

  // Consumption spending, netted per category against refunds of the same category.
  const spendMap = new Map<string, CategorySpend>();
  for (const t of txns) {
    if (t.kind !== 'expense' && t.kind !== 'refund') continue;
    const entry =
      spendMap.get(t.categoryId) ??
      { categoryId: t.categoryId, grossMinor: 0, refundMinor: 0, netMinor: 0 };
    if (t.kind === 'expense') entry.grossMinor += t.amountMinor;
    else entry.refundMinor += t.amountMinor;
    spendMap.set(t.categoryId, entry);
  }
  const categorySpend: CategorySpend[] = [...spendMap.values()].map((e) => ({
    ...e,
    netMinor: Math.max(0, e.grossMinor - e.refundMinor),
  }));

  const grossSpendingMinor = sumMinor(categorySpend.map((c) => c.grossMinor));
  const refundMinor = sumMinor(categorySpend.map((c) => c.refundMinor));
  const netSpendingMinor = sumMinor(categorySpend.map((c) => c.netMinor));

  const savingsMinor = sumMinor(
    txns.filter((t) => t.kind === 'transfer' && t.categoryId === CAT.savings).map((t) => t.amountMinor),
  );
  const investmentMinor = sumMinor(
    txns.filter((t) => t.kind === 'investment').map((t) => t.amountMinor),
  );
  const otherTransfersMinor = sumMinor(
    txns
      .filter((t) => t.kind === 'transfer' && t.categoryId !== CAT.savings)
      .map((t) => t.amountMinor),
  );
  const savedOrInvestedMinor = savingsMinor + investmentMinor;

  const plan = data.plans.find((p) => p.month === month);
  const expectedSalaryMinor = plan?.expectedSalaryMinor ?? salaryReceivedMinor;

  const overallBudget = data.budgets.find((b) => b.month === month && b.categoryId === null);
  const overallBudgetMinor = overallBudget?.limitMinor ?? 0;

  // Monthly pocket money: net (refund-adjusted, floored per category) group spend.
  const pocketMoneySpentMinor = MONTHLY_POCKET.memberCategoryIds.reduce(
    (sum, id) => sum + categoryNetSpend(month, id, data.transactions),
    0,
  );
  const pocketMoneyBreakdown = categorySpend.filter((cs) =>
    MONTHLY_POCKET.memberCategoryIds.includes(cs.categoryId),
  );
  // The parent allocation takes precedence whenever a record EXISTS — even with
  // a zero amount (existence, not amount). The legacy group budget is a
  // fallback only when there is no parent record at all.
  const pocketMoneyBudget = data.budgets.find(
    (b) => b.month === month && b.categoryId === GROUP.pocketMoney,
  );
  const pocketMoneyLimitMinor = pocketMoneyHasParentAllocation
    ? parentAllocations[0].plannedMinor
    : pocketMoneyBudget?.limitMinor ?? 0;
  const pocketMoneyRemainingMinor = pocketMoneyLimitMinor - pocketMoneySpentMinor;
  const pocketMoneyUsagePct = usagePct(pocketMoneySpentMinor, pocketMoneyLimitMinor);

  const moneyIn = salaryReceivedMinor + otherIncomeMinor;
  const unallocatedMinor = moneyIn - plannedAllocationMinor;
  const oversubscribedMinor = unallocatedMinor < 0 ? -unallocatedMinor : 0;
  const remainingBudgetMinor = overallBudgetMinor - netSpendingMinor;
  const budgetUsagePct = usagePct(netSpendingMinor, overallBudgetMinor);

  return {
    month,
    expectedSalaryMinor,
    salaryReceivedMinor,
    otherIncomeMinor,
    plannedAllocationMinor,
    unallocatedMinor,
    oversubscribedMinor,
    netSpendingMinor,
    grossSpendingMinor,
    refundMinor,
    savingsMinor,
    investmentMinor,
    savedOrInvestedMinor,
    otherTransfersMinor,
    overallBudgetMinor,
    remainingBudgetMinor,
    budgetUsagePct,
    pocketMoneySpentMinor,
    pocketMoneyLimitMinor,
    pocketMoneyHasParentAllocation,
    pocketMoneyRemainingMinor,
    pocketMoneyUsagePct,
    pocketMoneyBreakdown,
    legacyChildAllocationIds,
    categorySpend,
  };
}

/** Spend as a percentage of a limit (0 when the limit is unset). */
export function usagePct(spentMinor: number, limitMinor: number): number {
  return limitMinor > 0 ? Math.round((spentMinor / limitMinor) * 100) : 0;
}

/**
 * Actual committed amount for one allocation this month: every non-income kind
 * minus refunds in the SAME category, floored at 0. The pocket-money PARENT
 * aggregates the net spend of its child categories. Single source of truth for
 * the allocations UI — components must not recompute money.
 */
export function allocationActualMinor(month: YearMonth, categoryId: string, data: FinanceData): number {
  if (categoryId === GROUP.pocketMoney) {
    return MONTHLY_POCKET.memberCategoryIds.reduce(
      (sum, id) => sum + categoryNetSpend(month, id, data.transactions),
      0,
    );
  }
  let committed = 0;
  let refunded = 0;
  for (const t of byMonth(data.transactions, month)) {
    if (t.categoryId !== categoryId) continue;
    if (t.kind === 'refund') refunded += t.amountMinor;
    else if (t.kind !== 'income') committed += t.amountMinor;
  }
  return Math.max(0, committed - refunded);
}

/** Net spending for one category in a month (expenses minus refunds, floored at 0). */
export function categoryNetSpend(month: YearMonth, categoryId: string, txns: Transaction[]): number {
  let gross = 0;
  let refund = 0;
  for (const t of txns) {
    if (t.month !== month || t.categoryId !== categoryId) continue;
    if (t.kind === 'expense') gross += t.amountMinor;
    else if (t.kind === 'refund') refund += t.amountMinor;
  }
  return Math.max(0, gross - refund);
}

/** Category-specific budget limit for a month (or null when unset). */
export function categoryBudgetLimit(budgets: Budget[], month: YearMonth, categoryId: string): number | null {
  const b = budgets.find((x) => x.month === month && x.categoryId === categoryId);
  return b ? b.limitMinor : null;
}

export interface TrendPoint {
  month: YearMonth;
  netSpendingMinor: number;
  savedOrInvestedMinor: number;
  salaryReceivedMinor: number;
}

export function monthlyTrend(months: YearMonth[], data: FinanceData): TrendPoint[] {
  return months.map((m) => {
    const s = computeFinanceSummary(m, data);
    return {
      month: m,
      netSpendingMinor: s.netSpendingMinor,
      savedOrInvestedMinor: s.savedOrInvestedMinor,
      salaryReceivedMinor: s.salaryReceivedMinor,
    };
  });
}
