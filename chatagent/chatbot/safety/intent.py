"""Deterministic supported-intent router.

Order of decisions for every message:
1. Prohibited-topic policy → refuse (no data access, no model call).
2. Recognize an *allowed, read-only* intent from explicit signals.
3. Resolve the period the question refers to (relative to the server date).

Conservative-by-default: if nothing allowed is recognized, or finance and health
signals conflict (ambiguous), the request is NOT served and no personal data is
retrieved. Retrieval in `context/builder.py` is keyed to a single recognized
intent, so an unrecognized message can never pull records. This is the primary
security boundary; the keyword lists here are a positive allowlist, and the
prohibited patterns in `policy.py` are an additional (not sole) gate.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

from . import policy

# Specific intent signals, checked in order (most specific first).
_FINANCE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("finance.comparison", re.compile(r"\b(compare|compared|vs\.?|versus|month over month|more than last|less than last|than (the )?previous)\b")),
    ("finance.budget_status", re.compile(r"\bbudget\b.*(use|used|utilization|utilisation|left|remaining|much)|how much of my budget")),
    ("finance.salary_allocation", re.compile(r"\b(allocat\w*|unallocated)\b")),
    ("finance.commitments", re.compile(r"\b(rent|family transfer|saved|savings|sip|invested|contribution)\b")),
    ("finance.category_spending", re.compile(r"\b(categor\w*|top (spend|expense)|which (category|categories))\b")),
    ("finance.monthly_summary", re.compile(
        r"\b(where did my money go|money go|how much did i spend|spending|spent|expenses?|"
        r"money out|summary of (my )?month|financial summary|did i spend)\b")),
]
_HEALTH_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("health.medication_status", re.compile(r"\b(medication|medicine|tablet|did i (take|log))\b")),
    ("health.symptom_frequency", re.compile(r"\b(symptom\w*|headache|fever|how often|frequent\w*)\b")),
    ("health.measurement_trend", re.compile(r"\b(weight|bp|blood pressure|heart rate|glucose|measurement\w*|reading)\b")),
    ("health.wellbeing_trend", re.compile(r"\b(wellbeing|mood|feeling|trend)\b")),
    ("health.log_summary", re.compile(r"\b(health log\w*|my health|how have i been|health summary|logged health)\b")),
]

_MONTH_RE = re.compile(r"\b(2\d{3})-(0[1-9]|1[0-2])\b")
_MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


@dataclass
class Period:
    label: str
    month: str | None = None          # YYYY-MM (finance primary period)
    prev_month: str | None = None     # YYYY-MM (for comparison)
    start: str | None = None          # YYYY-MM-DD (health range)
    end: str | None = None            # YYYY-MM-DD


@dataclass
class IntentResult:
    decision: str                     # "allow" | "refuse" | "clarify"
    intent: str | None = None
    domain: str | None = None         # "finance" | "health"
    refusal_key: str | None = None
    message: str | None = None        # refusal / clarify text shown to the user
    period: Period | None = None
    question: str = ""

    @property
    def is_allowed(self) -> bool:
        return self.decision == "allow" and self.intent is not None


def _prev_month(y: int, m: int) -> str:
    py, pm = (y - 1, 12) if m == 1 else (y, m - 1)
    return f"{py:04d}-{pm:02d}"


def _ym(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"


def _month_bounds(ym: str) -> tuple[str, str]:
    y, m = int(ym[:4]), int(ym[5:7])
    start = f"{ym}-01"
    if m == 12:
        end = f"{y:04d}-12-31"
    else:
        nxt = date(y, m + 1, 1)
        end = (nxt - timedelta(days=1)).isoformat()
    return start, end


def _resolve_finance_period(text: str, today: date) -> Period:
    lowered = text.lower()
    m = _MONTH_RE.search(lowered)
    if m:
        ym = f"{m.group(1)}-{m.group(2)}"
    else:
        named = next((v for k, v in _MONTH_NAMES.items() if k in lowered), None)
        year = _year_in(lowered) or today.year
        if named:
            ym = _ym(year, named)
        elif "last month" in lowered:
            ym = _prev_month(today.year, today.month)
        elif any(k in lowered for k in ("this month", "current month", "this month")):
            ym = _ym(today.year, today.month)
        else:
            ym = _prev_month(today.year, today.month)  # default: last month
    prev = _prev_month(int(ym[:4]), int(ym[5:7]))
    return Period(label=ym, month=ym, prev_month=prev)


def _resolve_health_period(text: str, today: date) -> Period:
    lowered = text.lower()
    if "last week" in lowered or "past week" in lowered or "this week" in lowered:
        start = (today - timedelta(days=6)).isoformat()
        return Period(label="last 7 days", start=start, end=today.isoformat())
    m = _MONTH_RE.search(lowered)
    named = next((v for k, v in _MONTH_NAMES.items() if k in lowered), None)
    if m:
        ym = f"{m.group(1)}-{m.group(2)}"
        start, end = _month_bounds(ym)
        return Period(label=ym, month=ym, start=start, end=end)
    if named:
        ym = _ym(_year_in(lowered) or today.year, named)
        start, end = _month_bounds(ym)
        return Period(label=ym, month=ym, start=start, end=end)
    if "last month" in lowered:
        ym = _prev_month(today.year, today.month)
        start, end = _month_bounds(ym)
        return Period(label=ym, month=ym, start=start, end=end)
    if "this month" in lowered or "current month" in lowered:
        ym = _ym(today.year, today.month)
        start, end = _month_bounds(ym)
        return Period(label=ym, month=ym, start=start, end=end)
    if "last 30 days" in lowered or "past 30 days" in lowered or "last month" in lowered:
        return Period(label="last 30 days", start=(today - timedelta(days=29)).isoformat(), end=today.isoformat())
    # default health window: last 30 days
    return Period(label="last 30 days", start=(today - timedelta(days=29)).isoformat(), end=today.isoformat())


def _year_in(text: str) -> int | None:
    m = re.search(r"\b(20\d{2})\b", text)
    return int(m.group(1)) if m else None


def route(text: str, today: date | None = None) -> IntentResult:
    today = today or date.today()
    question = (text or "").strip()
    if not question:
        return IntentResult(decision="clarify", message="Ask me something about your recorded finances or health.")

    prohibited = policy.detect_prohibited(question)
    if prohibited is not None:
        return IntentResult(
            decision="refuse", refusal_key=prohibited,
            message=policy.refusal_message(prohibited), question=question,
        )

    fin_intent = next((intent for intent, pat in _FINANCE_PATTERNS if pat.search(question.lower())), None)
    health_intent = next((intent for intent, pat in _HEALTH_PATTERNS if pat.search(question.lower())), None)

    if fin_intent and health_intent:
        return IntentResult(
            decision="clarify",
            message="That mixes finance and health topics — could you ask about one at a time?",
            question=question,
        )
    if fin_intent is None and health_intent is None:
        return IntentResult(
            decision="clarify",
            message=(
                "I can only answer questions about your own recorded financial and health "
                "data — for example your monthly spending, budget use, salary allocation, or "
                "health logs, symptoms, medication and measurements."
            ),
            question=question,
        )

    if fin_intent:
        return IntentResult(
            decision="allow", intent=fin_intent, domain="finance",
            period=_resolve_finance_period(question, today), question=question,
        )
    return IntentResult(
        decision="allow", intent=health_intent, domain="health",
        period=_resolve_health_period(question, today), question=question,
    )
