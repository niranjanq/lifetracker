import type { Category } from './types';

/**
 * Built-in categories use stable IDs so demo data, defaults and roast
 * exemptions can reference them deterministically.
 */
export const CAT = {
  food: 'cat-food',
  transport: 'cat-transport',
  rent: 'cat-rent',
  bills: 'cat-bills',
  shopping: 'cat-shopping',
  entertainment: 'cat-entertainment',
  health: 'cat-health',
  family: 'cat-family',
  savings: 'cat-savings',
  sip: 'cat-sip',
  education: 'cat-education',
  subscriptions: 'cat-subscriptions',
  salary: 'cat-salary',
  otherIncome: 'cat-other-income',
  other: 'cat-other',
} as const;

export const DEFAULT_CATEGORIES: Category[] = [
  { id: CAT.salary, name: 'Salary', icon: 'Wallet', essential: false, defaultKind: 'income', builtin: true },
  { id: CAT.otherIncome, name: 'Other income', icon: 'Coins', essential: false, defaultKind: 'income', builtin: true },
  { id: CAT.food, name: 'Food & groceries', icon: 'UtensilsCrossed', essential: true, defaultKind: 'expense', builtin: true },
  { id: CAT.transport, name: 'Transport', icon: 'BusFront', essential: false, defaultKind: 'expense', builtin: true },
  { id: CAT.rent, name: 'Rent', icon: 'Home', essential: true, defaultKind: 'transfer', builtin: true },
  { id: CAT.bills, name: 'Bills', icon: 'Receipt', essential: true, defaultKind: 'expense', builtin: true },
  { id: CAT.shopping, name: 'Shopping', icon: 'ShoppingBag', essential: false, defaultKind: 'expense', builtin: true },
  { id: CAT.entertainment, name: 'Entertainment', icon: 'Clapperboard', essential: false, defaultKind: 'expense', builtin: true },
  { id: CAT.health, name: 'Health & medicines', icon: 'Pill', essential: true, defaultKind: 'expense', builtin: true },
  { id: CAT.family, name: 'Family transfers', icon: 'HeartHandshake', essential: true, defaultKind: 'transfer', builtin: true },
  { id: CAT.savings, name: 'Savings', icon: 'PiggyBank', essential: false, defaultKind: 'transfer', builtin: true },
  { id: CAT.sip, name: 'SIP / investments', icon: 'TrendingUp', essential: false, defaultKind: 'investment', builtin: true },
  { id: CAT.education, name: 'Education', icon: 'GraduationCap', essential: false, defaultKind: 'expense', builtin: true },
  { id: CAT.subscriptions, name: 'Subscriptions', icon: 'Repeat', essential: false, defaultKind: 'expense', builtin: true },
  { id: CAT.other, name: 'Other', icon: 'Shape', essential: false, defaultKind: 'expense', builtin: true },
];

/** Pseudo-ids for spending GROUPS — rollups tracked with one monthly limit. */
export const GROUP = {
  pocketMoney: 'group-pocket-money',
} as const;

export interface SpendingGroup {
  id: string;
  name: string;
  /** Real categories whose net expense spend rolls up into the group. */
  memberCategoryIds: string[];
}

/** "Monthly pocket money" = one limit over everyday variable spending. */
export const MONTHLY_POCKET: SpendingGroup = {
  id: GROUP.pocketMoney,
  name: 'Monthly pocket money',
  memberCategoryIds: [CAT.food, CAT.bills, CAT.shopping, CAT.entertainment, CAT.health],
};

export function isPocketMoneyMember(categoryId: string): boolean {
  return MONTHLY_POCKET.memberCategoryIds.includes(categoryId);
}

/** True when an allocation/budget targets the pocket-money PARENT. */
export function isPocketMoneyParent(categoryId: string | null | undefined): boolean {
  return categoryId === GROUP.pocketMoney;
}

/** Categories that count toward the spending budget when kind === 'expense'. */
export function isConsumption(kind: string): boolean {
  return kind === 'expense';
}
