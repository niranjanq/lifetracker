"""Output validation before delivery.

The model is asked to return strict JSON matching `ChatStructuredResponse`. We
never display it as-is. A response is accepted only if:

1. its `intent` is a supported intent and equals the routed intent;
2. every `fact_ref` names a fact we actually provided;
3. every structured `claim` matches its referenced fact's authoritative value
   (currency normalised — "₹40,000" == 40000);
4. every currency / percentage number written in the free-text `answer` maps to
   an authoritative fact value (tolerant numeric match, grouped-locale aware —
   NOT a simplistic "do the digits appear" test);
5. the answer contains no prohibited professional/diagnosis advice.

A failed validation is retried once (stricter) by the caller, then replaced by a
deterministic safe response. Fact/number checks are necessary but explicitly NOT
claimed to be sufficient for arbitrary NL claim verification.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..schemas import INTENT_SET, ChatStructuredResponse
from ..context.money import parse_amount_number
from ..context.builder import ContextBundle
from ..safety import policy

_CURRENCY_TOKEN = re.compile(
    r"(?:₹|\$|€|£|A\$|C\$|S\$|¥)\s?-?\d[\d,]*(?:\.\d+)?"
)
_PERCENT_TOKEN = re.compile(r"(?<![\w.])\d+(?:\.\d+)?\s?%")

_MONEY_TOL = 0.51       # major-unit tolerance (covers rounded paise display)
_PCT_TOL = 0.51
_COUNT_TOL = 0.51


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def _matches(value: float, pool: list[float], tol: float) -> bool:
    return any(abs(value - p) <= tol for p in pool)


def validate_response(resp: ChatStructuredResponse, bundle: ContextBundle,
                      routed_intent: str) -> ValidationResult:
    errors: list[str] = []
    facts = bundle.by_id()

    if resp.intent not in INTENT_SET:
        errors.append(f"unsupported intent '{resp.intent}'")
    elif resp.intent != routed_intent:
        errors.append("intent mismatch with routed intent")

    if not (resp.answer or "").strip():
        errors.append("empty answer")

    for ref in resp.fact_refs:
        if ref not in facts:
            errors.append(f"unknown fact_ref '{ref}'")

    # Numbers the answer is allowed to state, grouped by kind.
    money_pool = [f.num for f in bundle.facts if f.kind == "money" and f.num is not None]
    pct_pool = [f.num for f in bundle.facts if f.kind == "percent" and f.num is not None]
    # (Counts are intentionally not scanned from free text to avoid false
    # positives on ordinary words like "last 2 weeks"; counts are validated only
    # through structured claims above.)

    # Structured claims must match their referenced fact's authoritative value.
    for claim in resp.claims:
        fact = facts.get(claim.fact_id)
        if fact is None:
            errors.append(f"claim references unknown fact '{claim.fact_id}'")
            continue
        parsed = parse_amount_number(claim.value)
        if parsed is None:
            errors.append(f"claim '{claim.fact_id}' has no numeric value")
        elif fact.num is None or not _matches(parsed, [fact.num], _MONEY_TOL if fact.kind == "money" else _PCT_TOL):
            errors.append(f"claim value for '{claim.fact_id}' does not match the fact")

    # Free-text currency + percentage numbers must each be grounded.
    for tok in _CURRENCY_TOKEN.findall(resp.answer):
        num = parse_amount_number(tok)
        if num is None or not _matches(num, money_pool, _MONEY_TOL):
            errors.append(f"ungrounded amount '{tok.strip()}' in answer")
    for tok in _PERCENT_TOKEN.findall(resp.answer):
        num = parse_amount_number(tok)
        if num is None or not _matches(num, pct_pool, _PCT_TOL):
            errors.append(f"ungrounded percentage '{tok.strip()}' in answer")

    if policy.answer_contains_prohibited_advice(resp.answer):
        errors.append("answer contains prohibited professional/medical advice")

    return ValidationResult(ok=not errors, errors=errors)
