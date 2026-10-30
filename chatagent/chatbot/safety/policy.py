"""Prohibited-topic policy.

A conservative, deterministic first gate. Matching any prohibited pattern refuses
the request with a fixed template and — critically — the pipeline never retrieves
the user's data for a prohibited request. This is one layer of several: it is NOT
the sole security boundary (allowed-intent recognition + user-scoped, intent-keyed
data retrieval in `context/builder.py` are the primary guarantee, and output
validation re-checks the model's own answer).

Patterns are intentionally phrase-based (not bare single words) to limit false
positives while staying auditable.
"""
from __future__ import annotations

import re

REFUSALS: dict[str, str] = {
    "earn_more": (
        "I can only work with your own recorded financial and health data — I can't "
        "give advice on how to earn more, side hustles, careers or salary negotiation."
    ),
    "investment_choice": (
        "I can't recommend which investments, stocks, SIPs or funds to choose. I can "
        "only summarise the contributions you've already recorded."
    ),
    "financial_advice": (
        "I can't give loan, insurance, tax or legal advice. I can analyse your recorded "
        "spending, budgets and income."
    ),
    "medical_diagnosis": (
        "I can't diagnose conditions or interpret symptoms medically. I can only summarise "
        "the health logs, symptoms and measurements you've recorded."
    ),
    "medication_safety": (
        "I can't advise on medication safety, dosage or treatment. I can tell you whether "
        "and what medication you logged for a period."
    ),
    "general_knowledge": (
        "I'm a read-only assistant for your own recorded financial and health data, so I "
        "can't answer general-knowledge questions."
    ),
    "modification": (
        "I can't modify records or take actions like payments. Use the Money and Health "
        "pages to edit your data — I only read it to answer questions."
    ),
    "other_user": (
        "I can only access your own data. I can't retrieve another person's records."
    ),
}

_PROHIBITED: list[tuple[str, re.Pattern]] = [
    ("earn_more", re.compile(
        r"\b(how (can|do|should) i (earn|make|save more money)|earn more|make more money|"
        r"extra income|increase my income|side hustle|passive income|get a raise|"
        r"salary negotiation|negotiate my (salary|raise)|ask for more money)\b")),
    ("investment_choice", re.compile(
        r"\b(which|best|should i)\b.*\b(invest|stock|stocks|mutual fund|etf|sip|fund|portfolio|"
        r"gold|crypto|property)\b|what should i (invest|buy)|where should i invest|recommend.*invest")),
    ("financial_advice", re.compile(
        r"\b(loan|emi|tax (saving|advice|return|planning)|income tax|insurance|lic policy|"
        r"should i (buy|purchase).*(house|car|home)|legal advice)\b")),
    ("medical_diagnosis", re.compile(
        r"\b(do i have|am i (suffering|affected)|what (disease|illness|condition)|"
        r"diagnos\w*|is it (normal|serious|cancer|diabetes)|why do i (feel|have))\b")),
    ("medication_safety", re.compile(
        r"\b(can i take|is it safe to take|side effect|dosage|dose should|i should (take|stop)|"
        r"stop (my|the) (medicine|medication|tablet)|increase my (dose|medication)|"
        r"should i take|skip my (medicine|medication))\b")),
    ("treatment", re.compile(r"\b(how to treat|home remedy|remedy for|cure for|treatment for)\b")),
    ("general_knowledge", re.compile(
        r"\b(capital of|who (won|invented|is)|weather|translate|write (an? )?(email|essay|poem)|"
        r"definition of|meaning of life|tell me a joke|who is the pm|population of)\b")),
    ("modification", re.compile(
        r"\b(add|delete|remove|change|update|edit)\b.*\b(transaction|record|budget|entry|log|"
        r"expense|income|payment)|make a payment|pay (my|the)\b|set a budget for|create a category")),
    ("other_user", re.compile(
        r"\b(other user|someone else'?s|my (wife|husband|friend|boss)'?s|his data|her data|"
        r"another (user|person)|everyone'?s)\b")),
]

# Advice phrased inside the model's own answer (used by output validation).
_ANSWER_ADVICE = re.compile(
    r"\b(you should (invest|buy|sell|take|stop|start|see a doctor)|"
    r"i recommend (you|investing|buying|taking)|you(?:'?re| are) (suffering|diagnosed with)|"
    r"take \d+\s?(mg|tablets|pills)|stop taking|this (is|could be) (cancer|diabetes|"
    r"a (disease|condition))|you need (medication|treatment|surgery))\b"
)


def detect_prohibited(text: str) -> str | None:
    lowered = (text or "").lower()
    for key, pattern in _PROHIBITED:
        if pattern.search(lowered):
            return key
    return None


def refusal_message(key: str) -> str:
    return REFUSALS.get(key, REFUSALS["general_knowledge"])


def answer_contains_prohibited_advice(text: str) -> bool:
    return bool(_ANSWER_ADVICE.search((text or "").lower()))
