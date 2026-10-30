"""Output validation tests: grounding, currency normalisation, scope, malformed."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from chatagent.chatbot.schemas import ChatStructuredResponse, Claim, Fact
from chatagent.chatbot.context.builder import ContextBundle
from chatagent.chatbot.safety.output_validation import validate_response


def _bundle():
    facts = [
        Fact(id="fin:2026-01:net_spending", metric="Net spending", kind="money",
             num=40000.0, display="₹40,000.00", currency="INR", period="2026-01"),
        Fact(id="fin:2026-01:budget_usage", metric="Budget utilization", kind="percent",
             num=62.0, display="62%", period="2026-01"),
    ]
    return ContextBundle(intent="finance.budget_status", domain="finance",
                         period_label="2026-01", facts=facts)


def _resp(answer, intent="finance.budget_status", refs=None, claims=None):
    return ChatStructuredResponse(
        answer=answer, intent=intent,
        fact_refs=refs if refs is not None else ["fin:2026-01:net_spending", "fin:2026-01:budget_usage"],
        claims=claims if claims is not None else [],
        disclaimer_required=True,
    )


def test_grounded_response_passes():
    resp = _resp(
        "You spent ₹40,000 and used 62% of your budget.",
        claims=[Claim(fact_id="fin:2026-01:net_spending", value="₹40,000"),
                Claim(fact_id="fin:2026-01:budget_usage", value="62%")],
    )
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert result.ok, result.errors


def test_currency_normalisation_variants():
    bundle = _bundle()
    for written in ["₹40,000", "₹40,000.00", "40,000", "40000"]:
        resp = _resp(f"Total spending was {written}.",
                     claims=[Claim(fact_id="fin:2026-01:net_spending", value=written)])
        assert validate_response(resp, bundle, "finance.budget_status").ok, written


def test_unsupported_amount_is_rejected():
    resp = _resp("You spent ₹99,999 last month.")
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert not result.ok
    assert any("ungrounded amount" in e for e in result.errors)


def test_unsupported_percentage_is_rejected():
    resp = _resp("You used 75% of your budget.")
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert any("ungrounded percentage" in e for e in result.errors)


def test_unknown_fact_ref_rejected():
    resp = _resp("Fine.", refs=["fin:2026-01:does_not_exist"])
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert any("unknown fact_ref" in e for e in result.errors)


def test_claim_value_mismatch_rejected():
    resp = _resp("Spending note.",
                 claims=[Claim(fact_id="fin:2026-01:net_spending", value="₹50,000")])
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert any("does not match the fact" in e for e in result.errors)


def test_intent_mismatch_rejected():
    resp = _resp("You spent ₹40,000.", intent="finance.monthly_summary")
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert any("intent mismatch" in e for e in result.errors)


def test_unsupported_intent_rejected():
    resp = _resp("ok", intent="general.chat")
    result = validate_response(resp, _bundle(), "general.chat")
    assert any("unsupported intent" in e for e in result.errors)


def test_prohibited_advice_in_answer_rejected():
    resp = _resp("You should invest in this stock to save more.")
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert any("prohibited" in e for e in result.errors)


def test_plain_non_money_numbers_are_not_false_positives():
    # "12 months" has no currency symbol/percent sign → not scanned.
    resp = _resp("I look back over 12 months of records.")
    result = validate_response(resp, _bundle(), "finance.budget_status")
    assert result.ok, result.errors


def test_malformed_structured_output_is_rejected_by_schema():
    with pytest.raises(ValidationError):
        ChatStructuredResponse.model_validate({"intent": "finance.budget_status"})
