"""Shared Pydantic models for the assistant.

Two contracts matter here:

- `Fact` — a compact, authoritative fact produced by the deterministic context
  builders. Values are integer minor units for money (never floats in the DB),
  and every fact carries the stable `external_id`s of the records it was derived
  from (`sources`) plus a `completeness` flag. The LLM is only ever shown these
  facts; it never sees raw record blobs or computes any value itself.
- `ChatStructuredResponse` — the strict JSON shape the model must return, later
  validated by `safety/output_validation.py` before anything is displayed.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FactKind = Literal["money", "percent", "count", "date", "text"]

# A read-only, supported intent (used by routing + validation).
INTENTS: tuple[str, ...] = (
    "finance.monthly_summary",
    "finance.category_spending",
    "finance.budget_status",
    "finance.salary_allocation",
    "finance.comparison",
    "finance.commitments",
    "health.log_summary",
    "health.symptom_frequency",
    "health.medication_status",
    "health.measurement_trend",
    "health.wellbeing_trend",
)
INTENT_SET = set(INTENTS)
FINANCE_INTENTS = {i for i in INTENTS if i.startswith("finance.")}
HEALTH_INTENTS = {i for i in INTENTS if i.startswith("health.")}


class Fact(BaseModel):
    id: str
    metric: str
    kind: FactKind
    # Numeric magnitude in the value's natural unit: major currency units for
    # money (e.g. rupees, not paise), the percent value, or an integer count.
    num: float | None = None
    text: str | None = None
    display: str                      # canonical human rendering (source of truth)
    currency: str | None = None
    period: str | None = None         # YYYY-MM / YYYY-MM-DD / range label
    sources: list[str] = Field(default_factory=list)
    completeness: str = "complete"    # complete | partial | missing


class Claim(BaseModel):
    """A single assertion in the answer tied back to an authoritative fact."""
    fact_id: str
    value: str                        # the number/percentage exactly as written


class ChatStructuredResponse(BaseModel):
    answer: str
    intent: str
    fact_refs: list[str] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    disclaimer_required: bool = False
