"""Context assembly: intent → user-scoped, deterministic facts.

Given a recognized intent, this reads the current user's records through the
existing trusted path (`app.services.load_collection`, always filtered by the
authenticated user id) and produces a *minimized* set of `Fact`s — only the ones
relevant to that intent. The model is shown these facts and nothing else: no raw
record blobs, no free-text health notes, no other collections, and never another
user's data (the user id comes only from the session, never from the client or
the model).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services import load_collection

from ..schemas import Fact
from ..safety.intent import IntentResult
from . import finance, health

# Which finance fact metric-keys each intent is allowed to see (minimization).
_FINANCE_SELECTION: dict[str, set[str]] = {
    "finance.monthly_summary": {"salary_received", "net_spending", "savings", "investment", "other_transfers", "refund", "cat"},
    "finance.category_spending": {"cat", "net_spending"},
    "finance.budget_status": {"remaining_budget", "budget_usage", "net_spending", "overall_budget"},
    "finance.salary_allocation": {"salary_received", "planned_allocation", "unallocated", "oversubscribed"},
    "finance.commitments": {"savings", "investment", "other_transfers"},
    "finance.comparison": {"net_spending", "salary_received", "spend_delta"},
}


@dataclass
class ContextBundle:
    intent: str
    domain: str
    period_label: str
    facts: list[Fact] = field(default_factory=list)

    def by_id(self) -> dict[str, Fact]:
        return {f.id: f for f in self.facts}

    def prompt_block(self, max_facts: int = 40) -> str:
        import json
        trimmed = self.facts[:max_facts]
        return json.dumps(
            [{"id": f.id, "metric": f.metric, "value": f.display,
              "kind": f.kind, "period": f.period, "completeness": f.completeness}
             for f in trimmed],
            ensure_ascii=False,
        )


def _finance_facts(db, user_id: str, ir: IntentResult, currency: str) -> list[Fact]:
    period = ir.period
    month = period.month
    transactions = load_collection(db, user_id, "transactions")
    salary_receipts = load_collection(db, user_id, "salaryReceipts")
    allocations = load_collection(db, user_id, "allocations")
    budgets = load_collection(db, user_id, "budgets")
    plans = load_collection(db, user_id, "plans")
    categories = {c["id"]: c.get("name", c["id"]) for c in load_collection(db, user_id, "categories")}

    summary = finance.compute_finance_summary(
        month, transactions=transactions, salary_receipts=salary_receipts,
        allocations=allocations, budgets=budgets, plans=plans, currency=currency,
    )
    all_facts = {f.id.split(":")[-1]: f for f in finance.build_facts(month, summary, category_names=categories)}
    # Keep an explicit overall-budget fact for budget questions.
    all_facts["overall_budget"] = Fact(
        id=f"fin:{month}:overall_budget", metric="Overall budget", kind="money",
        num=summary.overall_budget_minor / 100.0,
        display=finance.format_money(summary.overall_budget_minor, currency),
        currency=currency, period=month,
    )
    all_facts["oversubscribed"] = Fact(
        id=f"fin:{month}:oversubscribed", metric="Oversubscribed amount", kind="money",
        num=summary.oversubscribed_minor / 100.0,
        display=finance.format_money(summary.oversubscribed_minor, currency),
        currency=currency, period=month,
    )

    selected: list[Fact] = []
    allowed = _FINANCE_SELECTION.get(ir.intent, {"net_spending"})

    if ir.intent == "finance.comparison":
        prev = period.prev_month
        prev_summary = finance.compute_finance_summary(
            prev, transactions=transactions, salary_receipts=salary_receipts,
            allocations=allocations, budgets=budgets, plans=plans, currency=currency,
        )
        cur_net, prev_net = summary.net_spending_minor, prev_summary.net_spending_minor
        delta = cur_net - prev_net
        selected = [
            Fact(id=f"fin:{month}:net_spending", metric=f"Net spending {month}", kind="money",
                 num=cur_net / 100.0, display=finance.format_money(cur_net, currency),
                 currency=currency, period=month),
            Fact(id=f"fin:{prev}:net_spending", metric=f"Net spending {prev}", kind="money",
                 num=prev_net / 100.0, display=finance.format_money(prev_net, currency),
                 currency=currency, period=prev),
            Fact(id=f"fin:delta:net_spending", metric="Change in net spending (current minus previous)",
                 kind="money", num=delta / 100.0,
                 display=finance.format_money(abs(delta), currency) + (" (increase)" if delta >= 0 else " (decrease)"),
                 currency=currency, period=f"{prev} → {month}"),
        ]
        return selected

    for key in all_facts:
        if key in allowed:
            selected.append(all_facts[key])
        elif key.startswith("cat:") and "cat" in allowed:
            selected.append(all_facts[key])
    return selected


def _health_facts(db, user_id: str, ir: IntentResult) -> list[Fact]:
    period = ir.period
    start, end = period.start, period.end
    logs = load_collection(db, user_id, "healthLogs")
    symptoms = load_collection(db, user_id, "symptoms")
    medlogs = load_collection(db, user_id, "medicationLogs")
    measurements = load_collection(db, user_id, "measurementEntries")
    mtypes = {t["id"]: t.get("name", t["id"]) for t in load_collection(db, user_id, "measurementTypes")}

    facts = health.build_facts(
        period_label=period.label, logs=logs, symptoms=symptoms, medlogs=medlogs,
        measurements=measurements, measurement_names=mtypes, start=start, end=end,
    )
    prefix = {
        "health.log_summary": ("hl:",),
        "health.wellbeing_trend": ("hl:",),
        "health.symptom_frequency": ("sy:", "hl:"),
        "health.medication_status": ("med:",),
        "health.measurement_trend": ("me:",),
    }.get(ir.intent, ("hl:", "med:", "sy:", "me:"))
    return [f for f in facts if f.id.startswith(prefix)]


def build_context(db, user_id: str, ir: IntentResult, currency: str = "INR") -> ContextBundle:
    if ir.domain == "finance":
        facts = _finance_facts(db, user_id, ir, currency)
    else:
        facts = _health_facts(db, user_id, ir)
    return ContextBundle(intent=ir.intent, domain=ir.domain,
                         period_label=ir.period.label if ir.period else "", facts=facts)
