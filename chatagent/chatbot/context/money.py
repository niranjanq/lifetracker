"""Deterministic money helpers — the Python port of `src/domain/money.ts`.

All authoritative financial arithmetic happens in integer minor units (paise for
INR). This module also provides the canonical display formatter used to render
facts, and a tolerant parser used by output validation to compare a number the
model wrote (e.g. "₹40,000") against the authoritative fact value.
"""
from __future__ import annotations

import math
import re

MINOR_DIVISORS: dict[str, int] = {
    "INR": 100, "USD": 100, "EUR": 100, "GBP": 100,
    "AUD": 100, "CAD": 100, "SGD": 100, "JPY": 1,
}

CURRENCY_SYMBOLS: dict[str, str] = {
    "INR": "₹", "USD": "$", "EUR": "€", "GBP": "£",
    "AUD": "A$", "CAD": "C$", "SGD": "S$", "JPY": "¥",
}

_SYMBOL_SET = sorted(CURRENCY_SYMBOLS.values(), key=len, reverse=True)


def divisor(currency: str) -> int:
    return MINOR_DIVISORS.get(currency, 100)


def sum_minor(values) -> int:
    """Sum integer minor units with no float accumulation (mirrors sumMinor)."""
    return sum(math.trunc(v) for v in values)


def pct(part: float, whole: float) -> int:
    if whole <= 0:
        return 0
    return int(round((part / whole) * 100))


def _group_en_in(integer_part: str) -> str:
    """Indian lakh grouping: last 3 digits, then pairs (1,00,000)."""
    if len(integer_part) <= 3:
        return integer_part
    head, last = integer_part[:-3], integer_part[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + last


def _group_en_us(integer_part: str) -> str:
    out = ""
    for i, ch in enumerate(reversed(integer_part)):
        if i and i % 3 == 0:
            out = "," + out
        out = ch + out
    return out


def format_money(minor: int, currency: str = "INR", *, decimals: bool | None = None) -> str:
    div = divisor(currency)
    negative = minor < 0
    abs_v = abs(minor)
    whole = abs_v // div
    frac = abs_v % div
    use_decimals = (div > 1) if decimals is None else decimals
    grouping = _group_en_in if currency == "INR" else _group_en_us
    body = grouping(str(whole))
    if use_decimals and div > 1:
        body += "." + str(frac).zfill(2)
    symbol = CURRENCY_SYMBOLS.get(currency, "")
    return f"{'-' if negative else ''}{symbol}{body}"


# --- Parsing (output validation) --------------------------------------------- #
_AMOUNT_RE = re.compile(
    r"(?:(?:%s)\s*)?-?\d[\d,]*(?:\.\d+)?" % "|".join(re.escape(s) for s in _SYMBOL_SET)
)


def parse_amount_number(token: str) -> float | None:
    """Parse a human money/number token into its major-unit magnitude.

    Strips any currency symbol, thousands separators and surrounding spaces, so
    '₹40,000', '40,000.00' and '40000' all yield 40000.0. Returns None if the
    token contains no numeric magnitude.
    """
    cleaned = token
    for sym in _SYMBOL_SET:
        cleaned = cleaned.replace(sym, "")
    cleaned = cleaned.replace(",", "").replace(" ", "").replace("\u00a0", "")
    m = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not m:
        return None
    return float(m.group(0))
