"""Finance context builder — the Python port of `src/domain/finance.ts`.

The accounting rules are copied *exactly* so backend facts match what the app
already shows: salary vs. income, planned-vs-actual, refunds netted per category,
transfers/investments kept out of consumption spending, everything summed in
integer minor units. Records come from the existing user-scoped read path
(`load_collection`), so nothing here can cross an ownership boundary.

`compute_finance_summary` returns integer minor-unit numbers; `build_facts`
renders those into `Fact` objects for the model.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import Fact
from .money import format_money, pct, sum_minor

# Stable built-in category ids (mirrors src/domain/categories.ts + app defaults).
CAT_SALARY = "cat-salary"
CAT_SAVINGS = "cat-savings"


def _month_of(rec: dict) -> str:
    m = rec.get("month")
    if m:
        return m
    date = rec.get("date")
    return date[:7] if isinstance(date, str) and len(date) >= 7 else ""


def _by_month(rows: list[dict], month: str) -> list[dict]:
    return [r for r in rows if _month_of(r) == month]


@dataclass
class FinanceSummary:
    month: str
    currency: str
    salary_received_minor: int = 0
    other_income_minor: int = 0
    expected_salary_minor: int = 0
    planned_allocation_minor: int = 0
    unallocated_minor: int = 0
    oversubscribed_minor: int = 0
    gross_spending_minor: int = 0
    refund_minor: int = 0
    net_spending_minor: int = 0
    savings_minor: int = 0
    investment_minor: int = 0
    saved_or_invested_minor: int = 0
    other_transfers_minor: int = 0
    overall_budget_minor: int = 0
    remaining_budget_minor: int = 0
    budget_usage_pct: int = 0
    category_spend: list[dict] = field(default_factory=list)


def compute_finance_summary(
    month: str,
    *,
    transactions: list[dict],
    salary_receipts: list[dict],
    allocations: list[dict],
    budgets: list[dict],
    plans: list[dict],
    currency: str = "INR",
) -> FinanceSummary:
    txns = _by_month(transactions, month)
    s = FinanceSummary(month=month, currency=currency)

    s.salary_received_minor = sum_minor(r.get("amountMinor", 0) for r in _by_month(salary_receipts, month))

    s.other_income_minor = sum_minor(
        t.get("amountMinor", 0) for t in txns
        if t.get("kind") == "income" and t.get("categoryId") != CAT_SALARY
    )

    s.planned_allocation_minor = sum_minor(a.get("plannedMinor", 0) for a in _by_month(allocations, month))

    spend: dict[str, dict] = {}
    for t in txns:
        if t.get("kind") not in ("expense", "refund"):
            continue
        cid = t.get("categoryId") or "cat-other"
        entry = spend.setdefault(cid, {"categoryId": cid, "grossMinor": 0, "refundMinor": 0, "netMinor": 0})
        if t.get("kind") == "expense":
            entry["grossMinor"] += t.get("amountMinor", 0)
        else:
            entry["refundMinor"] += t.get("amountMinor", 0)
    for entry in spend.values():
        entry["netMinor"] = max(0, entry["grossMinor"] - entry["refundMinor"])
    s.category_spend = sorted(spend.values(), key=lambda e: e["netMinor"], reverse=True)

    s.gross_spending_minor = sum_minor(e["grossMinor"] for e in s.category_spend)
    s.refund_minor = sum_minor(e["refundMinor"] for e in s.category_spend)
    s.net_spending_minor = sum_minor(e["netMinor"] for e in s.category_spend)

    s.savings_minor = sum_minor(
        t.get("amountMinor", 0) for t in txns
        if t.get("kind") == "transfer" and t.get("categoryId") == CAT_SAVINGS
    )
    s.investment_minor = sum_minor(t.get("amountMinor", 0) for t in txns if t.get("kind") == "investment")
    s.other_transfers_minor = sum_minor(
        t.get("amountMinor", 0) for t in txns
        if t.get("kind") == "transfer" and t.get("categoryId") != CAT_SAVINGS
    )
    s.saved_or_invested_minor = s.savings_minor + s.investment_minor

    plan = next((p for p in plans if _month_of(p) == month), None)
    s.expected_salary_minor = plan.get("expectedSalaryMinor", s.salary_received_minor) if plan \
        else s.salary_received_minor

    overall = next(
        (b for b in budgets if _month_of(b) == month and b.get("categoryId") in (None, "")), None
    )
    s.overall_budget_minor = overall.get("limitMinor", 0) if overall else 0

    money_in = s.salary_received_minor + s.other_income_minor
    s.unallocated_minor = money_in - s.planned_allocation_minor
    s.oversubscribed_minor = max(0, -s.unallocated_minor)
    s.remaining_budget_minor = s.overall_budget_minor - s.net_spending_minor
    s.budget_usage_pct = pct(s.net_spending_minor, s.overall_budget_minor)
    return s


def _money_fact(fid: str, metric: str, minor: int, currency: str, month: str, sources: list[str],
                completeness: str = "complete") -> Fact:
    return Fact(
        id=fid, metric=metric, kind="money", num=minor / 100.0,
        display=format_money(minor, currency), currency=currency,
        period=month, sources=sources, completeness=completeness,
    )


def build_facts(month: str, s: FinanceSummary, *, category_names: dict[str, str],
                top_n: int = 6) -> list[Fact]:
    """Render a monthly summary into a compact, ordered fact list."""
    cur = s.currency
    facts = [
        _money_fact(f"fin:{month}:salary_received", "Salary received", s.salary_received_minor, cur, month, []),
        _money_fact(f"fin:{month}:net_spending", "Net spending", s.net_spending_minor, cur, month, []),
        _money_fact(f"fin:{month}:gross_spending", "Gross spending", s.gross_spending_minor, cur, month, []),
        _money_fact(f"fin:{month}:refund", "Refunds", s.refund_minor, cur, month, []),
        _money_fact(f"fin:{month}:savings", "Savings (transfers)", s.savings_minor, cur, month, []),
        _money_fact(f"fin:{month}:investment", "Investments/SIP", s.investment_minor, cur, month, []),
        _money_fact(f"fin:{month}:other_transfers", "Other transfers (rent, family)", s.other_transfers_minor, cur, month, []),
        _money_fact(f"fin:{month}:planned_allocation", "Planned allocation", s.planned_allocation_minor, cur, month, []),
        _money_fact(f"fin:{month}:unallocated", "Unallocated", s.unallocated_minor, cur, month, []),
        _money_fact(f"fin:{month}:remaining_budget", "Remaining budget", s.remaining_budget_minor, cur, month, []),
    ]
    facts.append(Fact(
        id=f"fin:{month}:budget_usage", metric="Budget utilization", kind="percent",
        num=float(s.budget_usage_pct), display=f"{s.budget_usage_pct}%",
        period=month, completeness="complete" if s.overall_budget_minor > 0 else "missing",
    ))
    for entry in s.category_spend[:top_n]:
        cid = entry["categoryId"]
        name = category_names.get(cid, cid)
        facts.append(_money_fact(
            f"fin:{month}:cat:{cid}", f"Spending on {name}", entry["netMinor"], cur, month, [],
        ))
    if s.salary_received_minor == 0:
        facts[0].completeness = "missing"
    return facts
