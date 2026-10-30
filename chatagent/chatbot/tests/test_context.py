"""Context builder tests: deterministic finance/health maths + user isolation."""
from __future__ import annotations

from chatagent.chatbot.context import finance, health
from chatagent.chatbot.context.builder import build_context
from chatagent.chatbot.safety import intent as intent_mod
from app.services import upsert_record


def _summary(txns, **kw):
    return finance.compute_finance_summary(
        "2026-01", transactions=txns, salary_receipts=kw.get("salary", []),
        allocations=kw.get("alloc", []), budgets=kw.get("budgets", []),
        plans=kw.get("plans", []), currency="INR",
    )


def test_net_spending_nets_refunds_per_category():
    txns = [
        {"id": "t1", "month": "2026-01", "kind": "expense", "categoryId": "cat-food", "amountMinor": 50000},
        {"id": "t2", "month": "2026-01", "kind": "refund", "categoryId": "cat-food", "amountMinor": 20000},
        {"id": "t3", "month": "2026-01", "kind": "expense", "categoryId": "cat-food", "amountMinor": 10000},
    ]
    s = _summary(txns)
    assert s.gross_spending_minor == 60000
    assert s.refund_minor == 20000
    assert s.net_spending_minor == 40000


def test_transfers_and_investments_are_not_consumption():
    txns = [
        {"id": "t1", "month": "2026-01", "kind": "transfer", "categoryId": "cat-savings", "amountMinor": 100000},
        {"id": "t2", "month": "2026-01", "kind": "investment", "categoryId": "cat-sip", "amountMinor": 50000},
        {"id": "t3", "month": "2026-01", "kind": "transfer", "categoryId": "cat-rent", "amountMinor": 200000},
        {"id": "t4", "month": "2026-01", "kind": "expense", "categoryId": "cat-bills", "amountMinor": 30000},
    ]
    s = _summary(txns)
    assert s.net_spending_minor == 30000
    assert s.savings_minor == 100000
    assert s.investment_minor == 50000
    assert s.saved_or_invested_minor == 150000
    assert s.other_transfers_minor == 200000  # rent counts as other transfer


def test_planned_allocation_is_not_actual_and_unallocated_uses_income():
    txns = [{"id": "t1", "month": "2026-01", "kind": "income", "categoryId": "cat-other-income", "amountMinor": 5000}]
    s = _summary(txns, salary=[{"id": "s1", "month": "2026-01", "amountMinor": 1000000}],
                alloc=[{"id": "a1", "month": "2026-01", "plannedMinor": 900000}])
    assert s.salary_received_minor == 1000000
    assert s.other_income_minor == 5000
    assert s.planned_allocation_minor == 900000
    assert s.unallocated_minor == (1000000 + 5000) - 900000
    assert s.oversubscribed_minor == 0


def test_budget_usage_and_remaining():
    txns = [{"id": "t1", "month": "2026-01", "kind": "expense", "categoryId": "cat-bills", "amountMinor": 500000}]
    s = _summary(txns, budgets=[{"id": "b1", "month": "2026-01", "categoryId": None, "limitMinor": 1000000}])
    assert s.budget_usage_pct == 50
    assert s.remaining_budget_minor == 500000


def test_missing_data_marks_completeness():
    s = _summary([])
    facts = finance.build_facts("2026-01", s, category_names={})
    salary = next(f for f in facts if f.id.endswith("salary_received"))
    assert salary.completeness == "missing"
    usage = next(f for f in facts if f.id.endswith("budget_usage"))
    assert usage.completeness == "missing"  # no overall budget set


def test_money_formatting_inr_lakh_grouping():
    assert finance.format_money(4000000, "INR") == "₹40,000.00"
    assert finance.format_money(100000000, "INR") == "₹10,00,000.00"
    assert finance.format_money(123456, "USD") == "$1,234.56"


def test_symptom_frequency_and_medication_and_trend():
    logs = [{"id": "l1", "date": "2026-01-05", "wellbeing": 3}, {"id": "l2", "date": "2026-01-06", "wellbeing": 4}]
    symptoms = [{"id": "sy1", "logId": "l1", "name": "Headache", "severity": 6},
                {"id": "sy2", "logId": "l2", "name": "Headache", "severity": 4}]
    freq = health.symptom_frequency(symptoms, logs, "2026-01-01", "2026-01-31")
    assert freq[0]["name"] == "Headache" and freq[0]["count"] == 2
    assert freq[0]["avg_severity"] == 5.0
    meds = health.medication_status([{"id": "m1", "date": "2026-01-05", "name": "Metformin"}],
                                    "2026-01-01", "2026-01-31")
    assert meds["count"] == 1 and meds["names"] == ["Metformin"]
    trend = health.measurement_trend(
        [{"id": "e1", "typeId": "mt-weight", "date": "2026-01-01", "value": 70.0},
         {"id": "e2", "typeId": "mt-weight", "date": "2026-01-20", "value": 68.0}],
        "2026-01-01", "2026-01-31")
    assert trend[0]["delta"] == -2.0 and trend[0]["last"] == 68.0


def test_out_of_range_records_are_excluded():
    logs = [{"id": "l1", "date": "2025-12-31", "wellbeing": 5}]
    assert health.health_log_summary(logs, "2026-01-01", "2026-01-31")["count"] == 0


# --- Builder + isolation (uses the real DB) ----------------------------------
def _seed(db, user_id, month="2026-01"):
    upsert_record(db, user_id, "transactions", {
        "id": "tx-a", "month": month, "kind": "expense", "categoryId": "cat-food", "amountMinor": 123400,
    })
    upsert_record(db, user_id, "salaryReceipts", {"id": "sr-a", "month": month, "amountMinor": 5000000})
    db.commit()


def _finance_ir(text="where did my money go last month"):
    ir = intent_mod.route(text, today=__import__("datetime").date(2026, 2, 10))
    return ir


def test_builder_uses_only_current_user_records(db_session):
    from app.models import User
    import uuid
    u1 = User(pk=str(uuid.uuid4()), email="u1@x.com", password_hash="h")
    u2 = User(pk=str(uuid.uuid4()), email="u2@x.com", password_hash="h")
    db_session.add_all([u1, u2]); db_session.flush()
    _seed(db_session, u1.pk)

    ir = _finance_ir()
    bundle = build_context(db_session, u1.pk, ir, "INR")
    net = next((f for f in bundle.facts if f.id.endswith("net_spending")), None)
    assert net is not None and net.num == 1234.0  # ₹1,234.00

    # User 2 has no records -> no spending fact value.
    bundle2 = build_context(db_session, u2.pk, ir, "INR")
    net2 = next((f for f in bundle2.facts if f.id.endswith("net_spending")), None)
    assert net2 is not None and net2.num == 0.0
